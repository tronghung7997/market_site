from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import QuotaExceeded, QuotaExpired
from src.gateway.call_history import list_gateway_call_logs
from src.models.account import Account
from src.models.order import Order
from src.models.usage import OrderBalance, UsageRecord, UsageRecordStatus


async def create_balance_for_order(
    order: Order, db: AsyncSession, *, pricing_params: dict | None = None,
) -> OrderBalance:
    """Gọi khi order strategy=credit chuyển `delivered`.

    `units_total` chốt bằng `order.quantity` — với strategy credit,
    `CreditPricing._subtotal` đã trả quantity = package_size buyer chọn, nên
    đây chính xác là số request buyer đã trả tiền mua, không đọc lại từ cấu
    hình sản phẩm (seller có thể đã đổi giá/gói sau đó).

    `endpoint_rates`/`default_rate` chốt tương tự từ `pricing_params` hiện có
    của product NGAY LÚC giao hàng — seller sửa giá theo endpoint sau này
    không ảnh hưởng gói buyer đã mua, cùng nguyên tắc với units_total.
    """
    pricing_params = pricing_params or {}
    balance = OrderBalance(
        order_id=order.id, units_total=order.quantity,
        endpoint_rates=pricing_params.get("endpoint_rates") or None,
        default_rate=pricing_params.get("default_rate"),
    )
    db.add(balance)
    return balance


def resolve_endpoint_units(balance: OrderBalance, endpoint: str) -> int:
    """Bao nhiêu unit một lần gọi `endpoint` tốn, theo giá đã chốt trên
    OrderBalance lúc giao hàng — không đọc pricing_params sống của product."""
    rates = balance.endpoint_rates or {}
    if endpoint in rates:
        return rates[endpoint]
    return balance.default_rate or 1


async def charge_usage(
    order_id: int, endpoint: str, units: int | None, db: AsyncSession, *, request_id: str | None = None,
) -> dict:
    """Trừ `units` khỏi số dư request của order. Chặn cứng khi vượt hạn mức
    hoặc hết hạn — không cho âm số dư kể cả khi hai request tới cùng lúc
    (khoá dòng FOR UPDATE trước khi so sánh rồi mới cộng dồn).

    `units=None` (gateway router dùng cách này) → tự tính từ
    `balance.endpoint_rates`/`default_rate` NGAY SAU KHI đã khoá dòng, không
    phải trước — từng có một bản đọc balance không khoá TRƯỚC lệnh gọi này
    riêng để tính units, tưởng vô hại nhưng làm gãy tính đúng đắn của khoá
    (2 request đồng thời cùng thắng dù chỉ còn 1 unit — bắt được nhờ
    test_two_simultaneous_gateway_calls_with_one_unit_left_only_one_succeeds).
    Bài học: đừng bao giờ đọc lại cùng một hàng qua session KHÔNG khoá ngay
    trước một lệnh SELECT ... FOR UPDATE trên chính hàng đó trong cùng
    transaction — gộp vào MỘT lần đọc có khoá duy nhất.

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
    if units is None:
        units = resolve_endpoint_units(balance, endpoint)

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
        # Caller needs this back when units=None was passed (resolved
        # internally) — e.g. the gateway router must refund_usage() the exact
        # same amount if the forward afterward fails.
        "units_charged": units,
    }


async def refund_usage(
    order_id: int, units: int, db: AsyncSession, *, request_id: str | None = None,
    endpoint: str = "",
) -> None:
    """Undo a `charge_usage()` pre-auth when the forwarded call never actually
    reached the seller (gateway router — src/gateway/router.py). Clamped at 0
    so a duplicate refund can't push a balance negative. Writes a `refunded`
    UsageRecord so the ledger stays reconstructable — without it, the
    charge_usage() call's `ok` row would still be sitting in the history
    after units_used was quietly decremented back, and the two would no
    longer add up to the balance."""
    balance = await db.scalar(
        select(OrderBalance).where(OrderBalance.order_id == order_id).with_for_update()
    )
    if balance is None:
        return
    balance.units_used = max(0, balance.units_used - units)
    db.add(UsageRecord(
        order_id=order_id, request_id=request_id, endpoint=endpoint, units=units,
        status=UsageRecordStatus.refunded,
    ))
    await db.commit()


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

    # Chi tiết TỪNG lần gọi qua gateway (status code thật, payload, trích
    # response) — bảng riêng GatewayCallLog, KHÔNG phải billing ledger (đó là
    # UsageRecord/"records" ở trên, không đổi gì). Sản phẩm strategy=credit
    # không đi qua gateway (vd đơn cũ trước khi có seller_gateway) sẽ đơn giản
    # có gateway_calls rỗng — vẫn None-safe, không phải lỗi.
    gateway_calls = await list_gateway_call_logs(order_id, db, limit=20)

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
        "gateway_calls": [
            {
                "id": c.id, "endpoint": c.endpoint, "status_code": c.status_code,
                "latency_ms": c.latency_ms, "request_payload": c.request_payload,
                "response_snippet": c.response_snippet, "error": c.error,
                "created_at": c.created_at,
            }
            for c in gateway_calls
        ],
    }
