"""Public buyer sales API: key management, key authentication and the `/v1`
operations.

It is a thin layer over the storefront checkout: an API order goes through
`orders.service.create_order` (wallet debit, escrow, stock claim or adapter
provisioning, short-delivery refunds), and delivered goods are read through
`orders.delivery`. What this module adds is only what an unattended client
needs: a hashed per-buyer key, admin switches (`accounts.api_access_enabled`,
`products.api_enabled`), IP allowlists, scopes, a per-key daily spend cap and
`Idempotency-Key` replay.

Transactions: the idempotency row (with the order's expected total reserved
against the key's daily cap, under a lock on the key row) is committed
before checkout, so a concurrent retry sees the request in flight and the
cap holds even though checkout commits on its own. A failed checkout deletes
the row, so the same key may be retried once the cause is fixed.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
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
from src.orders.delivery import delivered_lines, delivery_summary
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
                             "API access is not enabled for this account.")
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
        daily_spend_limit=key.daily_spend_limit,
    )


# ── /v1 operations ────────────────────────────────────────────────────────────

async def me(caller: ApiCaller, db: AsyncSession) -> dict:
    wallet = await get_wallet_by_account(caller.account_id, db)
    spent = (await spent_today(db, [caller.key_id])).get(caller.key_id, 0)
    return {
        "balance": wallet.available_balance, "currency": CURRENCY,
        "daily_spend_limit": caller.daily_spend_limit, "spent_today": spent,
    }


async def products(db: AsyncSession, *, locale: str) -> dict:
    return {"currency": CURRENCY, "items": await api_catalog(db, locale=locale)}


async def _order_refs(orders: list[Order], db: AsyncSession) -> dict[int, tuple[str | None, str | None]]:
    product_ids = {o.product_id for o in orders if o.product_id}
    variant_ids = {o.variant_id for o in orders if o.variant_id}
    products_by_id = {
        pid: f"{slug}-{key}" for pid, slug, key in (await db.execute(
            select(Product.id, Product.slug, Product.public_key).where(Product.id.in_(product_ids))
        )).all()
    } if product_ids else {}
    variants_by_id = dict((await db.execute(
        select(ProductVariant.id, ProductVariant.public_key).where(ProductVariant.id.in_(variant_ids))
    )).all()) if variant_ids else {}
    return {o.id: (products_by_id.get(o.product_id), variants_by_id.get(o.variant_id)) for o in orders}


async def _order_payloads(orders: list[Order], db: AsyncSession) -> list[dict]:
    refs = await _order_refs(orders, db)
    summaries = await delivery_summary([o.id for o in orders], db)
    out = []
    for order in orders:
        summary = summaries[order.id]
        if summary.from_resources:
            delivered = summary.delivered_lines
        else:
            delivered = order.quantity if summary.has_text else 0
        product_ref, variant_ref = refs[order.id]
        out.append({
            "order": order.order_code, "status": _STATUS_MAP.get(order.status, order.status.value),
            "product": product_ref, "variant": variant_ref, "quantity": order.quantity,
            "delivered_quantity": delivered, "total": order.total_amount,
            "refunded_amount": order.refunded_amount, "currency": CURRENCY, "created_at": order.created_at,
        })
    return out


async def order_detail(order: Order, db: AsyncSession) -> dict:
    [payload] = await _order_payloads([order], db)
    items, truncated = await delivered_lines(
        order.id, db, max_lines=ORDER_ITEMS_MAX_LINES, max_bytes=ORDER_ITEMS_MAX_BYTES,
    )
    return {**payload, "items": items, "items_truncated": truncated}


def _not_found() -> PublicApiError:
    return PublicApiError("not_found", status.HTTP_404_NOT_FOUND, "Order not found.")


async def get_order(caller: ApiCaller, order_code: str, db: AsyncSession) -> dict:
    code = (order_code or "").strip().upper()
    if not code.startswith("ORD-") or len(code) > 16:
        raise _not_found()
    order = await db.scalar(
        select(Order).where(Order.order_code == code, Order.buyer_id == caller.account_id,
                            Order.is_seeded.is_(False))
    )
    if order is None:
        raise _not_found()
    return await order_detail(order, db)


async def list_orders(caller: ApiCaller, db: AsyncSession, *, limit: int, cursor: str | None) -> dict:
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
    return {"items": await _order_payloads(page, db), "next_cursor": next_cursor}


def _request_hash(variant: str, quantity: int) -> str:
    return hashlib.sha256(
        json.dumps({"variant": variant, "quantity": quantity}, sort_keys=True).encode()
    ).hexdigest()


def _check_idempotency_key(idem_key: str | None) -> str:
    value = (idem_key or "").strip()
    if not value or len(value) > IDEMPOTENCY_KEY_MAX or not value.isprintable():
        raise PublicApiError(
            "idempotency_key_required", status.HTTP_400_BAD_REQUEST,
            f"Send a unique Idempotency-Key header (1–{IDEMPOTENCY_KEY_MAX} characters) with every order.",
        )
    return value


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


async def _reserve(
    caller: ApiCaller, idem_key: str, request_hash: str, variant_key: str, quantity: int, db: AsyncSession,
) -> tuple[ApiIdempotency | None, OrderOutcome | int | None, ProductVariant | None]:
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

    if quantity < 1 or quantity > MAX_ORDER_QUANTITY:
        raise PublicApiError("invalid_quantity", status.HTTP_400_BAD_REQUEST,
                             f"quantity must be between 1 and {MAX_ORDER_QUANTITY}.")
    variant = await _sellable_variant(variant_key, db)
    expected = variant.price * quantity

    # The key row lock serialises every reservation of this key.
    limit = await db.scalar(select(ApiKey.daily_spend_limit).where(ApiKey.id == caller.key_id).with_for_update())
    if limit is not None:
        spent = (await spent_today(db, [caller.key_id])).get(caller.key_id, 0)
        if spent + expected > limit:
            await db.rollback()
            raise PublicApiError(
                "daily_limit_exceeded", status.HTTP_403_FORBIDDEN,
                f"This order would exceed the key's daily spend limit ({spent} of {limit} {CURRENCY} used today).",
            )
    row = ApiIdempotency(
        account_id=caller.account_id, api_key_id=caller.key_id, idem_key=idem_key,
        request_hash=request_hash, reserved_amount=expected,
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
    return row, None, variant


async def place_order(
    caller: ApiCaller, idem_key: str | None, variant_key: str, quantity: int, db: AsyncSession,
) -> OrderOutcome:
    await require_orders_open(db)
    idem_key = _check_idempotency_key(idem_key)
    request_hash = _request_hash(variant_key, quantity)
    row, replay, variant = await _reserve(caller, idem_key, request_hash, variant_key, quantity, db)
    if isinstance(replay, OrderOutcome):
        return replay
    if replay is not None:
        # Delivered goods are never stored with the idempotency record: a
        # replay answers with the order as it is now.
        order = await db.get(Order, replay)
        return OrderOutcome(status.HTTP_201_CREATED, jsonable_encoder(await order_detail(order, db)), replayed=True)
    row_id, variant_id = row.id, variant.id

    try:
        order = await orders_service.create_order(caller.account_id, variant_id, quantity, db)
    except BaseException:
        # Nothing was charged (checkout rolls back as a whole) — free the key.
        await db.rollback()
        await db.execute(delete(ApiIdempotency).where(ApiIdempotency.id == row_id))
        await db.commit()
        raise

    body = jsonable_encoder(await order_detail(order, db))
    summary = {key: value for key, value in body.items() if key not in ("items", "items_truncated")}
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
            "quantity": quantity,
        },
    )
    await db.commit()
    return OrderOutcome(status.HTTP_201_CREATED, body)

