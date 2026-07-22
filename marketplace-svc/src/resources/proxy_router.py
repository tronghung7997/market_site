"""Buyer-authorized DProxy IP rotation. See
docs/superpowers/specs/2026-07-22-dproxy-integration.md Task 5.

Deliberately its own route (`/orders/{id}/proxy/rotate`), not overloaded
onto `/orders/{id}/gateway-key/rotate` (src/gateway/router.py) — that one
replaces a platform-minted access key for the seller_gateway metered-forward
lifecycle; this one asks DProxy to change the upstream IP of an already-
delivered proxy assignment. Different resource, different authorization
shape (cooldown, rotation_available, expiry), different failure modes —
conflating the two names would make an error on one read as if it were
about the other.
"""
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.dproxy import DProxyAdapter, DProxyAuthError, DProxyContractError, DProxyUnavailableError
from src.adapters.factory import get_adapter
from src.auth.dependencies import get_current_account
from src.database import get_session
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus
from src.resources.proxy_service import apply_rotated_assignment

logger = structlog.get_logger()

router = APIRouter(tags=["proxy"])


@router.post("/orders/{order_id}/proxy/rotate")
async def rotate_proxy(
    order_id: int,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    order = await db.get(Order, order_id)
    if not order or order.buyer_id != account.id:
        # 404, not 403 — do not confirm order existence to a non-owner.
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.status not in (OrderStatus.delivered, OrderStatus.completed):
        raise HTTPException(status_code=400, detail="Đơn hàng này không còn ở trạng thái dùng được")
    if not order.provider_id:
        raise HTTPException(status_code=400, detail="Đơn hàng này chưa được cấp phát")

    # Locked for the duration: two simultaneous clicks on the same
    # allocation must not both pass the cooldown check and both reach
    # DProxy — the second waits for the first's commit, then sees the
    # refreshed last_rotated_at.
    allocation = await db.scalar(
        select(ProxyAllocation).where(ProxyAllocation.order_id == order_id).with_for_update()
    )
    if allocation is None or allocation.status != ProxyAllocationStatus.allocated:
        raise HTTPException(status_code=400, detail="Đơn hàng này không có proxy đang hoạt động")

    now = datetime.now(timezone.utc)
    if allocation.expires_at <= now:
        raise HTTPException(status_code=400, detail="Proxy đã hết hạn")
    if not allocation.rotation_available:
        raise HTTPException(status_code=400, detail="Proxy này không hỗ trợ đổi IP")

    if allocation.cooldown_seconds and allocation.last_rotated_at:
        elapsed = (now - allocation.last_rotated_at).total_seconds()
        remaining = allocation.cooldown_seconds - elapsed
        if remaining > 0:
            retry_after = int(remaining) + 1
            # Plain string detail (not a dict) to match this API's convention
            # (src/lib/api.ts::request only surfaces `detail` when it's a
            # string) — the wait time is in the message itself; a structured
            # countdown is available separately via GET /orders/{id}/proxy's
            # cooldown_remaining_seconds. Retry-After header for any HTTP-
            # level client that respects it.
            raise HTTPException(
                status_code=429,
                detail=f"Vui lòng chờ {retry_after} giây trước khi đổi IP tiếp",
                headers={"Retry-After": str(retry_after)},
            )

    adapter = await get_adapter(order.provider_id, db)
    if not isinstance(adapter, DProxyAdapter):
        raise HTTPException(status_code=400, detail="Sản phẩm này không hỗ trợ đổi IP proxy")

    try:
        # adapter.rotate_assignment rebuilds the call path itself from
        # `external_id` (src/adapters/dproxy.py::expected_rotate_path) —
        # allocation.rotate_path is metadata only, never trusted as an
        # actionable URL here.
        assignment = await adapter.rotate_assignment(allocation.external_id)
    except DProxyAuthError:
        logger.error("dproxy_rotate_auth_error", order_id=order_id, allocation_id=allocation.id)
        raise HTTPException(status_code=502, detail="Sai thông tin xác thực với nhà cung cấp proxy")
    except DProxyUnavailableError:
        raise HTTPException(status_code=502, detail="Không thể kết nối nhà cung cấp proxy")
    except DProxyContractError:
        logger.error("dproxy_rotate_contract_error", order_id=order_id, allocation_id=allocation.id)
        raise HTTPException(status_code=502, detail="Nhà cung cấp proxy trả về dữ liệu không hợp lệ")

    apply_rotated_assignment(allocation, assignment)
    allocation.last_rotated_at = now
    # Unconditional refresh — DProxy can rotate the password (or in
    # principle other fields) without moving the IP or expiry, and nothing
    # on ProxyAllocation tracks enough to detect that reliably. See review
    # fixes Blocker 1.
    order.delivered_data = assignment.delivered_text()
    await db.commit()

    logger.info("dproxy_rotated", order_id=order_id, allocation_id=allocation.id)
    return {
        "ok": True,
        "public_ip": assignment.public_ip,
        "last_rotated_at": allocation.last_rotated_at.isoformat(),
        "cooldown_seconds": allocation.cooldown_seconds,
        "expires_at": assignment.expires_at.isoformat(),
    }


@router.get("/orders/{order_id}/proxy")
async def get_proxy_state(
    order_id: int,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    """Sanitized state for the buyer dashboard (Task 6) — never exposes
    rotate_path, provider base_url/API key, or the internal allocation id."""
    order = await db.get(Order, order_id)
    if not order or order.buyer_id != account.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")

    allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
    if allocation is None:
        raise HTTPException(status_code=404, detail="Đơn hàng này không có proxy")

    now = datetime.now(timezone.utc)
    cooldown_remaining = 0
    if allocation.cooldown_seconds and allocation.last_rotated_at:
        elapsed = (now - allocation.last_rotated_at).total_seconds()
        cooldown_remaining = max(0, int(allocation.cooldown_seconds - elapsed))

    return {
        "status": allocation.status.value,
        "public_ip": allocation.last_public_ip,
        "expires_at": allocation.expires_at.isoformat(),
        "rotation_available": allocation.rotation_available and allocation.status == ProxyAllocationStatus.allocated,
        "cooldown_remaining_seconds": cooldown_remaining,
        "last_rotated_at": allocation.last_rotated_at.isoformat() if allocation.last_rotated_at else None,
    }
