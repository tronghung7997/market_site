from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.order import Order, OrderStatus
from src.models.product import Product
from src.models.service_task import ServiceTask, ServiceTaskStatus
from src.wallet.service import refund_escrow

_TERMINAL = {ServiceTaskStatus.completed, ServiceTaskStatus.failed}

_DEFAULT_ESCROW_DAYS = 3

_TASK_STATUS_LABELS = {
    ServiceTaskStatus.pending: "Đang chờ xử lý",
    ServiceTaskStatus.processing: "Đang xử lý",
    ServiceTaskStatus.completed: "Hoàn thành",
    ServiceTaskStatus.failed: "Không thực hiện được",
}


def format_task_delivery(tasks: list[ServiceTask]) -> str:
    """Bản bàn giao mà BUYER đọc được, cho đơn fulfillment theo tác vụ.

    Trước 30/07 `delivered_data` của các đơn này là chuỗi CSV id nội bộ
    ("24,25") — buyer trả tiền triệu và nhận về hai con số vô nghĩa, còn
    `result_data` admin/seller nhập khi hoàn thành thì không đường nào tới
    buyer. Id vẫn được giữ ở `ProvisionResult.resource_id` (get_usage/revoke
    tra theo đó), chỉ phần HIỂN THỊ đổi.

    Dùng chung cho cả 2 adapter task (manual, seller_task_webhook) và cho
    _sync_order_status ghi lại lúc mọi task kết thúc, nên buyer thấy đúng một
    định dạng từ lúc đặt tới lúc xong.
    """
    lines: list[str] = []
    for i, task in enumerate(sorted(tasks, key=lambda t: t.id), start=1):
        label = _TASK_STATUS_LABELS.get(task.status, task.status.value)
        lines.append(f"{i}. {task.target_url} — {label}")
        if task.result_data:
            lines.append(f"   Kết quả: {task.result_data}")
    return "\n".join(lines)


async def list_tasks(
    db: AsyncSession,
    *,
    status: ServiceTaskStatus | None = None,
) -> list[tuple[ServiceTask, str | None]]:
    """Return tasks newest-first, each paired with its order's status."""
    q = (
        select(ServiceTask, Order.status)
        .join(Order, Order.id == ServiceTask.order_id)
        .order_by(ServiceTask.created_at.desc())
    )
    if status is not None:
        q = q.where(ServiceTask.status == status)
    result = await db.execute(q)
    return [(task, order_status.value) for task, order_status in result.all()]


async def update_task(
    task_id: int,
    updates: dict,
    db: AsyncSession,
) -> tuple[ServiceTask, str | None]:
    """Apply updates rồi đồng bộ trạng thái order nếu mọi task đã kết thúc.

    Returns (task, order_status_sau_khi_sync).
    """
    task = await db.get(ServiceTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy tác vụ")

    for key, value in updates.items():
        setattr(task, key, value)  # cho phép set None (vd xoá assignee)

    order_status = await _sync_order_status(task, db)

    await db.commit()
    await db.refresh(task)
    return task, order_status


async def _sync_order_status(task: ServiceTask, db: AsyncSession) -> str | None:
    """Task-driven order lifecycle cho manual fulfillment.

    Khi MỌI task của order về trạng thái kết thúc (completed/failed):
    - tất cả completed  -> delivered + bắt đầu escrow
    - fail một phần     -> refund tỉ lệ URL fail, phần còn lại delivered;
                           total_amount giảm đi phần refund để escrow release
                           sau này chỉ trả seller phần thực làm
    - fail toàn bộ      -> cancelled + refund đủ

    `with_for_update=True` trên order: trước đây chỉ 1 admin bấm nút cập
    nhật 1 task một lúc nên đường này chưa bao giờ chạy song song thật —
    seller_task_webhook (2026-07-21) đổi điều đó, seller có thể gọi webhook
    cho 2 task cuối gần như cùng lúc. Không khoá, cả 2 request đều đọc thấy
    "chưa xong hết" (mỗi bên chưa thấy commit của bên kia) rồi cùng bỏ qua —
    order kẹt `processing` vĩnh viễn dù trên thực tế mọi task đã xong. Khoá
    dòng order buộc request thứ hai đợi request thứ nhất commit xong rồi mới
    đọc lại — thấy đúng trạng thái mới nhất, tính đúng một lần duy nhất.
    """
    order = await db.get(Order, task.order_id, with_for_update=True)
    if not order:
        return None
    if order.status != OrderStatus.processing:
        return order.status.value

    result = await db.execute(
        select(ServiceTask).where(ServiceTask.order_id == order.id)
    )
    tasks = list(result.scalars().all())
    if any(t.status not in _TERMINAL for t in tasks):
        return order.status.value

    # Chốt bản bàn giao đọc được ngay khi mọi task kết thúc — buyer thấy từng
    # URL kèm kết quả admin/seller nhập, thay cho chuỗi id nội bộ đặt lúc
    # provision (xem format_task_delivery).
    order.delivered_data = format_task_delivery(tasks)

    failed = [t for t in tasks if t.status == ServiceTaskStatus.failed]
    if len(failed) == len(tasks):
        await refund_escrow(order.id, order.buyer_id, order.total_amount, db)
        order.total_amount = 0
        order.status = OrderStatus.cancelled
    else:
        if failed:
            refund = round(order.total_amount * len(failed) / len(tasks))
            if refund:
                await refund_escrow(order.id, order.buyer_id, refund, db)
                order.total_amount -= refund
        order.status = OrderStatus.delivered
        product = await db.get(Product, order.product_id) if order.product_id else None
        escrow_days = product.escrow_days if product else _DEFAULT_ESCROW_DAYS
        order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(days=escrow_days)

    return order.status.value
