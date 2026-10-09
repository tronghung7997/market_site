"""HTTP adapters of the public sales API.

`router` serves `/v1` to buyers' own scripts (API key, no BFF signature,
errors as ``{"error": {code, message}}``). `account_router` is the buyer's
key management behind the website session. The admin switches live with
their owners (`auth` for accounts, `products` for products).
"""
from fastapi import APIRouter, Depends, Header, Query, Request, status
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account
from src.database import get_session
from src.models.account import Account
from src.rate_limit import check_rate_limit
from src.security.client_ip import request_client_ip

from . import schemas, service
from .errors import PublicApiError

# Both limits live in Settings › Buyer tiers (buyer_tier_config):
# per IP (``ip_requests_per_minute``): before the key is even looked up, for
# every tier (flood guard);
# per key (every call / order placements): set by the owner's buyer tier;
# None there = no per-key limit.


async def ip_request_limit(db: AsyncSession) -> int:
    """Calls per minute one client IP may make to ``/v1``, whatever the key."""
    from src.buyer_tiers.config import get_config

    return int((await get_config(db))["ip_requests_per_minute"])


async def tier_limits(db: AsyncSession, buyer_tier: str) -> tuple[int | None, int | None]:
    """(requests, orders) per minute for one key of a buyer of ``buyer_tier``."""
    from src.buyer_tiers.config import get_config, level_of

    level = level_of(await get_config(db), buyer_tier)
    return level["api_requests_per_minute"], level["api_orders_per_minute"]

router = APIRouter(prefix="/v1", tags=["public-api"])
account_router = APIRouter(tags=["public-api"])


def _rate_limited() -> PublicApiError:
    return PublicApiError("rate_limited", status.HTTP_429_TOO_MANY_REQUESTS,
                          "Too many requests. Retry after the time in Retry-After.",
                          headers={"Retry-After": "60"})


def _presented_key(request: Request) -> str | None:
    auth = request.headers.get("authorization") or ""
    scheme, _, value = auth.partition(" ")
    if scheme.lower() == "bearer" and value.strip():
        return value.strip()
    return (request.headers.get("x-api-key") or "").strip() or None


def api_caller(scope: str):
    async def dependency(request: Request, db: AsyncSession = Depends(get_session)) -> service.ApiCaller:
        ip = request_client_ip(request)
        if not await check_rate_limit(f"v1-ip:{ip}", limit=await ip_request_limit(db), window_seconds=60):
            raise _rate_limited()
        caller = await service.authenticate(_presented_key(request), ip, scope, db)
        # Access log / OpenObserve (middleware._outcome_fields): who called, with which key.
        request.state.account_id = caller.account_id
        request.state.api_key_id = caller.key_id
        requests_limit, _ = await tier_limits(db, caller.buyer_tier)
        if requests_limit is not None and not await check_rate_limit(
            f"v1-key:{caller.key_id}", limit=requests_limit, window_seconds=60,
        ):
            raise _rate_limited()
        return caller
    return dependency


@router.get("/me", response_model=schemas.V1Me)
async def v1_me(caller: service.ApiCaller = Depends(api_caller("orders:read")), db: AsyncSession = Depends(get_session)):
    return await service.me(caller, db)


_LOCALE = Query("en", pattern="^(en|vi)$", description="Ngôn ngữ của tên sản phẩm / gói / nhãn tuỳ chọn.")


def _order_request(body: schemas.V1OrderCreate) -> service.OrderRequest:
    return service.OrderRequest(variant=body.variant, product=body.product, options=body.options,
                                quantity=body.quantity)


@router.get("/products", response_model=schemas.V1ProductList)
async def v1_products(
    caller: service.ApiCaller = Depends(api_caller("orders:read")),
    db: AsyncSession = Depends(get_session),
    locale: str = _LOCALE,
):
    return await service.products(db, locale=locale)


@router.get("/products/{product}", response_model=schemas.V1Product)
async def v1_product(
    product: str,
    caller: service.ApiCaller = Depends(api_caller("orders:read")),
    db: AsyncSession = Depends(get_session),
    locale: str = _LOCALE,
):
    return await service.product_detail(product, db, locale=locale)


@router.post("/orders/quote", response_model=schemas.V1Quote)
async def v1_quote_order(
    body: schemas.V1OrderCreate,
    caller: service.ApiCaller = Depends(api_caller("orders:read")),
    db: AsyncSession = Depends(get_session),
):
    return await service.quote(caller, _order_request(body), db)


@router.post("/orders", response_model=schemas.V1Order, status_code=status.HTTP_201_CREATED)
async def v1_create_order(
    body: schemas.V1OrderCreate,
    caller: service.ApiCaller = Depends(api_caller("orders:write")),
    db: AsyncSession = Depends(get_session),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    locale: str = _LOCALE,
    wait: int | None = Query(None, ge=0, le=service.ORDER_WAIT_MAX_SECONDS),
):
    _, orders_limit = await tier_limits(db, caller.buyer_tier)
    if orders_limit is not None and not await check_rate_limit(
        f"v1-orders:{caller.key_id}", limit=orders_limit, window_seconds=60,
    ):
        raise _rate_limited()
    outcome = await service.place_order(caller, idempotency_key, _order_request(body), db, locale=locale,
                                        wait=service.ORDER_WAIT_DEFAULT_SECONDS if wait is None else wait)
    headers = {"Idempotent-Replayed": "true"} if outcome.replayed else None
    return JSONResponse(status_code=outcome.status_code, content=outcome.body, headers=headers)


@router.get("/orders", response_model=schemas.V1OrderList)
async def v1_list_orders(
    caller: service.ApiCaller = Depends(api_caller("orders:read")),
    db: AsyncSession = Depends(get_session),
    limit: int = Query(20, ge=1, le=service.LIST_LIMIT_MAX),
    cursor: str | None = Query(None, max_length=200),
    locale: str = _LOCALE,
):
    return await service.list_orders(caller, db, limit=limit, cursor=cursor, locale=locale)


@router.get("/orders/{order_code}", response_model=schemas.V1Order)
async def v1_get_order(
    order_code: str,
    caller: service.ApiCaller = Depends(api_caller("orders:read")),
    db: AsyncSession = Depends(get_session),
    locale: str = _LOCALE,
    wait: int = Query(0, ge=0, le=service.ORDER_WAIT_MAX_SECONDS),
):
    return await service.get_order(caller, order_code, db, locale=locale, wait=wait)


@router.post("/orders/{order_code}/gateway-key/rotate", response_model=schemas.V1GatewayAccess)
async def v1_rotate_gateway_key(
    order_code: str,
    caller: service.ApiCaller = Depends(api_caller("orders:write")),
    db: AsyncSession = Depends(get_session),
):
    return await service.rotate_gateway_key(caller, order_code, db)


@router.get("/openapi.json", include_in_schema=False)
async def v1_openapi() -> JSONResponse:
    """Public, cacheable OpenAPI document of `/v1` only (no key needed)."""
    from .openapi import public_openapi

    return JSONResponse(public_openapi(), headers={"Cache-Control": "public, max-age=300"})


# ── Buyer key management (website session through the BFF) ──

@account_router.get("/account/api-keys", response_model=schemas.ApiKeyList)
async def list_api_keys(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.list_keys(account, db)


@account_router.post("/account/api-keys", response_model=schemas.ApiKeyCreated, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    body: schemas.ApiKeyCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.create_key(
        account, db, name=body.name, scopes=body.scopes,
        allowed_ips=body.allowed_ips, daily_spend_limit=body.daily_spend_limit,
    )


@account_router.patch("/account/api-keys/{key_id}", response_model=schemas.ApiKeyRow)
async def update_api_key(
    key_id: int,
    body: schemas.ApiKeyUpdate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_key(account, key_id, body.model_dump(exclude_unset=True), db)


@account_router.delete("/account/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    key_id: int,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    await service.revoke_key(account, key_id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
