"""Theo dõi proxy tĩnh TopProxy: phát hiện khi nhà cung cấp đổi IP.

Mỗi proxy tĩnh có hai IP (xem `TopProxyAdapter._assignment_from_row`):

- **trung gian** (`host:port` buyer cầm, lưu ở `external_proxy_id`) — ổn định,
  nhà cung cấp giữ nguyên khi IP gốc đổi;
- **gốc** (`last_public_ip`) — IP thật đi ra, đổi theo nhà mạng.

`listproxy.php` là nguồn duy nhất cho cả hai (log "Proxy bị đổi" của họ chỉ có
trên web, không có API), nên job này poll một call mỗi `loaiproxy` rồi so với
giá trị đã lưu:

- IP gốc đổi → ghi `proxy_ip_changes(kind="origin")`, cập nhật
  `previous_public_ip` / `public_ip_changed_at` để dashboard hiện "IP trước";
  buyer không phải làm gì.
- Cổng vào trung gian đổi (họ nói không xảy ra, đây là lưới an toàn) → viết lại
  Host/Port trong bản bàn giao của dòng, ghi `kind="front"` và báo admin.

Dòng giao trước khi có job (`external_proxy_id` NULL; `last_public_ip` khi đó
là IP trung gian) được chốt mốc lần đầu, KHÔNG ghi thành "đã đổi".
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts.service import fp_order, upsert_incident
from src.database import SessionLocal, id_in
from src.models.order import Order
from src.models.provider import Provider
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus, ProxyIpChange
from src.resources.proxy_service import set_line_delivery

logger = structlog.get_logger()


def with_front(text: str, host: str, port: int) -> str:
    """Bản bàn giao với Host/Port thay bằng cổng vào mới; các dòng khác giữ nguyên."""
    out = []
    for raw in text.splitlines():
        key = raw.partition(":")[0].strip().lower()
        out.append(f"Host: {host}" if key == "host" else f"Port: {port}" if key == "port" else raw)
    return "\n".join(out)


async def apply_snapshots(
    db: AsyncSession, allocation_ids: list[int], snapshots: dict, now: datetime,
) -> dict[str, int]:
    """So từng dòng với snapshot hiện tại của nhà cung cấp, ghi lại thay đổi.
    Không commit — caller sở hữu transaction. Dòng vắng trong snapshot được
    bỏ qua (một response thiếu không được suy ra là proxy biến mất)."""
    result = {"checked": 0, "baselined": 0, "origin_changed": 0, "front_changed": 0}
    if not allocation_ids:
        return result
    allocations = list((await db.execute(
        select(ProxyAllocation).where(id_in(ProxyAllocation.id, allocation_ids)).with_for_update()
    )).scalars())
    for allocation in allocations:
        snap = snapshots.get(allocation.external_id)
        if snap is None or allocation.status not in (ProxyAllocationStatus.allocated, ProxyAllocationStatus.offline):
            continue
        result["checked"] += 1
        front = f"{snap.front_host}:{snap.front_port}"

        if allocation.external_proxy_id is None:
            allocation.external_proxy_id = front
            if snap.origin_ip:
                allocation.last_public_ip = snap.origin_ip
            result["baselined"] += 1
            continue

        if allocation.external_proxy_id != front:
            await _front_changed(db, allocation, front, snap, now)
            result["front_changed"] += 1

        if snap.origin_ip and snap.origin_ip != allocation.last_public_ip:
            old = allocation.last_public_ip
            allocation.last_public_ip = snap.origin_ip
            if old:
                allocation.previous_public_ip = old
                allocation.public_ip_changed_at = now
                allocation.public_ip_change_count = (allocation.public_ip_change_count or 0) + 1
                db.add(ProxyIpChange(
                    allocation_id=allocation.id, kind="origin", old_value=old, new_value=snap.origin_ip, detected_at=now,
                ))
                result["origin_changed"] += 1
                logger.info("topproxy_origin_ip_changed", allocation_id=allocation.id, order_id=allocation.order_id)
    await db.flush()
    return result


async def _front_changed(db: AsyncSession, allocation: ProxyAllocation, front: str, snap, now: datetime) -> None:
    old = allocation.external_proxy_id or ""
    allocation.external_proxy_id = front
    db.add(ProxyIpChange(
        allocation_id=allocation.id, kind="front", old_value=old[:64], new_value=front[:64], detected_at=now,
    ))
    order = await db.get(Order, allocation.order_id)
    if order is not None:
        # `delivered_data` is deferred; the line's own text is what we rewrite,
        # set_line_delivery recomposes the order text from every line.
        text = allocation.delivered_text or await db.scalar(
            select(Order.delivered_data).where(Order.id == order.id)
        )
        if text:
            await set_line_delivery(order, allocation, with_front(text, snap.front_host, snap.front_port), db)
    await upsert_incident(
        db,
        fingerprint=fp_order(allocation.order_id, "topproxy_front_changed"),
        type_="topproxy_front_changed",
        severity="warning",
        target_type="order",
        target_id=allocation.order_id,
        message=(
            f"Đơn #{allocation.order_id} (proxy {allocation.external_id}): nhà cung cấp đổi proxy trung gian — "
            f"đã viết lại host/port trong bản bàn giao, kiểm tra khách có cần được báo không"
        ),
    )
    logger.warning("topproxy_front_changed", allocation_id=allocation.id, order_id=allocation.order_id)


async def _watched(db: AsyncSession, provider_id: int, now: datetime) -> dict[str, list[int]]:
    """Dòng còn hạn của provider, gom theo `loaiproxy` của gói đã mua."""
    rows = (await db.execute(
        select(ProxyAllocation.id, Order.user_config["network"].as_string())
        .join(Order, Order.id == ProxyAllocation.order_id)
        .where(
            ProxyAllocation.provider_id == provider_id,
            ProxyAllocation.status.in_([ProxyAllocationStatus.allocated, ProxyAllocationStatus.offline]),
            ProxyAllocation.expires_at > now,
        )
    )).all()
    groups: dict[str, list[int]] = defaultdict(list)
    for allocation_id, loaiproxy in rows:
        if loaiproxy:
            groups[loaiproxy].append(allocation_id)
    return groups


async def topproxy_ip_watch_job() -> None:
    """Scheduler job: một call `listproxy.php` mỗi (provider static, loaiproxy)
    đang có dòng còn hạn, rồi `apply_snapshots`."""
    from src.adapters.factory import get_adapter
    from src.adapters.topproxy import (
        STATIC_LOAIPROXY, TopProxyAdapter, TopProxyContractError, TopProxyUnavailableError,
    )

    async with SessionLocal() as db:
        providers = list((await db.execute(
            select(Provider).where(Provider.adapter_type == "topproxy", Provider.is_active)
        )).scalars())
        for provider in providers:
            try:
                adapter = await get_adapter(provider.id, db)
            except ValueError:
                continue
            if not isinstance(adapter, TopProxyAdapter) or adapter.mode != "static":
                continue
            now = datetime.now(timezone.utc)
            groups = await _watched(db, provider.id, now)
            # No pooled connection held while waiting on the supplier.
            await db.commit()
            for loaiproxy, ids in groups.items():
                if loaiproxy not in STATIC_LOAIPROXY:
                    continue
                try:
                    snapshots = await adapter.list_static_snapshots(loaiproxy)
                except (TopProxyUnavailableError, TopProxyContractError) as exc:
                    logger.warning(
                        "topproxy_ip_watch_failed", provider_id=provider.id, loaiproxy=loaiproxy,
                        error_type=type(exc).__name__,
                    )
                    continue
                summary = await apply_snapshots(db, ids, snapshots, now)
                await db.commit()
                logger.info("topproxy_ip_watch", provider_id=provider.id, loaiproxy=loaiproxy, **summary)
