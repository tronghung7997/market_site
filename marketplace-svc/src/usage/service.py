from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import QuotaExceeded, QuotaExpired
from src.models.account import Account
from src.models.order import Order
from src.models.usage import OrderBalance, UsageRecord, UsageRecordStatus


async def create_balance_for_order(order: Order, db: AsyncSession) -> OrderBalance:
    """Gọi khi order strategy=credit chuyển `delivered`.

    `units_total` chốt bằng `order.quantity` — với strategy credit,
    `CreditPricing._subtotal` đã trả quantity = package_size buyer chọn, nên
    đây chính xác là số request buyer đã trả tiền mua, không đọc lại từ cấu
    hình sản phẩm (seller có thể đã đổi giá/gói sau đó).
    """
    balance = OrderBalance(order_id=order.id, units_total=order.quantity)
    db.add(balance)
    return balance


async def charge_usage(
    order_id: int, endpoint: str, units: int, db: AsyncSession, *, request_id: str | None = None,
) -> dict:
    """Trừ `units` khỏi số dư request của order. Chặn cứng khi vượt hạn mức
    hoặc hết hạn — không cho âm số dư kể cả khi hai request tới cùng lúc
    (khoá dòng FOR UPDATE trước khi so sánh rồi mới cộng dồn).

    Ghi `UsageRecord` cho MỌI lần gọi, kể cả bị từ chối — buyer/seller tranh
    chấp "tôi đâu có vượt hạn mức" thì đây là nơi tra lại sự thật.
    """
    balance = await db.scalar(
        select(OrderBalance).where(OrderBalance.order_id == order_id).with_for_update()
    )
    if balance is None:
        raise HTTPException(
            status_code=404,
            detail="Đơn hàng này chưa có số dư request (chưa được giao, hoặc không phải sản phẩm dạng credit)",
        )

    now = datetime.now(timezone.utc)
    if balance.expires_at and now > balance.expires_at:
        db.add(UsageRecord(
            order_id=order_id, request_id=request_id, endpoint=endpoint, units=units,
            status=UsageRecordStatus.rejected_expired,
        ))
        await db.commit()
        raise QuotaExpired()

    if balance.units_used + units > balance.units_total:
        db.add(UsageRecord(
            order_id=order_id, request_id=request_id, endpoint=endpoint, units=units,
            status=UsageRecordStatus.rejected_quota,
        ))
        await db.commit()
        raise QuotaExceeded()

    balance.units_used += units
    db.add(UsageRecord(
        order_id=order_id, request_id=request_id, endpoint=endpoint, units=units,
        status=UsageRecordStatus.ok,
    ))
    await db.commit()
    await db.refresh(balance)
    return {
        "units_total": balance.units_total,
        "units_used": balance.units_used,
        "units_remaining": balance.units_total - balance.units_used,
    }


async def charge_usage_as(
    order_id: int, account: Account, endpoint: str, units: int, db: AsyncSession, *, request_id: str | None = None,
) -> dict:
    """Cổng cho `POST /orders/{id}/usage` (chủ order tự báo, hoặc admin test/debug) —
    `POST /internal/usage/charge` gọi thẳng `charge_usage()` vì đã xác thực bằng
    khoá nội bộ, không có Account nào để kiểm tra quyền sở hữu."""
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.buyer_id != account.id and "admin" not in account.roles:
        raise HTTPException(status_code=403, detail="Bạn không có quyền thực hiện thao tác này")
    return await charge_usage(order_id, endpoint, units, db, request_id=request_id)


async def get_usage_summary(order_id: int, db: AsyncSession) -> dict | None:
    """None nếu order chưa có balance — chưa giao hàng, hoặc không phải strategy credit."""
    balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
    if balance is None:
        return None

    records_result = await db.execute(
        select(UsageRecord)
        .where(UsageRecord.order_id == order_id)
        .order_by(UsageRecord.created_at.desc())
        .limit(20)
    )
    records = list(records_result.scalars().all())

    return {
        "units_total": balance.units_total,
        "units_used": balance.units_used,
        "units_remaining": balance.units_total - balance.units_used,
        "expires_at": balance.expires_at,
        "records": [
            {
                "id": r.id, "endpoint": r.endpoint, "units": r.units,
                "status": r.status.value, "created_at": r.created_at,
            }
            for r in records
        ],
    }
