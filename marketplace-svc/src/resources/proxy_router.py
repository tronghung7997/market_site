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
import ipaddress
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.base import RotatableProxyAdapter
from src.adapters.dproxy import DProxyAuthError, DProxyContractError, DProxyUnavailableError
from src.adapters.factory import get_adapter
from src.adapters.topproxy import TopProxyContractError, TopProxyKeyError, TopProxyUnavailableError
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
    # Kiểm tra theo NĂNG LỰC, không theo tên nhà cung cấp: TopProxy mode=xoay
    # cũng đổi IP được (lấy proxy mới bằng keyxoay), và mọi nhà cung cấp
    # rotatable sau này chỉ cần implement RotatableProxyAdapter là dùng chung
    # được toàn bộ phần khoá/cooldown/refresh bên dưới.
    if not isinstance(adapter, RotatableProxyAdapter):
        raise HTTPException(status_code=400, detail="Sản phẩm này không hỗ trợ đổi IP proxy")

    # Nhà cung cấp gắn quyền truy cập vào TỪNG lượt cấp proxy, không nhớ theo
    # key, nên IP buyer phải được gửi lại mỗi lần đổi. Chỉ thêm tham số khi
    # adapter thật sự hiểu nó — DProxy giữ nguyên chữ ký cũ.
    rotate_kwargs: dict = {}
    if getattr(adapter, "supports_ip_whitelist", False) and allocation.whitelist_ips:
        rotate_kwargs["whitelist"] = allocation.whitelist_ips

    try:
        # adapter.rotate_assignment rebuilds the call path itself from
        # `external_id` (src/adapters/dproxy.py::expected_rotate_path) —
        # allocation.rotate_path is metadata only, never trusted as an
        # actionable URL here.
        assignment = await adapter.rotate_assignment(allocation.external_id, **rotate_kwargs)
    except DProxyAuthError:
        logger.error("dproxy_rotate_auth_error", order_id=order_id, allocation_id=allocation.id)
        raise HTTPException(status_code=502, detail="Sai thông tin xác thực với nhà cung cấp proxy")
    except TopProxyKeyError as e:
        # Binding hỏng (key hết hạn/bị thu hồi), KHÔNG phải sự cố hạ tầng —
        # 400 để buyer hiểu là proxy của mình hết hiệu lực chứ không phải
        # "thử lại sau vài phút".
        logger.warning("topproxy_rotate_key_error", order_id=order_id, error=str(e))
        raise HTTPException(status_code=400, detail="Proxy của đơn này không còn hiệu lực — liên hệ hỗ trợ")
    except (DProxyUnavailableError, TopProxyUnavailableError):
        raise HTTPException(status_code=502, detail="Không thể kết nối nhà cung cấp proxy")
    except (DProxyContractError, TopProxyContractError):
        logger.error("proxy_rotate_contract_error", order_id=order_id, allocation_id=allocation.id)
        raise HTTPException(status_code=502, detail="Nhà cung cấp proxy trả về dữ liệu không hợp lệ")

    apply_rotated_assignment(allocation, assignment)
    allocation.last_rotated_at = now
    # Unconditional refresh — DProxy can rotate the password (or in
    # principle other fields) without moving the IP or expiry, and nothing
    # on ProxyAllocation tracks enough to detect that reliably. See review
    # fixes Blocker 1.
    # Mỗi adapter tự quyết bản chụp giao cho buyer: key xoay phải giấu keyxoay
    # và domain nhà cung cấp (phương án B1), trong khi DProxy giao thẳng
    # credential. Không có bản riêng thì dùng mặc định của assignment.
    render = getattr(adapter, "delivered_text_for", None)
    order.delivered_data = (
        render(assignment, allocation.whitelist_ips) if render else assignment.delivered_text()
    )
    await db.commit()

    logger.info("dproxy_rotated", order_id=order_id, allocation_id=allocation.id)
    return {
        "ok": True,
        "public_ip": assignment.public_ip,
        "last_rotated_at": allocation.last_rotated_at.isoformat(),
        "cooldown_seconds": allocation.cooldown_seconds,
        "expires_at": assignment.expires_at.isoformat(),
        # Buyer already owns these credentials (shown on /orders right after
        # delivery) — returning the fresh snapshot here lets the frontend
        # update in one round trip instead of a second GET, and covers
        # password-only rotates the other fields above don't capture (review
        # fixes docs/superpowers/plans/2026-07-22-dproxy-consolidated-review.md
        # P0 "Rotate cập nhật backend nhưng UI bàn giao bị stale").
        "delivered_data": order.delivered_data,
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

    # Chỉ mở phần khai báo IP khi nhà cung cấp thật sự có cơ chế đó — frontend
    # dựa vào cờ này để hiện/ẩn ô nhập, đơn DProxy không thấy gì thay đổi.
    whitelist_supported = False
    if order.provider_id:
        try:
            whitelist_supported = getattr(
                await get_adapter(order.provider_id, db), "supports_ip_whitelist", False,
            )
        except Exception:  # noqa: BLE001 — không dựng được adapter thì coi như không hỗ trợ
            whitelist_supported = False

    return {
        "status": allocation.status.value,
        "public_ip": allocation.last_public_ip,
        "whitelist_supported": whitelist_supported,
        "whitelist_ips": allocation.whitelist_ips,
        "expires_at": allocation.expires_at.isoformat(),
        "rotation_available": allocation.rotation_available and allocation.status == ProxyAllocationStatus.allocated,
        "cooldown_remaining_seconds": cooldown_remaining,
        "last_rotated_at": allocation.last_rotated_at.isoformat() if allocation.last_rotated_at else None,
    }


MAX_WHITELIST_IPS = 2  # đúng số ô nhà cung cấp cho (dashboard ?home=donhangxoay)


class ProxyWhitelistRequest(BaseModel):
    """IPv4 của buyer được phép kết nối tới proxy."""

    ips: list[str] = Field(default_factory=list, max_length=MAX_WHITELIST_IPS)


@router.put("/orders/{order_id}/proxy/whitelist")
async def set_proxy_whitelist(
    order_id: int,
    body: ProxyWhitelistRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    """Buyer khai báo IP được phép dùng proxy của đơn mình.

    Vì sao cần: nhà cung cấp key xoay khoá proxy theo IP gọi API. Phương án B1
    để SERVER mình gọi get.php thay buyer, nên mặc định chỉ IP server dùng
    được — buyer thấy proxy nối được TCP nhưng không phản hồi gì, trông y hệt
    "proxy chết". Khai báo IP xong là hết.

    Lưu xong thì lấy luôn một proxy mới kèm whitelist để nó có hiệu lực ngay,
    thay vì bắt buyer bấm thêm "Lấy proxy mới" rồi tự đoán đã ăn hay chưa.
    """
    order = await db.get(Order, order_id)
    if not order or order.buyer_id != account.id:
        # 404 chứ không 403 — không xác nhận sự tồn tại của đơn cho người lạ.
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.status not in (OrderStatus.delivered, OrderStatus.completed):
        raise HTTPException(status_code=400, detail="Đơn hàng này không còn ở trạng thái dùng được")
    if not order.provider_id:
        raise HTTPException(status_code=400, detail="Đơn hàng này chưa được cấp phát")

    cleaned: list[str] = []
    for raw in body.ips:
        text = (raw or "").strip()
        if not text:
            continue
        try:
            parsed = ipaddress.ip_address(text)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"“{text}” không phải địa chỉ IP hợp lệ")
        if parsed.version != 4:
            raise HTTPException(status_code=422, detail="Nhà cung cấp chỉ nhận IPv4")
        if str(parsed) not in cleaned:
            cleaned.append(str(parsed))
    if len(cleaned) > MAX_WHITELIST_IPS:
        raise HTTPException(status_code=422, detail=f"Tối đa {MAX_WHITELIST_IPS} địa chỉ IP")

    allocation = await db.scalar(
        select(ProxyAllocation).where(ProxyAllocation.order_id == order_id).with_for_update()
    )
    if allocation is None:
        raise HTTPException(status_code=404, detail="Đơn hàng này không có proxy")

    adapter = await get_adapter(order.provider_id, db)
    if not getattr(adapter, "supports_ip_whitelist", False):
        raise HTTPException(status_code=400, detail="Sản phẩm này không cần khai báo IP")

    allocation.whitelist_ips = ",".join(cleaned) or None

    # Áp dụng ngay bằng một lượt cấp proxy mới. Hỏng thì VẪN lưu khai báo —
    # lần "Lấy proxy mới" kế tiếp sẽ dùng, không bắt buyer nhập lại.
    applied = False
    if cleaned and isinstance(adapter, RotatableProxyAdapter):
        try:
            assignment = await adapter.rotate_assignment(
                allocation.external_id, whitelist=allocation.whitelist_ips,
            )
        except (TopProxyKeyError, TopProxyUnavailableError, TopProxyContractError) as e:
            logger.warning("proxy_whitelist_apply_failed", order_id=order_id, error=str(e))
        else:
            apply_rotated_assignment(allocation, assignment)
            allocation.last_rotated_at = datetime.now(timezone.utc)
            render = getattr(adapter, "delivered_text_for", None)
            order.delivered_data = (
                render(assignment, allocation.whitelist_ips) if render else assignment.delivered_text()
            )
            applied = True

    await db.commit()
    logger.info("proxy_whitelist_set", order_id=order_id, count=len(cleaned), applied=applied)
    return {
        "ok": True,
        "whitelist_ips": allocation.whitelist_ips,
        # `applied=False` nghĩa là đã lưu nhưng chưa kịp có hiệu lực (nhà cung
        # cấp đang lỗi, hoặc còn cooldown) — frontend nói rõ để buyer bấm "Lấy
        # proxy mới" sau, thay vì tưởng đã xong mà proxy vẫn câm.
        "applied": applied,
        "public_ip": allocation.last_public_ip,
        "delivered_data": order.delivered_data,
    }
