"""Buyer proxy dashboard (/proxies): list proxy lines, tags, notes.

Một dòng = một ProxyAllocation của một đơn của buyer. Payload đúng shape
`ProxyLine` của frontend (docs/proxy-dashboard-api.md). Không bao giờ trả tên
nguồn hàng / adapter_type, không bao giờ trả row id: dòng là
`{order_code}#{line_no:02d}`, tag là `public_key`.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import and_, case, delete, exists, func, literal_column, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error
from src.models.order import Order, OrderStatus
from src.models.product import Product
from src.models.provider import Provider
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus, ProxyAllocationTag, ProxyTag
from src.proxies.kinds import IP_TYPES, ROTATIONS, classify, rotation_for

TAG_TONES = ("iris", "good", "warn", "neutral", "ink")
MAX_TAGS_PER_ACCOUNT = 100
SOON_DAYS = 3
_LINE_ID = re.compile(r"^(ORD-[0-9A-Z]{6,12})#(\d{1,3})$")
_VISIBLE_ORDER_STATUSES = (OrderStatus.delivered, OrderStatus.completed, OrderStatus.disputed, OrderStatus.refunded)


# ----------------------------------------------------------------------
# Snapshot lúc giao
# ----------------------------------------------------------------------

async def snapshot_line_kind(order: Order, product: Product | None, provider_id: int | None, db: AsyncSession) -> None:
    """Chốt loại proxy lên allocation của đơn vừa giao (gọi trong transaction
    giao hàng, orders/service.py). Không có allocation (không phải đơn proxy)
    → không làm gì. Đã chốt rồi (retry/replay) → giữ nguyên."""
    allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order.id))
    if allocation is None or allocation.ip_type is not None:
        return
    provider = await db.get(Provider, provider_id) if provider_id else None
    kind = classify(
        provider.adapter_type if provider else None, order.user_config, product.pricing_params if product else None,
        provider_mode=(provider.config or {}).get("mode") if provider else None,
    )
    allocation.ip_type = kind.ip_type
    allocation.rotation_kind = kind.rotation_kind
    allocation.protocol = kind.protocol
    allocation.country = kind.country
    allocation.network_label = (kind.network_label or None) and kind.network_label[:80]
    allocation.plan_days = kind.plan_days
    allocation.plan_label = (kind.plan_label or None) and kind.plan_label[:160]
    await db.flush()


# ----------------------------------------------------------------------
# Đọc
# ----------------------------------------------------------------------

def line_id(order: Order, line_no: int = 1) -> str:
    return f"{order.order_code}#{line_no:02d}"


def parse_line_id(value: str) -> str:
    """`ORD-XXXXXX#01` → order_code. Hiện mỗi đơn đúng một dòng (#01)."""
    m = _LINE_ID.match((value or "").strip().upper())
    if not m or int(m.group(2)) != 1:
        raise api_error(ErrorCode.PROXY_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return m.group(1)


def _credentials(order: Order, allocation: ProxyAllocation, rotation: str) -> tuple[str | None, int | None, str | None, str | None]:
    """host, port, username, password từ bản bàn giao đã snapshot trên đơn
    (đổi IP làm mới bản này). Key xoay: cổng cố định lưu ở external_proxy_id,
    xác thực bằng IP whitelist nên không có user/pass."""
    fields: dict[str, str] = {}
    for raw in (order.delivered_data or "").splitlines():
        key, sep, value = raw.partition(":")
        if sep:
            fields[key.strip().lower()] = value.strip()
    host = fields.get("host")
    port_raw = fields.get("port")
    if rotation == "rotating_key" and allocation.external_proxy_id and ":" in allocation.external_proxy_id:
        gw_host, _, gw_port = allocation.external_proxy_id.rpartition(":")
        host, port_raw = gw_host or host, gw_port or port_raw
    try:
        port = int(port_raw) if port_raw else None
    except ValueError:
        port = None
    username = fields.get("username") or None
    password = fields.get("password") or None
    if rotation == "rotating_key":
        username = password = None
    return host, port, username, password


def _serialize(order: Order, allocation: ProxyAllocation, product_title: str | None, tag_keys: list[str],
               adapter_type: str | None, product_params: dict | None, provider_mode: str | None = None) -> dict:
    ip_type, rotation_kind = allocation.ip_type, allocation.rotation_kind
    country, network, plan_days, plan_label, protocol = (
        allocation.country, allocation.network_label, allocation.plan_days, allocation.plan_label, allocation.protocol,
    )
    if ip_type is None:
        # Dòng giao trước khi có snapshot: phân loại lúc đọc từ gói đã chọn.
        kind = classify(adapter_type, order.user_config, product_params, provider_mode=provider_mode)
        ip_type, rotation_kind, country, network = kind.ip_type, kind.rotation_kind, kind.country, kind.network_label
        plan_days, plan_label, protocol = kind.plan_days, kind.plan_label, kind.protocol
    rotation = rotation_for(rotation_kind, bool(allocation.rotation_available))
    host, port, username, password = _credentials(order, allocation, rotation)
    status_value = allocation.status.value if hasattr(allocation.status, "value") else str(allocation.status)
    if status_value in ("allocated", "offline") and allocation.expires_at <= datetime.now(timezone.utc):
        status_value = "expired"
    return {
        "id": line_id(order),
        "order_code": order.order_code,
        "line_no": 1,
        "product_title": product_title or "",
        "variant_name": plan_label or "",
        "ip_type": ip_type,
        "rotation": rotation,
        "protocol": protocol or "HTTP",
        "network": network or "",
        "country": country,
        "host": host or "",
        "port": port or 0,
        "username": username,
        "password": password,
        "public_ip": allocation.last_public_ip,
        "status": status_value,
        "created_at": allocation.created_at.isoformat() if allocation.created_at else None,
        "expires_at": allocation.expires_at.isoformat(),
        "rotation_available": bool(allocation.rotation_available) and status_value == "allocated",
        "cooldown_seconds": allocation.cooldown_seconds,
        "last_rotated_at": allocation.last_rotated_at.isoformat() if allocation.last_rotated_at else None,
        "whitelist_supported": rotation == "rotating_key",
        "whitelist_ips": allocation.whitelist_ips,
        "socks5_port": None,
        "credentials_editable": False,
        "replaceable": False,
        "renew_mode": None,
        "plan_days": plan_days or 0,
        "last_check": None,
        "tag_ids": tag_keys,
        "note": allocation.note or "",
        "auto_renew_days": None,
    }


def _csv(value: str | None, allowed: tuple[str, ...] | None = None) -> list[str]:
    items = [v.strip() for v in (value or "").split(",") if v.strip()]
    return [v for v in items if allowed is None or v in allowed]


def _base_query(account_id: int):
    return (
        select(ProxyAllocation, Order, Product.title, Product.pricing_params, Provider.adapter_type,
               Provider.config["mode"].as_string())
        .join(Order, Order.id == ProxyAllocation.order_id)
        .outerjoin(Product, Product.id == Order.product_id)
        .outerjoin(Provider, Provider.id == ProxyAllocation.provider_id)
        .where(Order.buyer_id == account_id, Order.status.in_(_VISIBLE_ORDER_STATUSES))
    )


def _status_condition(tab: str, now: datetime):
    """Tab theo trạng thái HIỆU LỰC: dòng `allocated` đã quá `expires_at` là hết
    hạn dù job đối soát chưa kịp đánh dấu — tab, bộ đếm và nhãn đều theo đồng hồ."""
    live = and_(ProxyAllocation.status == ProxyAllocationStatus.allocated, ProxyAllocation.expires_at > now)
    if tab == "running":
        return live
    if tab == "soon":
        return and_(live, ProxyAllocation.expires_at <= now + timedelta(days=SOON_DAYS))
    if tab == "problem":
        return or_(
            ProxyAllocation.status.in_(
                [ProxyAllocationStatus.offline, ProxyAllocationStatus.error, ProxyAllocationStatus.expired],
            ),
            and_(ProxyAllocation.status == ProxyAllocationStatus.allocated, ProxyAllocation.expires_at <= now),
        )
    return None


_EXPIRY_HORIZONS = {"24h": timedelta(hours=24), "3d": timedelta(days=3), "7d": timedelta(days=7)}


def _ip_type_expr():
    # Dòng chưa snapshot (NULL) = residential, mặc định của classify().
    return func.coalesce(ProxyAllocation.ip_type, "residential")


def _rotation_expr():
    return case(
        (ProxyAllocation.rotation_kind == "rotating_key", "rotating_key"),
        (ProxyAllocation.rotation_available.is_(True), "rotating"),
        else_="static",
    )


def _filter_conditions(account_id: int, now: datetime, *, tab: str, q: str, tags: str, ip_type: str,
                       rotation: str, expires: str) -> dict:
    """Điều kiện theo TỪNG chiều lọc — tách riêng để đếm facet: số của một
    chiều = số dòng khớp mọi chiều khác (tab, tìm kiếm, tag, loại IP, đổi IP,
    thời hạn cùng lọc đồng thời, AND với nhau)."""
    conds: dict = {}
    cond = _status_condition(tab, now)
    if cond is not None:
        conds["status"] = cond
    needle = q.strip()
    if needle:
        like = f"%{needle}%"
        conds["q"] = or_(
            Order.order_code.ilike(like), Product.title.ilike(like), ProxyAllocation.last_public_ip.ilike(like),
            ProxyAllocation.plan_label.ilike(like), ProxyAllocation.network_label.ilike(like),
            ProxyAllocation.note.ilike(like),
            exists().where(
                ProxyAllocationTag.allocation_id == ProxyAllocation.id, ProxyAllocationTag.tag_id == ProxyTag.id,
                ProxyTag.account_id == account_id, ProxyTag.name.ilike(like),
            ),
        )
    ip_types = _csv(ip_type, IP_TYPES)
    if ip_types:
        conds["ip_type"] = _ip_type_expr().in_(ip_types)
    rotations = _csv(rotation, ROTATIONS)
    if rotations:
        conds["rotation"] = _rotation_expr().in_(rotations)
    tag_keys = _csv(tags)
    if tag_keys:
        parts = []
        real = [k for k in tag_keys if k != "__none__"]
        if real:
            parts.append(exists().where(
                ProxyAllocationTag.allocation_id == ProxyAllocation.id,
                ProxyAllocationTag.tag_id == ProxyTag.id,
                ProxyTag.public_key.in_(real), ProxyTag.account_id == account_id,
            ))
        if "__none__" in tag_keys:
            parts.append(~exists().where(ProxyAllocationTag.allocation_id == ProxyAllocation.id))
        conds["tags"] = or_(*parts)
    if expires == "expired":
        conds["expires"] = ProxyAllocation.expires_at <= now
    elif expires in _EXPIRY_HORIZONS:
        conds["expires"] = and_(ProxyAllocation.expires_at > now, ProxyAllocation.expires_at <= now + _EXPIRY_HORIZONS[expires])
    return conds


def _scope(account_id: int):
    """FROM + phạm vi buyer, dùng chung cho danh sách và mọi bộ đếm."""
    return (
        select(ProxyAllocation.id)
        .select_from(ProxyAllocation)
        .join(Order, Order.id == ProxyAllocation.order_id)
        .outerjoin(Product, Product.id == Order.product_id)
        .where(Order.buyer_id == account_id, Order.status.in_(_VISIBLE_ORDER_STATUSES))
    )


async def _facets(account_id: int, now: datetime, conds: dict, db: AsyncSession, *, status_only: bool = False) -> dict:
    def others(dim: str):
        return [c for k, c in conds.items() if k != dim]

    # Mỗi chiều: một truy vấn gộp COUNT … FILTER trên phạm vi đã lọc theo các chiều khác.
    async def counts(dim: str, buckets: dict) -> dict:
        stmt = _scope(account_id).where(*others(dim)).with_only_columns(
            *[func.count().filter(expr).label(name) for name, expr in buckets.items()],
        )
        row = (await db.execute(stmt)).one()
        return {name: int(row._mapping[name] or 0) for name in buckets}

    status_counts = await counts("status", {
        "all": literal_column("true"), "running": _status_condition("running", now), "soon": _status_condition("soon", now),
        "problem": _status_condition("problem", now),
    })
    if status_only:
        return {"status": status_counts}
    ip_counts = await counts("ip_type", {v: _ip_type_expr() == v for v in IP_TYPES})
    rotation_counts = await counts("rotation", {v: _rotation_expr() == v for v in ROTATIONS})
    expiry_counts = await counts("expires", {
        **{k: and_(ProxyAllocation.expires_at > now, ProxyAllocation.expires_at <= now + h) for k, h in _EXPIRY_HORIZONS.items()},
        "expired": ProxyAllocation.expires_at <= now,
    })
    scoped = _scope(account_id).where(*others("tags")).subquery()
    tag_rows = (await db.execute(
        select(ProxyTag.public_key, func.count(ProxyAllocationTag.allocation_id))
        .join(ProxyAllocationTag, ProxyAllocationTag.tag_id == ProxyTag.id)
        .where(ProxyTag.account_id == account_id, ProxyAllocationTag.allocation_id.in_(select(scoped.c.id)))
        .group_by(ProxyTag.public_key)
    )).all()
    untagged = int(await db.scalar(
        select(func.count()).select_from(scoped).where(
            ~exists().where(ProxyAllocationTag.allocation_id == scoped.c.id),
        )
    ) or 0)
    return {
        "status": status_counts, "ip_type": ip_counts, "rotation": rotation_counts, "expires": expiry_counts,
        "tags": {**{key: int(n) for key, n in tag_rows}, "__none__": untagged},
    }


async def list_lines(
    account_id: int, db: AsyncSession, *, tab: str = "", q: str = "", tags: str = "", ip_type: str = "",
    rotation: str = "", expires: str = "", sort: str = "expiry_asc", page: int = 1, per_page: int = 50,
) -> dict:
    now = datetime.now(timezone.utc)
    conds = _filter_conditions(account_id, now, tab=tab, q=q, tags=tags, ip_type=ip_type, rotation=rotation, expires=expires)

    # summary = toàn bộ dòng của buyer (không lọc); facets = số theo bộ lọc hiện tại.
    summary = await _facets(account_id, now, {}, db, status_only=True)
    facets = await _facets(account_id, now, conds, db)

    stmt = _base_query(account_id).where(*conds.values())
    total = int(await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    order_by = {
        "expiry_desc": (ProxyAllocation.expires_at.desc(), ProxyAllocation.id.desc()),
        "newest": (ProxyAllocation.created_at.desc(), ProxyAllocation.id.desc()),
        "line": (Order.order_code.asc(),),
    }.get(sort, (ProxyAllocation.expires_at.asc(), ProxyAllocation.id.asc()))
    per_page = per_page if per_page in (25, 50, 100) else 50
    page = max(page, 1)
    rows = (await db.execute(stmt.order_by(*order_by).offset((page - 1) * per_page).limit(per_page))).all()

    allocation_ids = [row[0].id for row in rows]
    tags_by_allocation: dict[int, list[str]] = {}
    if allocation_ids:
        for allocation_id, key in (await db.execute(
            select(ProxyAllocationTag.allocation_id, ProxyTag.public_key)
            .join(ProxyTag, ProxyTag.id == ProxyAllocationTag.tag_id)
            .where(ProxyAllocationTag.allocation_id.in_(allocation_ids))
            .order_by(ProxyTag.name)
        )).all():
            tags_by_allocation.setdefault(allocation_id, []).append(key)

    return {
        "items": [
            _serialize(order, allocation, title, tags_by_allocation.get(allocation.id, []), adapter_type, params, mode)
            for allocation, order, title, params, adapter_type, mode in rows
        ],
        "total": total, "page": page, "per_page": per_page,
        "summary": summary["status"],
        "facets": facets,
    }


async def _owned_allocations(account_id: int, line_ids: list[str], db: AsyncSession) -> list[tuple[ProxyAllocation, Order]]:
    codes = {parse_line_id(v) for v in line_ids}
    rows = (await db.execute(
        select(ProxyAllocation, Order).join(Order, Order.id == ProxyAllocation.order_id)
        .where(Order.buyer_id == account_id, Order.order_code.in_(codes), Order.status.in_(_VISIBLE_ORDER_STATUSES))
    )).all()
    if len(rows) != len(codes):
        # Một id không thuộc buyer → 404 cho cả lệnh, không tiết lộ dòng nào tồn tại.
        raise api_error(ErrorCode.PROXY_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return [(a, o) for a, o in rows]


async def set_note(account_id: int, line: str, note: str, db: AsyncSession) -> dict:
    [(allocation, order)] = await _owned_allocations(account_id, [line], db)
    allocation.note = note.strip()[:200]
    await db.commit()
    page = await list_lines(account_id, db, q=order.order_code, per_page=25)
    return next(item for item in page["items"] if item["order_code"] == order.order_code)


# ----------------------------------------------------------------------
# Tags
# ----------------------------------------------------------------------

def _tag_out(tag: ProxyTag, count: int = 0) -> dict:
    return {"id": tag.public_key, "name": tag.name, "tone": tag.tone,
            "created_at": tag.created_at.isoformat() if tag.created_at else None, "count": count}


def _clean_name(name: str) -> str:
    clean = " ".join((name or "").split())[:40]
    if not clean:
        raise api_error(ErrorCode.PROXY_TAG_INVALID, status.HTTP_422_UNPROCESSABLE_ENTITY, max=MAX_TAGS_PER_ACCOUNT)
    return clean


def _clean_tone(tone: str | None) -> str:
    return tone if tone in TAG_TONES else "neutral"


async def list_tags(account_id: int, db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        select(ProxyTag, func.count(ProxyAllocationTag.allocation_id))
        .outerjoin(ProxyAllocationTag, ProxyAllocationTag.tag_id == ProxyTag.id)
        .where(ProxyTag.account_id == account_id)
        .group_by(ProxyTag.id).order_by(ProxyTag.name)
    )).all()
    return [_tag_out(tag, int(count)) for tag, count in rows]


async def _owned_tag(account_id: int, key: str, db: AsyncSession) -> ProxyTag:
    tag = await db.scalar(select(ProxyTag).where(ProxyTag.public_key == key, ProxyTag.account_id == account_id))
    if tag is None:
        raise api_error(ErrorCode.PROXY_TAG_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return tag


async def _name_taken(account_id: int, name: str, db: AsyncSession, *, except_id: int | None = None) -> bool:
    stmt = select(ProxyTag.id).where(ProxyTag.account_id == account_id, func.lower(ProxyTag.name) == name.lower())
    if except_id is not None:
        stmt = stmt.where(ProxyTag.id != except_id)
    return (await db.scalar(stmt)) is not None


async def create_tag(account_id: int, name: str, tone: str | None, db: AsyncSession) -> dict:
    clean = _clean_name(name)
    if await _name_taken(account_id, clean, db):
        raise api_error(ErrorCode.PROXY_TAG_DUPLICATE, status.HTTP_409_CONFLICT)
    count = int(await db.scalar(select(func.count(ProxyTag.id)).where(ProxyTag.account_id == account_id)) or 0)
    if count >= MAX_TAGS_PER_ACCOUNT:
        raise api_error(ErrorCode.PROXY_TAG_INVALID, status.HTTP_422_UNPROCESSABLE_ENTITY, max=MAX_TAGS_PER_ACCOUNT)
    tag = ProxyTag(account_id=account_id, name=clean, tone=_clean_tone(tone))
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return _tag_out(tag)


async def update_tag(account_id: int, key: str, db: AsyncSession, *, name: str | None = None, tone: str | None = None) -> dict:
    tag = await _owned_tag(account_id, key, db)
    if name is not None:
        clean = _clean_name(name)
        if await _name_taken(account_id, clean, db, except_id=tag.id):
            raise api_error(ErrorCode.PROXY_TAG_DUPLICATE, status.HTTP_409_CONFLICT)
        tag.name = clean
    if tone is not None:
        tag.tone = _clean_tone(tone)
    await db.commit()
    await db.refresh(tag)
    return _tag_out(tag)


async def delete_tag(account_id: int, key: str, db: AsyncSession) -> None:
    tag = await _owned_tag(account_id, key, db)
    await db.delete(tag)
    await db.commit()


async def assign_tags(account_id: int, line_ids: list[str], add: list[str], remove: list[str], mode: str, db: AsyncSession) -> dict:
    pairs = await _owned_allocations(account_id, line_ids, db)
    keys = set(add) | set(remove)
    tags = {t.public_key: t for t in (await db.execute(
        select(ProxyTag).where(ProxyTag.account_id == account_id, ProxyTag.public_key.in_(keys))
    )).scalars()} if keys else {}
    if len(tags) != len(keys):
        raise api_error(ErrorCode.PROXY_TAG_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    allocation_ids = [a.id for a, _ in pairs]
    if mode == "replace":
        await db.execute(delete(ProxyAllocationTag).where(ProxyAllocationTag.allocation_id.in_(allocation_ids)))
    elif remove:
        await db.execute(delete(ProxyAllocationTag).where(
            ProxyAllocationTag.allocation_id.in_(allocation_ids),
            ProxyAllocationTag.tag_id.in_([tags[k].id for k in remove]),
        ))
    rows = [{"allocation_id": aid, "tag_id": tags[k].id} for aid in allocation_ids for k in add]
    if rows:
        await db.execute(pg_insert(ProxyAllocationTag.__table__).values(rows).on_conflict_do_nothing())
    await db.commit()
    return {"updated": len(allocation_ids)}
