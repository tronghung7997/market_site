"""API sources sold as request packages through the gateway (kind "gateway").

A gateway source is a Provider whose adapter spec has ``gateway_source`` (today
``ghlab_fb``: lookup.ghlab.info's Facebook collect API). It is run by an
internal seller exactly like the catalog/proxy sources, but instead of
listings or plans it sells ONE product (strategy ``credit``, service_type
``endpoint``) whose packages and prices the admin sets on the source page:

- packages live in ``product.pricing_params.packages`` as
  ``{size, label, price, active}`` (pricing/credit.py sells the exact price);
- the upstream cost per request is ``provider.config.cost_per_request``, only
  used to show margin;
- ``provider.config.endpoint_map`` lists the endpoints buyers may call, each
  with a fixed method, and ``ENDPOINT_DOCS`` describes them for the buyer
  console;
- ``charge_only_success`` makes upstream errors free for the buyer
  (src/gateway/forward.py).
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error
from src.models.category import Category
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductStatus
from src.models.provider import Provider
from src.models.usage import GatewayCallLog, OrderBalance

# Link dùng để kiểm tra kết nối khi thêm nguồn (một request thật).
DEFAULT_TEST_URL = "https://www.facebook.com/100000020535380_28931382953112338"

ENDPOINT_DOCS: dict[str, dict] = {
    "fb_collect": {
        "method": "POST",
        "path": "/api/v1/fb-module/collect",
        "units": 1,
        "summary": "Chi tiết một bài viết, trang, hồ sơ hoặc nhóm Facebook theo link.",
        "params": [
            {"name": "url", "type": "string", "required": True,
             "description": "Link bài viết, trang, hồ sơ hoặc nhóm Facebook."},
        ],
        "sample_body": {"url": DEFAULT_TEST_URL},
    },
}

GATEWAY_DEFAULTS: dict = {
    "auth_query_param": "api_key",
    "endpoint_map": {name: {"path": d["path"], "method": d["method"]} for name, d in ENDPOINT_DOCS.items()},
    "timeout_seconds": 30,
    "max_attempts": 1,
    "charge_only_success": True,
    "rate_limit_per_minute": 60,
    # Nguồn không có health check miễn phí — mọi endpoint đều tính phí.
    "skip_health_probe": True,
    "skip_provision_handshake": True,
    "cost_per_request": 0,
}

# Khoá cấu hình trang Cài đặt của nguồn gateway sửa được (ngoài kết nối).
GATEWAY_SETTING_KEYS = ("timeout_seconds", "max_attempts", "rate_limit_per_minute")

MAX_PACKAGES = 12
_TRY_PREVIEW_BYTES = 64 * 1024


def endpoint_docs(provider: Provider, *, include_path: bool) -> list[dict]:
    """Endpoints the source sells, for the admin Endpoint tab and the buyer
    console. The upstream path is admin-only."""
    endpoint_map = (provider.config or {}).get("endpoint_map") or {}
    out = []
    for name, entry in endpoint_map.items():
        doc = ENDPOINT_DOCS.get(name, {})
        method = (entry.get("method") if isinstance(entry, dict) else None) or doc.get("method") or "POST"
        item = {
            "name": name, "method": method, "units": int(doc.get("units", 1)),
            "summary": doc.get("summary", ""), "params": doc.get("params", []),
            "sample_body": doc.get("sample_body", {}),
        }
        if include_path:
            item["path"] = entry.get("path") if isinstance(entry, dict) else entry
        out.append(item)
    return out


# ----------------------------------------------------------------------
# Wizard: kiểm tra kết nối + tạo sản phẩm bán
# ----------------------------------------------------------------------

async def test_gateway_config(adapter, config: dict) -> dict:
    """Gọi THẬT endpoint đầu tiên một lần với link mẫu — nguồn không có health
    check miễn phí, đây là cách duy nhất biết key còn dùng được."""
    name, doc = next(iter(ENDPOINT_DOCS.items()))
    url = (config.get("test_url") or DEFAULT_TEST_URL).strip()
    started = time.perf_counter()
    try:
        resp = await adapter.call(0, doc["path"], method=doc["method"], json_body={"url": url})
    except Exception as e:  # noqa: BLE001 — trả lỗi cho admin, không raise
        return {"ok": False, "health": {"status": "unhealthy", "message": f"Không kết nối được nguồn: {type(e).__name__}"}}
    latency_ms = int((time.perf_counter() - started) * 1000)
    ok = resp.status_code < 400
    message = f"Gọi thử {name}: HTTP {resp.status_code} · {latency_ms / 1000:.1f} giây"
    if not ok:
        message += f" · {resp.text[:200]}"
    return {"ok": ok, "health": {"status": "healthy" if ok else "unhealthy", "message": message,
                                 "status_code": resp.status_code, "latency_ms": latency_ms}}


async def _guess_category(db: AsyncSession) -> int:
    rows = (await db.execute(select(Category.id, Category.name).where(Category.is_active).order_by(Category.id))).all()
    if not rows:
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                        detail="Chưa có danh mục nào để gắn sản phẩm API")
    for cid, name in rows:
        if "facebook" in (name or "").lower():
            return cid
    return rows[0][0]


async def ensure_product(provider: Provider, db: AsyncSession) -> Product | None:
    """The one product a gateway source sells. Created as a DRAFT the first
    time (no packages yet — the admin sets them in the Gói bán tab)."""
    product = await db.scalar(
        select(Product).where(Product.provider_id == provider.id).order_by(Product.id).limit(1)
    )
    if product is not None or provider.seller_id is None:
        return product
    from src.products.service import create_product

    product = await create_product(provider.seller_id, {
        "category_id": await _guess_category(db),
        "title": provider.name,
        "description": "Gửi một link Facebook, nhận lại JSON chi tiết. Chỉ trừ request khi có kết quả.",
        "status": ProductStatus.draft,
        "service_type": "endpoint",
        "provider_id": provider.id,
        "pricing_strategy": "credit",
        "escrow_days": 0,
    }, db, commit=False)
    product.pricing_params = _pricing_params([], provider)
    await db.flush()
    return product


def _pricing_params(packages: list[dict], provider: Provider) -> dict:
    """CreditPricing params: priced packages + one request per endpoint call."""
    per_unit = [p["price"] / p["size"] for p in packages if p.get("size")]
    endpoint_map = (provider.config or {}).get("endpoint_map") or {}
    return {
        "credit_price": round(min(per_unit), 2) if per_unit else 0,
        "packages": packages,
        "field_labels": {"package_size": "Gói request"},
        "endpoint_rates": {name: int(ENDPOINT_DOCS.get(name, {}).get("units", 1)) for name in endpoint_map},
        "default_rate": 1,
    }


# ----------------------------------------------------------------------
# Tab Gói bán
# ----------------------------------------------------------------------

def _cost(provider: Provider) -> float:
    try:
        return float((provider.config or {}).get("cost_per_request") or 0)
    except (TypeError, ValueError):
        return 0.0


async def get_gateway(provider: Provider, scope, db: AsyncSession) -> dict:
    product = await ensure_product(provider, db)
    await db.commit()
    params = (product.pricing_params or {}) if product else {}
    cost = _cost(provider)
    packages = []
    for p in params.get("packages", []):
        size, price = int(p.get("size") or 0), int(p.get("price") or 0)
        per = price / size if size else 0
        packages.append({
            "label": p.get("label") or f"{size} request", "size": size, "price": price,
            "active": bool(p.get("active", True)), "per_request": round(per, 2),
            "profit_per_request": round(per - cost, 2) if cost else None,
        })
    return {
        "product": {
            "id": product.id, "public_key": product.public_key, "title": product.title,
            "category_id": product.category_id, "status": product.status.value,
        } if product else None,
        "packages": packages,
        "cost_per_request": cost,
        "endpoints": endpoint_docs(provider, include_path=scope.is_admin),
        "charge_only_success": bool((provider.config or {}).get("charge_only_success")),
        "timeout_seconds": int((provider.config or {}).get("timeout_seconds") or 5),
        "rate_limit_per_minute": int((provider.config or {}).get("rate_limit_per_minute") or 0) or None,
    }


async def update_packages(provider: Provider, scope, data: dict, db: AsyncSession, *, actor_id: int | None) -> dict:
    """data: packages[{label,size,price,active}], cost_per_request?, title?,
    category_id?, publish? (True → active, False → draft). Orders already sold
    keep the package size and price they were bought with."""
    product = await ensure_product(provider, db)
    if product is None:
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                        detail="Nguồn chưa giao cho cửa hàng nào — giao ở tab Cài đặt trước")
    packages = data.get("packages")
    if packages is not None:
        sizes = [int(p["size"]) for p in packages]
        if len(sizes) != len(set(sizes)):
            raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                            detail="Hai gói không được có cùng số request")
        clean = [{"label": (p.get("label") or f"{int(p['size'])} request").strip()[:60],
                  "size": int(p["size"]), "price": int(p["price"]), "active": bool(p.get("active", True))}
                 for p in packages]
        product.pricing_params = _pricing_params(clean, provider)
        product.pricing_strategy = "credit"
    if data.get("cost_per_request") is not None:
        from src.providers.service import update_provider

        cfg = dict(provider.config or {})
        cfg["cost_per_request"] = data["cost_per_request"]
        provider = await update_provider(provider.id, {"config": cfg}, db, actor_id=actor_id)
        product = await db.get(Product, product.id)
    if data.get("title"):
        product.title = data["title"].strip()[:255]
    if data.get("category_id"):
        if await db.get(Category, int(data["category_id"])) is None:
            raise api_error(ErrorCode.CATEGORY_NOT_FOUND, status.HTTP_404_NOT_FOUND)
        product.category_id = int(data["category_id"])
    if data.get("publish") is not None:
        if data["publish"]:
            active = [p for p in (product.pricing_params or {}).get("packages", []) if p.get("active", True)]
            if not active:
                raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                                detail="Cần ít nhất một gói đang bật trước khi mở bán")
            product.status = ProductStatus.active
        else:
            product.status = ProductStatus.draft
    await db.commit()
    return await get_gateway(provider, scope, db)


# ----------------------------------------------------------------------
# Tab Endpoint: gọi thử bằng key của sàn
# ----------------------------------------------------------------------

async def try_upstream(provider: Provider, endpoint: str, body: dict | None, db: AsyncSession) -> dict:
    """Gọi thật một endpoint bằng key của sàn — không đụng tới request của
    khách (nguồn vẫn có thể tính phí lần gọi này)."""
    from src.adapters.factory import get_adapter_for_test
    from src.gateway.forward import resolve_endpoint

    route = resolve_endpoint(provider, endpoint)
    adapter = await get_adapter_for_test(provider.id, db)
    started = time.perf_counter()
    try:
        resp = await adapter.call(0, route.path, method=route.method or "POST", json_body=body or {})
    except Exception as e:  # noqa: BLE001
        return {"status_code": None, "latency_ms": int((time.perf_counter() - started) * 1000),
                "body": f"Không kết nối được nguồn: {type(e).__name__}", "truncated": False}
    return {
        "status_code": resp.status_code, "latency_ms": int((time.perf_counter() - started) * 1000),
        "body": resp.content[:_TRY_PREVIEW_BYTES].decode("utf-8", errors="replace"),
        "truncated": len(resp.content) > _TRY_PREVIEW_BYTES,
    }


# ----------------------------------------------------------------------
# Tab Request + thống kê cho danh sách nguồn
# ----------------------------------------------------------------------

def _is_ok(code: int | None) -> bool:
    return code is not None and code < 400


async def list_requests(
    provider: Provider, scope, db: AsyncSession, *,
    hours: int = 24, result: str = "all", q: str = "", page: int = 1, per_page: int = 50,
) -> dict:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    base = (
        select(GatewayCallLog, Order.order_code, Order.gateway_key_prefix)
        .join(Order, Order.id == GatewayCallLog.order_id)
        .where(Order.provider_id == provider.id, GatewayCallLog.created_at >= since)
    )
    if not scope.is_admin:
        base = base.where(Order.seller_id == scope.seller_id)
    rows = (await db.execute(base.order_by(GatewayCallLog.created_at.desc(), GatewayCallLog.id.desc()))).all()

    items = [{
        "id": log.id, "created_at": log.created_at, "order_code": code, "key_prefix": prefix,
        "endpoint": log.endpoint, "status_code": log.status_code, "latency_ms": log.latency_ms,
        "error": log.error, "units_charged": log.units_charged, "units_remaining": log.units_remaining,
        "ok": _is_ok(log.status_code),
    } for log, code, prefix in rows]
    ok = sum(1 for i in items if i["ok"])
    latencies = [i["latency_ms"] for i in items]
    summary = {
        "requests": len(items), "ok": ok, "errors": len(items) - ok,
        "charged": sum(i["units_charged"] or 0 for i in items),
        "avg_latency_ms": int(sum(latencies) / len(latencies)) if latencies else None,
        "max_latency_ms": max(latencies) if latencies else None,
        "active_keys": len({i["order_code"] for i in items}),
    }
    if result == "ok":
        items = [i for i in items if i["ok"]]
    elif result == "error":
        items = [i for i in items if not i["ok"]]
    needle = q.strip().lower()
    if needle:
        items = [i for i in items if needle in (i["order_code"] or "").lower() or needle in (i["key_prefix"] or "").lower()]
    page, per_page = max(1, page), max(1, min(per_page, 200))
    return {"summary": summary, "items": items[(page - 1) * per_page: page * per_page],
            "total": len(items), "page": page, "per_page": per_page, "hours": hours}


async def gateway_stats(provider_ids: list[int], db: AsyncSession, *, seller_id: int | None = None) -> dict[int, dict]:
    """Per source: 24h requests/ok/errors, keys with balance left, and 7-day
    profit (packages sold − upstream cost of successful requests)."""
    if not provider_ids:
        return {}
    now = datetime.now(timezone.utc)
    since24, since7 = now - timedelta(hours=24), now - timedelta(days=7)
    call_q = (
        select(Order.provider_id, GatewayCallLog.status_code, GatewayCallLog.units_charged, GatewayCallLog.created_at)
        .join(Order, Order.id == GatewayCallLog.order_id)
        .where(Order.provider_id.in_(provider_ids), GatewayCallLog.created_at >= since7)
    )
    sales_q = (
        select(Order.provider_id, func.coalesce(func.sum(Order.total_amount - Order.refunded_amount), 0))
        .where(Order.provider_id.in_(provider_ids), Order.created_at >= since7,
               Order.status.in_((OrderStatus.delivered, OrderStatus.completed)), Order.is_seeded.is_(False))
        .group_by(Order.provider_id)
    )
    keys_q = (
        select(Order.provider_id, func.count(Order.id))
        .join(OrderBalance, OrderBalance.order_id == Order.id)
        .where(Order.provider_id.in_(provider_ids), Order.gateway_key_hash.is_not(None),
               Order.status.in_((OrderStatus.delivered, OrderStatus.completed)),
               OrderBalance.units_used < OrderBalance.units_total)
        .group_by(Order.provider_id)
    )
    if seller_id is not None:
        call_q, sales_q, keys_q = (q.where(Order.seller_id == seller_id) for q in (call_q, sales_q, keys_q))
    calls = (await db.execute(call_q)).all()
    sales = dict((await db.execute(sales_q)).all())
    keys = dict((await db.execute(keys_q)).all())
    costs = {p.id: _cost(p) for p in (await db.execute(select(Provider).where(Provider.id.in_(provider_ids)))).scalars()}
    out: dict[int, dict] = {}
    for pid in provider_ids:
        mine = [c for c in calls if c[0] == pid]
        day = [c for c in mine if c[3] >= since24]
        ok7 = sum(1 for c in mine if _is_ok(c[1]))
        out[pid] = {
            "requests_24h": len(day),
            "ok_24h": sum(1 for c in day if _is_ok(c[1])),
            "errors_24h": sum(1 for c in day if not _is_ok(c[1])),
            "active_keys": int(keys.get(pid, 0)),
            "sales_7d": int(sales.get(pid, 0)),
            "profit_7d": int(sales.get(pid, 0) - ok7 * costs.get(pid, 0)),
        }
    return out


async def buyer_endpoints(order: Order, db: AsyncSession) -> dict | None:
    """What the buyer console needs about the source behind an order."""
    if not order.provider_id:
        return None
    provider = await db.get(Provider, order.provider_id)
    if provider is None:
        return None
    return {
        "endpoints": endpoint_docs(provider, include_path=False),
        "charge_only_success": bool((provider.config or {}).get("charge_only_success")),
    }


__all__ = [
    "DEFAULT_TEST_URL", "ENDPOINT_DOCS", "GATEWAY_DEFAULTS", "GATEWAY_SETTING_KEYS",
    "buyer_endpoints", "endpoint_docs", "ensure_product", "gateway_stats", "get_gateway",
    "list_requests", "test_gateway_config", "try_upstream", "update_packages",
]
