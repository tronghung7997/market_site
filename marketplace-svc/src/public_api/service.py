"""Public buyer sales API: key management, key authentication and the `/v1`
operations.

It is a thin layer over the storefront checkout: an API order goes through
the same calls as the web's `POST /orders` — `orders.service.create_order`
for a package (`variant`), `create_order_with_adapter` for a product bought
with options (`products.api_sale` builds the web form's `user_config`) —
so wallet debit, escrow, provisioning and short-delivery refunds are the
storefront's own. Quotes go through `orders.service.quote_order`, delivered
goods are read through `orders.delivery`, and a gateway key is rotated by
`gateway.service.rotate_order_gateway_key`. What this module adds is only what an unattended client
needs: a hashed per-buyer key, admin switches (`accounts.api_access_enabled`,
`products.api_enabled`), IP allowlists, scopes, a per-key daily spend cap and
optional `Idempotency-Key` replay.

Transactions: the idempotency row (with the order's expected (quoted) total reserved
against the key's daily cap, under a lock on the key row) is committed
before checkout, so a concurrent retry sees the request in flight and the
cap holds even though checkout commits on its own. A failed checkout deletes
the row, so the same key may be retried once the cause is fixed.
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.database import SessionLocal, id_in
from src.common.pagination import decode_cursor, encode_cursor, keyset_after
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.models.account import Account
from src.models.api_key import ApiIdempotency, ApiKey
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductStatus, ProductVariant
from src.orders import service as orders_service
from src.orders.constants import MAX_ORDER_QUANTITY
from src.gateway.service import rotate_order_gateway_key
from src.i18n.catalog import resolve_product_fields, resolve_variant_fields
from src.i18n.slug import parse_public_ref
from src.models.provider import Provider
from src.models.proxy_allocation import ProxyAllocationStatus
from src.orders.delivery import DeliverySummary, delivered_data_of, delivered_lines, delivery_summary
from src.orders.service import gateway_access_from_delivery_data
from src.resources.proxy_service import list_order_allocations
from src.products.api_sale import build_user_config, option_fields, product_kind, sale_profile
from src.products.service import api_catalog
from src.public_api.errors import PublicApiError
from src.site_status import require_orders_open
from src.wallet.service import get_wallet_by_account

KEY_PREFIX = "pk_live_"
MAX_ACTIVE_KEYS = 10
CURRENCY = "VND"
IDEMPOTENCY_TTL = timedelta(hours=24)
IDEMPOTENCY_KEY_MAX = 128
# Goods returned inline by GET /v1/orders/{order}; bigger orders are cut and flagged.
ORDER_ITEMS_MAX_LINES = 1_000
ORDER_ITEMS_MAX_BYTES = 5 * 1024 * 1024
LIST_LIMIT_MAX = 100
# last_used_* is rewritten at most this often per key (and whenever the IP changes).
_LAST_USED_RESOLUTION = timedelta(seconds=60)
_VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
# `?wait=` on POST /v1/orders (default) and GET /v1/orders/{order} (default 0):
# hold the response until provisioning settles, at most this many seconds.
ORDER_WAIT_DEFAULT_SECONDS = 25
ORDER_WAIT_MAX_SECONDS = 30
# Concurrent waiting requests per key (this process); beyond it, answer at once.
ORDER_WAITERS_PER_KEY = 5
_WAIT_POLL_SECONDS = 0.5
_waiters: dict[int, int] = {}
_IN_FLIGHT = (OrderStatus.pending, OrderStatus.processing)

_STATUS_MAP = {
    OrderStatus.pending: "processing",
    OrderStatus.processing: "processing",
    OrderStatus.delivered: "delivered",
    OrderStatus.completed: "completed",
    OrderStatus.disputed: "disputed",
    OrderStatus.refunded: "refunded",
    OrderStatus.cancelled: "failed",
}


def hash_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def _new_key() -> tuple[str, str]:
    prefix = secrets.token_hex(4)
    return prefix, f"{KEY_PREFIX}{prefix}_{secrets.token_urlsafe(32)}"


def _vn_day_start(now: datetime | None = None) -> datetime:
    local = (now or datetime.now(timezone.utc)).astimezone(_VN_TZ)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


async def spent_today(db: AsyncSession, key_ids: list[int]) -> dict[int, int]:
    """VND charged today (Vietnam day) per key: what its orders kept (total
    minus refunds) plus the reservations of requests still in flight."""
    if not key_ids:
        return {}
    amount = case(
        (ApiIdempotency.order_id.is_(None), ApiIdempotency.reserved_amount),
        else_=func.coalesce(Order.total_amount - Order.refunded_amount, 0),
    )
    rows = await db.execute(
        select(ApiIdempotency.api_key_id, func.coalesce(func.sum(amount), 0))
        .outerjoin(Order, Order.id == ApiIdempotency.order_id)
        .where(ApiIdempotency.api_key_id.in_(key_ids), ApiIdempotency.created_at >= _vn_day_start())
        .group_by(ApiIdempotency.api_key_id)
    )
    return {key_id: int(total) for key_id, total in rows.all()}


# ── Buyer key management (session) ───────────────────────────────────────────

def _key_row(key: ApiKey, spent: int = 0) -> dict:
    return {
        "id": key.id, "name": key.name, "prefix": key.prefix, "scopes": list(key.scopes or []),
        "allowed_ips": key.allowed_ips, "daily_spend_limit": key.daily_spend_limit, "spent_today": spent,
        "last_used_at": key.last_used_at, "last_used_ip": key.last_used_ip,
        "revoked_at": key.revoked_at, "created_at": key.created_at,
    }


def _require_api_access(account: Account) -> None:
    if not account.api_access_enabled:
        raise api_error(ErrorCode.API_ACCESS_DISABLED, status.HTTP_403_FORBIDDEN)
    if account.email_verified_at is None:
        raise api_error(ErrorCode.EMAIL_NOT_VERIFIED, status.HTTP_403_FORBIDDEN)


async def list_keys(account: Account, db: AsyncSession) -> dict:
    keys = list((await db.execute(
        select(ApiKey).where(ApiKey.account_id == account.id, ApiKey.revoked_at.is_(None)).order_by(ApiKey.id.desc())
    )).scalars())
    spent = await spent_today(db, [k.id for k in keys])
    return {
        "enabled": bool(account.api_access_enabled),
        "email_verified": account.email_verified_at is not None,
        "max_active": MAX_ACTIVE_KEYS,
        "items": [_key_row(k, spent.get(k.id, 0)) for k in keys],
    }


async def create_key(
    account: Account, db: AsyncSession, *, name: str, scopes: list[str],
    allowed_ips: list[str] | None, daily_spend_limit: int | None,
) -> dict:
    _require_api_access(account)
    # Serialise creations per account so the active-key cap holds.
    await db.execute(select(Account.id).where(Account.id == account.id).with_for_update())
    active = await db.scalar(
        select(func.count(ApiKey.id)).where(ApiKey.account_id == account.id, ApiKey.revoked_at.is_(None))
    ) or 0
    if active >= MAX_ACTIVE_KEYS:
        raise api_error(ErrorCode.API_KEY_LIMIT, status.HTTP_409_CONFLICT, max=MAX_ACTIVE_KEYS)
    prefix, plaintext = _new_key()
    key = ApiKey(
        account_id=account.id, name=name, prefix=prefix, key_hash=hash_key(plaintext), scopes=scopes,
        allowed_ips=allowed_ips, daily_spend_limit=daily_spend_limit,
    )
    db.add(key)
    await db.flush()
    await log_event(
        db, "info", f"API key {prefix} created for account {account.id}", request_id=current_request_id(),
        metadata={
            "event": "api_key_created", "actor_id": account.id, "actor_type": "buyer",
            "subject_type": "account", "subject_id": account.id, "outcome": "success", "source": "account",
            "api_key_id": key.id, "prefix": prefix, "scopes": scopes, "allowed_ips": allowed_ips,
            "daily_spend_limit": daily_spend_limit,
        },
    )
    await db.commit()
    await db.refresh(key)
    return {**_key_row(key), "key": plaintext}


async def _owned_key(account_id: int, key_id: int, db: AsyncSession) -> ApiKey:
    key = await db.scalar(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.account_id == account_id, ApiKey.revoked_at.is_(None))
        .with_for_update()
    )
    if key is None:
        raise api_error(ErrorCode.API_KEY_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return key


async def update_key(account: Account, key_id: int, changes: dict, db: AsyncSession) -> dict:
    key = await _owned_key(account.id, key_id, db)
    before = {field: getattr(key, field) for field in changes}
    for field, value in changes.items():
        if field == "name":
            value = (value or "").strip() or key.name
        setattr(key, field, value)
    await log_event(
        db, "info", f"API key {key.prefix} updated", request_id=current_request_id(),
        metadata={
            "event": "api_key_updated", "actor_id": account.id, "actor_type": "buyer",
            "subject_type": "account", "subject_id": account.id, "outcome": "success", "source": "account",
            "api_key_id": key.id, "before": jsonable_encoder(before), "after": jsonable_encoder(changes),
        },
    )
    await db.commit()
    await db.refresh(key)
    spent = await spent_today(db, [key.id])
    return _key_row(key, spent.get(key.id, 0))


async def revoke_key(account: Account, key_id: int, db: AsyncSession) -> None:
    key = await _owned_key(account.id, key_id, db)
    key.revoked_at = datetime.now(timezone.utc)
    await log_event(
        db, "warning", f"API key {key.prefix} revoked", request_id=current_request_id(),
        metadata={
            "event": "api_key_revoked", "actor_id": account.id, "actor_type": "buyer",
            "subject_type": "account", "subject_id": account.id, "outcome": "success", "source": "account",
            "api_key_id": key.id, "prefix": key.prefix,
        },
    )
    await db.commit()


# ── Key authentication (/v1) ──────────────────────────────────────────────────

@dataclass(frozen=True)
class ApiCaller:
    key_id: int
    account_id: int
    scopes: tuple[str, ...]
    daily_spend_limit: int | None
    # Buyer tier (l1/l2/l3): picks the per-key limits per minute (router).
    buyer_tier: str = "l1"


def _ip_allowed(ip: str, allowed: list[str] | None) -> bool:
    if not allowed:
        return True
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for entry in allowed:
        try:
            if address in ipaddress.ip_network(entry, strict=False):
                return True
        except ValueError:
            continue
    return False


def invalid_key() -> PublicApiError:
    return PublicApiError("invalid_api_key", status.HTTP_401_UNAUTHORIZED, "Missing or invalid API key.",
                          headers={"WWW-Authenticate": "Bearer"})


async def authenticate(plaintext: str | None, ip: str, scope: str, db: AsyncSession) -> ApiCaller:
    """Resolve a `pk_live_…` key to its buyer and check every gate. Updates
    `last_used_*` (at most once a minute per key and IP) and commits."""
    if not plaintext or not plaintext.startswith(KEY_PREFIX) or len(plaintext) > 128:
        raise invalid_key()
    row = (await db.execute(
        select(ApiKey, Account).join(Account, Account.id == ApiKey.account_id)
        .where(ApiKey.key_hash == hash_key(plaintext))
    )).first()
    if row is None or row[0].revoked_at is not None:
        raise invalid_key()
    key, account = row
    if not account.is_active or account.is_seeded:
        raise invalid_key()
    if not account.api_access_enabled:
        raise PublicApiError("api_access_disabled", status.HTTP_403_FORBIDDEN,
                             "API access is suspended for this account.")
    if account.email_verified_at is None:
        raise PublicApiError("api_access_disabled", status.HTTP_403_FORBIDDEN,
                             "Confirm the account email address before using the API.")
    if not _ip_allowed(ip, key.allowed_ips):
        raise PublicApiError("ip_not_allowed", status.HTTP_403_FORBIDDEN,
                             "This API key cannot be used from your IP address.")
    if scope not in (key.scopes or []):
        raise PublicApiError("forbidden_scope", status.HTTP_403_FORBIDDEN,
                             f"This API key lacks the {scope} scope.")
    now = datetime.now(timezone.utc)
    if key.last_used_at is None or key.last_used_ip != ip or now - key.last_used_at > _LAST_USED_RESOLUTION:
        await db.execute(
            update(ApiKey).where(ApiKey.id == key.id).values(last_used_at=now, last_used_ip=ip[:45])
        )
        await db.commit()
    return ApiCaller(
        key_id=key.id, account_id=account.id, scopes=tuple(key.scopes or ()),
        daily_spend_limit=key.daily_spend_limit, buyer_tier=account.buyer_tier or "l1",
    )


# ── /v1 operations ────────────────────────────────────────────────────────────

async def me(caller: ApiCaller, db: AsyncSession) -> dict:
    wallet = await get_wallet_by_account(caller.account_id, db)
    spent = (await spent_today(db, [caller.key_id])).get(caller.key_id, 0)
    from src.buyer_tiers.config import get_config, level_of

    level = level_of(await get_config(db), caller.buyer_tier)
    return {
        "balance": wallet.available_balance, "currency": CURRENCY,
        "daily_spend_limit": caller.daily_spend_limit, "spent_today": spent,
        "tier": caller.buyer_tier,
        "requests_per_minute": level["api_requests_per_minute"],
        "orders_per_minute": level["api_orders_per_minute"],
    }


async def products(db: AsyncSession, *, locale: str) -> dict:
    return {"currency": CURRENCY, "items": await api_catalog(db, locale=locale)}


def _product_not_available() -> PublicApiError:
    return PublicApiError("product_not_available", status.HTTP_404_NOT_FOUND,
                          "This product does not exist or is not sold through the API.")


async def _api_product(product_ref: str, db: AsyncSession) -> Product:
    """An active, API-enabled product by its public `slug-key` (never a row id)."""
    ref = parse_public_ref(product_ref or "")
    if ref is None or ref[0] != "key":
        raise _product_not_available()
    product = await db.scalar(select(Product).where(Product.public_key == ref[1]))
    if product is None or product.status != ProductStatus.active or not product.api_enabled:
        raise _product_not_available()
    return product


async def product_detail(product_ref: str, db: AsyncSession, *, locale: str) -> dict:
    product = await _api_product(product_ref, db)
    items = await api_catalog(db, locale=locale, product=product)
    if not items:
        raise _product_not_available()
    return items[0]


# ── Order payloads ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class _OrderRefs:
    product: str | None
    product_title: str | None
    variant: str | None
    variant_name: str | None
    kind: str
    # The provider `kind` was read from (the order's own, else its product's)
    # and the product's at that time: tells whether the refs still hold once
    # provisioning has stamped `order.provider_id` (a fallback may differ).
    provider_id: int | None = None
    product_provider_id: int | None = None

    def holds_for(self, order: Order) -> bool:
        return (order.provider_id or self.product_provider_id) == self.provider_id


async def _order_refs(orders: list[Order], db: AsyncSession, locale: str) -> dict[int, _OrderRefs]:
    """Product, package and kind of each order, in one statement."""
    if not orders:
        return {}
    rows = (await db.execute(
        select(Order.id, Order.provider_id, Product, ProductVariant, Provider.adapter_type)
        .select_from(Order)
        .outerjoin(Product, Product.id == Order.product_id)
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .outerjoin(Provider, Provider.id == func.coalesce(Order.provider_id, Product.provider_id))
        .where(id_in(Order.id, [o.id for o in orders]))
    )).all()
    out: dict[int, _OrderRefs] = {}
    for order_id, order_provider_id, product, variant, adapter_type in rows:
        out[order_id] = _OrderRefs(
            product=f"{product.slug}-{product.public_key}" if product else None,
            product_title=resolve_product_fields(product, locale)["title"] if product else None,
            variant=variant.public_key if variant else None,
            variant_name=resolve_variant_fields(variant, locale)["name"] if variant else None,
            kind=product_kind(
                product.service_type if product else None,
                product.pricing_strategy if product else None,
                adapter_type,
            ),
            provider_id=order_provider_id or (product.provider_id if product else None),
            product_provider_id=product.provider_id if product else None,
        )
    return out


async def _order_bodies(
    orders: list[Order], db: AsyncSession, *, locale: str, refs: dict[int, _OrderRefs] | None = None,
) -> tuple[list[dict], dict[int, _OrderRefs], dict[int, DeliverySummary]]:
    """The list payload of each order, plus the refs and delivery summaries
    it was built from (``order_detail`` reuses them for the items)."""
    if refs is None or any(o.id not in refs or not refs[o.id].holds_for(o) for o in orders):
        refs = await _order_refs(orders, db, locale)
    summaries = await delivery_summary([o.id for o in orders], db)
    out = []
    for order in orders:
        summary = summaries[order.id]
        if summary.from_resources:
            delivered = summary.delivered_lines
        else:
            delivered = order.quantity if summary.has_text else 0
        ref = refs[order.id]
        out.append({
            "order": order.order_code, "status": _STATUS_MAP.get(order.status, order.status.value),
            "kind": ref.kind, "product": ref.product, "product_title": ref.product_title,
            "variant": ref.variant, "variant_name": ref.variant_name, "quantity": order.quantity,
            "delivered_quantity": delivered, "total": order.total_amount,
            "refunded_amount": order.refunded_amount, "currency": CURRENCY, "created_at": order.created_at,
        })
    return out, refs, summaries


async def _order_payloads(orders: list[Order], db: AsyncSession, *, locale: str) -> list[dict]:
    payloads, _, _ = await _order_bodies(orders, db, locale=locale)
    return payloads


def _may_have_proxy_lines(order: Order, ref: _OrderRefs, summary: DeliverySummary) -> bool:
    """Only proxy-source adapters (DProxy, TopProxy) bind `proxy_allocations`,
    and they never deliver stock lines. An order whose provider is known and
    is not a proxy source has none; one not provisioned yet (no
    `order.provider_id`, a fallback may still serve it) is checked."""
    if summary.from_resources:
        return False
    return ref.kind == "proxy" or order.provider_id is None


async def order_detail(
    order: Order, db: AsyncSession, *, locale: str = "en", refs: dict[int, _OrderRefs] | None = None,
) -> dict:
    [payload], refs, summaries = await _order_bodies([order], db, locale=locale, refs=refs)
    summary = summaries[order.id]
    if order.gateway_key_hash is not None:
        # A request package: the buyer calls /gw/{key}/<endpoint>. The key is
        # read from the hand-over text, exactly as the order page shows it.
        access = gateway_access_from_delivery_data(await delivered_data_of(order, db))
        gateway = {"url": access["url"], "key": access["key"], "key_hint": order.gateway_key_prefix} if access else None
        return {**payload, "items": None, "items_truncated": None, "gateway": gateway}
    if _may_have_proxy_lines(order, refs[order.id], summary):
        proxies = [
            a for a in await list_order_allocations(order.id, db)
            if a.status != ProxyAllocationStatus.released and a.delivered_text
        ]
        if proxies:
            # One item per proxy line, numbered like the buyer's `#NN`.
            items = [{"line": a.line_no, "data": a.delivered_text} for a in proxies]
            return {**payload, "items": items, "items_truncated": False, "gateway": None}
    items, truncated = await delivered_lines(
        order.id, db, max_lines=ORDER_ITEMS_MAX_LINES, max_bytes=ORDER_ITEMS_MAX_BYTES, summary=summary,
    )
    return {**payload, "items": items, "items_truncated": truncated, "gateway": None}


# ── Waiting for provisioning ─────────────────────────────────────────────────

async def _order_status(order_id: int) -> OrderStatus | None:
    async with SessionLocal() as db:
        return await db.scalar(select(Order.status).where(Order.id == order_id))


async def _wait_until_settled(key_id: int, order_id: int, wait: float) -> None:
    """Hold until the order leaves pending/processing or ``wait`` runs out.

    Awaits this process's provisioning task when there is one (shielded: a
    timeout or a client disconnect never cancels provisioning), else polls
    the order row (another worker, or the sweep, is provisioning it). Holds no
    session or lock while waiting. Over the per-key waiter cap it returns at once.
    """
    if wait <= 0 or _waiters.get(key_id, 0) >= ORDER_WAITERS_PER_KEY:
        return
    _waiters[key_id] = _waiters.get(key_id, 0) + 1
    try:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + wait
        if await orders_service.wait_for_provision(order_id, wait):
            return
        while True:
            if await _order_status(order_id) not in _IN_FLIGHT:
                return
            remaining = deadline - loop.time()
            if remaining <= 0:
                return
            await asyncio.sleep(min(_WAIT_POLL_SECONDS, remaining))
    finally:
        left = _waiters.get(key_id, 1) - 1
        if left > 0:
            _waiters[key_id] = left
        else:
            _waiters.pop(key_id, None)


def _settled_code(order: Order) -> int:
    """201 once the order is settled, 202 while it is still being provisioned."""
    return status.HTTP_202_ACCEPTED if order.status in _IN_FLIGHT else status.HTTP_201_CREATED


async def _waited_order(
    caller: ApiCaller, order_id: int, wait: float, db: AsyncSession, *, locale: str,
    current: Order | None = None, refs: dict[int, _OrderRefs] | None = None,
) -> tuple[Order, dict]:
    """Wait for provisioning (session released) when the order is in flight,
    then build its body from a fresh read. ``current`` is the order as the
    caller just read it, ``refs`` its product/package refs when already built."""
    order = current if current is not None else await db.get(Order, order_id, populate_existing=True)
    if wait > 0 and order.status in _IN_FLIGHT:
        await db.close()  # back to the pool: nothing is held while waiting
        await _wait_until_settled(caller.key_id, order_id, wait)
        db.expire_all()
        order = await db.get(Order, order_id, populate_existing=True)
    return order, jsonable_encoder(await order_detail(order, db, locale=locale, refs=refs))


def _not_found() -> PublicApiError:
    return PublicApiError("not_found", status.HTTP_404_NOT_FOUND, "Order not found.")


async def _owned_order(caller: ApiCaller, order_code: str, db: AsyncSession, *, lock: bool = False) -> Order:
    code = (order_code or "").strip().upper()
    if not code.startswith("ORD-") or len(code) > 16:
        raise _not_found()
    stmt = select(Order).where(Order.order_code == code, Order.buyer_id == caller.account_id,
                               Order.is_seeded.is_(False))
    order = await db.scalar(stmt.with_for_update() if lock else stmt)
    if order is None:
        raise _not_found()
    return order


async def get_order(
    caller: ApiCaller, order_code: str, db: AsyncSession, *, locale: str = "en", wait: float = 0,
) -> dict:
    order = await _owned_order(caller, order_code, db)
    if wait <= 0 or order.status not in _IN_FLIGHT:
        return await order_detail(order, db, locale=locale)
    _, body = await _waited_order(caller, order.id, wait, db, locale=locale, current=order)
    return body


async def list_orders(
    caller: ApiCaller, db: AsyncSession, *, limit: int, cursor: str | None, locale: str = "en",
) -> dict:
    limit = max(1, min(limit, LIST_LIMIT_MAX))
    decoded = decode_cursor(cursor)
    after = None
    if decoded is not None:
        try:
            after = keyset_after(Order.created_at, Order.id, (decoded[0], int(decoded[1])), descending=True,
                                 nulls_last=False)
        except (TypeError, ValueError):
            after = None
    stmt = (
        select(Order)
        .where(Order.buyer_id == caller.account_id, Order.is_seeded.is_(False),
               *([after] if after is not None else []))
        .order_by(Order.created_at.desc(), Order.id.desc())
        .limit(limit + 1)
    )
    rows = list((await db.execute(stmt)).scalars())
    page = rows[:limit]
    next_cursor = encode_cursor(page[-1].created_at, page[-1].id) if len(rows) > limit and page else None
    return {"items": await _order_payloads(page, db, locale=locale), "next_cursor": next_cursor}


async def rotate_gateway_key(caller: ApiCaller, order_code: str, db: AsyncSession) -> dict:
    """Replace the order's gateway key (the old one stops working at once) —
    the web's rotate, through the same service."""
    order = await _owned_order(caller, order_code, db, lock=True)
    if order.gateway_key_hash is None:
        raise PublicApiError("not_a_gateway_order", status.HTTP_400_BAD_REQUEST,
                             "This order has no gateway key.")
    new_key = await rotate_order_gateway_key(order, db, actor_id=caller.account_id, source="public_api")
    access = gateway_access_from_delivery_data(await delivered_data_of(order, db))
    return {"url": access["url"] if access else "", "key": new_key, "key_hint": order.gateway_key_prefix}


# ── Placing orders ────────────────────────────────────────────────────────────

# Prefix of the keys generated for orders sent without an Idempotency-Key. A tab
# is not printable, so no client-sent key can ever collide with one.
_AUTO_IDEM_PREFIX = "\tauto:"


def _check_idempotency_key(idem_key: str | None) -> str:
    """The client's key, or a fresh internal one when the header is absent.

    Without a key the order is never replayed, but it still gets its own
    idempotency row: that row carries the reservation against the key's daily
    cap (taken under the key-row lock), exactly like a keyed order.
    """
    value = (idem_key or "").strip()
    if not value:
        return f"{_AUTO_IDEM_PREFIX}{uuid.uuid4().hex}"
    if len(value) > IDEMPOTENCY_KEY_MAX or not value.isprintable():
        raise PublicApiError(
            "invalid_request", status.HTTP_400_BAD_REQUEST,
            f"Idempotency-Key must be 1–{IDEMPOTENCY_KEY_MAX} printable characters.",
        )
    return value


@dataclass(frozen=True)
class OrderRequest:
    """A validated `POST /v1/orders` (or quote) body."""
    variant: str | None = None
    product: str | None = None
    options: dict | None = None
    quantity: int | None = None

    def request_hash(self) -> str:
        if self.variant is not None:
            # Same hash as before options existed, so keys stored then still replay.
            body = {"variant": self.variant, "quantity": self.quantity}
        else:
            body = {"product": self.product, "options": self.options or {}, "quantity": self.quantity}
        return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()


@dataclass(frozen=True)
class _Plan:
    """What checkout will be asked to do, and the total it is expected to charge."""
    expected: int
    variant_id: int | None = None
    product_id: int | None = None
    user_config: dict | None = None


@dataclass(frozen=True)
class OrderOutcome:
    status_code: int
    body: dict
    replayed: bool = False


def _replay_or_conflict(row: ApiIdempotency, request_hash: str) -> OrderOutcome | int:
    """The stored outcome, or the order id to rebuild the response from."""
    if row.request_hash != request_hash:
        raise PublicApiError(
            "idempotency_conflict", status.HTTP_409_CONFLICT,
            "This Idempotency-Key was already used with a different request body.",
        )
    if row.status_code is None:
        raise PublicApiError(
            "request_in_progress", status.HTTP_409_CONFLICT,
            "A request with this Idempotency-Key is still being processed. Retry shortly.",
            headers={"Retry-After": "2"},
        )
    if row.order_id is not None:
        return row.order_id
    return OrderOutcome(row.status_code, row.response_json or {}, replayed=True)


async def _sellable_variant(variant_key: str, db: AsyncSession) -> ProductVariant:
    variant = await db.scalar(
        select(ProductVariant).join(Product, Product.id == ProductVariant.product_id).where(
            ProductVariant.public_key == variant_key.strip(),
            ProductVariant.is_active.is_(True),
            Product.status == ProductStatus.active,
            Product.api_enabled.is_(True),
        )
    )
    if variant is None:
        raise PublicApiError("product_not_available", status.HTTP_404_NOT_FOUND,
                             "This package does not exist or is not sold through the API.")
    return variant


def _invalid_options(message: str) -> PublicApiError:
    return PublicApiError("invalid_options", status.HTTP_400_BAD_REQUEST, message)


async def _plan(caller: ApiCaller, body: OrderRequest, db: AsyncSession) -> _Plan:
    """Validate the body for the API (sellable, quantity, options) and price it
    with the checkout's own quote, which also runs its product checks."""
    if body.variant is not None:
        quantity = body.quantity or 0
        if quantity < 1 or quantity > MAX_ORDER_QUANTITY:
            raise PublicApiError("invalid_quantity", status.HTTP_400_BAD_REQUEST,
                                 f"quantity must be between 1 and {MAX_ORDER_QUANTITY}.")
        variant = await _sellable_variant(body.variant, db)
        return _Plan(expected=variant.price * quantity, variant_id=variant.id)

    product = await _api_product(body.product or "", db)
    profile = await sale_profile(product, db)
    if profile.unsupported:
        raise _product_not_available()
    if not profile.by_options:
        raise PublicApiError("invalid_request", status.HTTP_400_BAD_REQUEST,
                             "This product is sold by package: send variant and quantity instead of product.")
    options = dict(body.options or {})
    fields = await option_fields(product, profile, db, locale="en")
    known = {f["name"] for f in fields}
    unknown = sorted(set(options) - known)
    if unknown:
        raise _invalid_options(f"Unknown option(s): {', '.join(unknown)[:200]}. "
                               "Allowed: see options in GET /v1/products/{product}.")
    missing = sorted(f["name"] for f in fields if f["required"] and options.get(f["name"]) in (None, ""))
    if missing:
        raise _invalid_options(f"Missing required option(s): {', '.join(missing)}.")
    if profile.quantity_max is None:
        if body.quantity not in (None, 1):
            raise PublicApiError("quantity_limit", status.HTTP_400_BAD_REQUEST,
                                 "This product is bought one package per order; the size is an option.")
        quantity = 1
    else:
        quantity = 1 if body.quantity is None else body.quantity
        if quantity < 1 or quantity > profile.quantity_max:
            raise PublicApiError("quantity_limit", status.HTTP_400_BAD_REQUEST,
                                 f"quantity must be between 1 and {profile.quantity_max} for this product.")
    user_config = build_user_config(profile, options, quantity)
    quote = await orders_service.quote_order(
        caller.account_id, db, variant_id=None, quantity=quantity, product_id=product.id, user_config=user_config,
    )
    return _Plan(expected=quote["total_amount"], product_id=product.id, user_config=user_config)


async def quote(caller: ApiCaller, body: OrderRequest, db: AsyncSession) -> dict:
    """What `POST /v1/orders` would charge for this body. Writes nothing."""
    plan = await _plan(caller, body, db)
    if plan.variant_id is not None:
        result = await orders_service.quote_order(
            caller.account_id, db, variant_id=plan.variant_id, quantity=body.quantity or 0,
        )
        return {"total": result["total_amount"], "currency": CURRENCY}
    return {"total": plan.expected, "currency": CURRENCY}


async def _reserve(
    caller: ApiCaller, idem_key: str, request_hash: str, body: OrderRequest, db: AsyncSession,
) -> tuple[ApiIdempotency | None, OrderOutcome | int | None, _Plan | None]:
    """Replay a finished request, or claim the key and reserve the expected
    total against today's cap. Commits the claim."""
    existing = await db.scalar(
        select(ApiIdempotency).where(ApiIdempotency.api_key_id == caller.key_id, ApiIdempotency.idem_key == idem_key)
    )
    if existing is not None:
        if existing.created_at >= datetime.now(timezone.utc) - IDEMPOTENCY_TTL:
            return None, _replay_or_conflict(existing, request_hash), None
        # Expired: the key may be reused (the old row no longer counts today).
        await db.execute(delete(ApiIdempotency).where(ApiIdempotency.id == existing.id))

    plan = await _plan(caller, body, db)

    # The key row lock serialises every reservation of this key.
    limit = await db.scalar(select(ApiKey.daily_spend_limit).where(ApiKey.id == caller.key_id).with_for_update())
    if limit is not None:
        spent = (await spent_today(db, [caller.key_id])).get(caller.key_id, 0)
        if spent + plan.expected > limit:
            await db.rollback()
            raise PublicApiError(
                "daily_limit_exceeded", status.HTTP_403_FORBIDDEN,
                f"This order would exceed the key's daily spend limit ({spent} of {limit} {CURRENCY} used today).",
            )
    row = ApiIdempotency(
        account_id=caller.account_id, api_key_id=caller.key_id, idem_key=idem_key,
        request_hash=request_hash, reserved_amount=plan.expected,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        # A concurrent request with the same key won the insert.
        await db.rollback()
        winner = await db.scalar(
            select(ApiIdempotency).where(ApiIdempotency.api_key_id == caller.key_id,
                                         ApiIdempotency.idem_key == idem_key)
        )
        if winner is None:
            raise
        return None, _replay_or_conflict(winner, request_hash), None
    return row, None, plan


async def place_order(
    caller: ApiCaller, idem_key: str | None, body: OrderRequest, db: AsyncSession, *, locale: str = "en",
    wait: float = 0,
) -> OrderOutcome:
    """Place the order, then hold the response up to ``wait`` seconds while it
    is provisioned: 201 once settled (delivered, failed, ...), 202 while still
    processing. A replay of an existing order waits the same way."""
    await require_orders_open(db)
    idem_key = _check_idempotency_key(idem_key)
    request_hash = body.request_hash()
    row, replay, plan = await _reserve(caller, idem_key, request_hash, body, db)
    if isinstance(replay, OrderOutcome):
        return replay
    if replay is not None:
        # Delivered goods are never stored with the idempotency record: a
        # replay answers with the order as it is now (waiting like the original).
        order, detail = await _waited_order(caller, replay, wait, db, locale=locale)
        return OrderOutcome(_settled_code(order), detail, replayed=True)
    row_id = row.id

    try:
        if plan.variant_id is not None:
            order = await orders_service.create_order(caller.account_id, plan.variant_id, body.quantity, db)
        else:
            order = await orders_service.create_order_with_adapter(
                caller.account_id, plan.product_id, plan.user_config, db,
            )
    except BaseException:
        # Nothing was charged (checkout rolls back as a whole) — free the key.
        await db.rollback()
        await db.execute(delete(ApiIdempotency).where(ApiIdempotency.id == row_id))
        await db.commit()
        raise

    # The idempotency record keeps the order summary (never the goods). When the
    # response is built after waiting, only that summary is needed now.
    refs = await _order_refs([order], db, locale)
    waiting = wait > 0 and order.status in _IN_FLIGHT
    if waiting:
        [payload], _, _ = await _order_bodies([order], db, locale=locale, refs=refs)
        body_out = None
    else:
        body_out = jsonable_encoder(await order_detail(order, db, locale=locale, refs=refs))
        payload = {key: value for key, value in body_out.items() if key not in ("items", "items_truncated", "gateway")}
    summary = jsonable_encoder(payload)
    await db.execute(
        update(ApiIdempotency).where(ApiIdempotency.id == row_id).values(
            status_code=status.HTTP_201_CREATED, response_json=summary, order_id=order.id,
        )
    )
    await log_event(
        db, "info", f"Order {order.id} placed through the public API", request_id=current_request_id(),
        metadata={
            "event": "api_order_created", "actor_id": caller.account_id, "actor_type": "buyer",
            "subject_type": "order", "subject_id": order.id, "outcome": "success", "source": "public_api",
            "api_key_id": caller.key_id, "order_code": order.order_code, "amount": order.total_amount,
            "quantity": order.quantity,
        },
    )
    await db.commit()
    if waiting:
        order, body_out = await _waited_order(caller, order.id, wait, db, locale=locale, current=order, refs=refs)
    return OrderOutcome(_settled_code(order), body_out)
