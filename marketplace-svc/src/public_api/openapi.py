"""Curated OpenAPI 3.1 document of the public buyer API.

Built from `router`'s routes only, so no website, admin or BFF route can leak
into it; the app-wide `/openapi.json` stays governed by `api_docs_enabled`.
The frontend renders it with Scalar at `/[locale]/docs/api`.
"""
from __future__ import annotations

from copy import deepcopy
from functools import lru_cache

from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute

from src.config import settings

from . import service

TITLE = "GMMO Buyer API"
VERSION = "1.0"

_DESCRIPTION = (
    "API bán hàng cho người mua: xem danh mục, đặt đơn bằng số dư ví và nhận hàng qua script của bạn.\n\n"
    "- Xác thực: `Authorization: Bearer pk_live_…` (tạo key ở **Tài khoản › API**).\n"
    "- Tiền tệ: số nguyên VND, không có phần thập phân.\n"
    "- Mọi lỗi có dạng `{\"error\": {\"code\", \"message\"}}`; hãy rẽ nhánh theo `code`.\n"
    "- Giới hạn: 60 request/phút mỗi key, 20 lần đặt đơn/phút mỗi key, 120 request/phút mỗi IP."
)

_ORDER_EXAMPLE = {
    "order": "ORD-7K2M9QXA",
    "status": "delivered",
    "product": "gmail-aged-account-a1b2c3d4",
    "variant": "v_9f3c2a1b",
    "quantity": 2,
    "delivered_quantity": 2,
    "total": 40000,
    "refunded_amount": 0,
    "currency": "VND",
    "created_at": "2026-09-30T08:00:00Z",
    "items": [{"line": 1, "data": "user1@example.com|password1"}, {"line": 2, "data": "user2@example.com|password2"}],
    "items_truncated": False,
}
_ORDER_SUMMARY_EXAMPLE = {k: v for k, v in _ORDER_EXAMPLE.items() if k not in ("items", "items_truncated")} | {
    "status": "processing", "delivered_quantity": 0,
}

# (status, code, message) — every code the /v1 seam can emit.
_ERRORS: dict[str, list[tuple[int, str, str]]] = {
    "auth": [
        (401, "invalid_api_key", "The API key is missing, invalid or revoked."),
        (403, "api_access_disabled", "API access is not enabled for this account."),
        (403, "ip_not_allowed", "This key cannot be used from your IP address."),
        (429, "rate_limited", "Too many requests. Retry after the time in Retry-After."),
        (503, "service_unavailable", "The marketplace is under maintenance. Retry later."),
    ],
    "write": [
        (403, "forbidden_scope", "This key does not have the orders:write scope."),
        (403, "daily_limit_exceeded", "This order would exceed the key's daily spend limit."),
        (400, "idempotency_key_required", "Send an Idempotency-Key header with every POST /v1/orders."),
        (400, "invalid_quantity", "quantity must be a positive integer."),
        (400, "quantity_limit", "Quantity is outside the allowed range for this package."),
        (400, "invalid_request", "The request body or parameters are invalid."),
        (402, "insufficient_balance", "Your wallet balance is too low for this order."),
        (404, "product_not_available", "This package is not available through the API."),
        (409, "idempotency_conflict", "This Idempotency-Key was already used with a different body."),
        (409, "request_in_progress", "A request with this Idempotency-Key is still being processed."),
        (409, "out_of_stock", "Not enough stock for this quantity right now."),
    ],
    "read_order": [(404, "not_found", "Order not found.")],
    "invalid": [(400, "invalid_request", "The request body or parameters are invalid.")],
}

_DOCS: dict[tuple[str, str], dict] = {
    ("get", "/v1/me"): {
        "summary": "Số dư & hạn mức",
        "description": "Trả về số dư ví hiện tại và mức đã chi hôm nay so với hạn mức ngày của key. Cần scope `orders:read`.",
        "errors": ["auth"],
        "example": {"balance": 250000, "currency": "VND", "daily_spend_limit": 1000000, "spent_today": 40000},
    },
    ("get", "/v1/products"): {
        "summary": "Danh mục bán qua API",
        "description": (
            "Liệt kê các sản phẩm và gói (`variants`) được mở bán qua API. Dùng `variants[].id` làm `variant` "
            "khi đặt đơn. `price` là giá mỗi đơn vị (VND); `available` có thể `null` khi kho không đếm được. "
            "Tham số `locale` (`vi`/`en`) chọn ngôn ngữ tên hiển thị."
        ),
        "errors": ["auth", "invalid"],
        "example": {"currency": "VND", "items": [{
            "product": "gmail-aged-account-a1b2c3d4", "title": "Gmail aged account",
            "variants": [{"id": "v_9f3c2a1b", "name": "Aged 1 year", "price": 20000,
                          "min_quantity": 1, "max_quantity": 500, "in_stock": True, "available": 132}],
        }]},
    },
    ("post", "/v1/orders"): {
        "summary": "Đặt đơn",
        "description": (
            "Mua `quantity` đơn vị của gói `variant`, trừ tiền từ ví. Bắt buộc header `Idempotency-Key` "
            "(chuỗi ngẫu nhiên, ví dụ UUID, tối đa 128 ký tự): gửi lại cùng key + cùng body trong 24 giờ sẽ "
            "trả lại đúng kết quả cũ kèm header `Idempotent-Replayed: true`, không tạo đơn mới; cùng key khác "
            "body → `409 idempotency_conflict`. Đơn thường ở trạng thái `processing`; hãy gọi "
            "`GET /v1/orders/{order_code}` để lấy hàng. Cần scope `orders:write`."
        ),
        "errors": ["auth", "write"],
        "example": _ORDER_SUMMARY_EXAMPLE,
        "request_example": {"variant": "v_9f3c2a1b", "quantity": 2},
    },
    ("get", "/v1/orders"): {
        "summary": "Danh sách đơn",
        "description": (
            "Các đơn đặt bằng API của bạn, mới nhất trước. Phân trang bằng `limit` (1–100) và `cursor` "
            "lấy từ `next_cursor` của trang trước; `next_cursor = null` là hết. Không kèm hàng đã giao."
        ),
        "errors": ["auth", "invalid"],
        "example": {"items": [_ORDER_SUMMARY_EXAMPLE], "next_cursor": None},
    },
    ("get", "/v1/orders/{order_code}"): {
        "summary": "Chi tiết đơn & hàng đã giao",
        "description": (
            "Trạng thái đơn (`processing`, `delivered`, `completed`, `disputed`, `refunded`, `failed`) và "
            f"hàng đã giao trong `items` (mỗi dòng một `line` đánh số từ 1). Tối đa {service.ORDER_ITEMS_MAX_LINES} "
            "dòng / 5 MB; vượt quá thì `items_truncated = true` — xem đầy đủ trên website."
        ),
        "errors": ["auth", "read_order"],
        "example": _ORDER_EXAMPLE,
    },
}

_ERROR_SCHEMA = {
    "type": "object",
    "required": ["error"],
    "properties": {"error": {
        "type": "object", "required": ["code", "message"],
        "properties": {
            "code": {"type": "string", "description": "Mã lỗi snake_case ổn định — rẽ nhánh theo trường này."},
            "message": {"type": "string", "description": "Mô tả tiếng Anh cho người đọc; có thể thay đổi."},
        },
    }},
}


def _error_responses(groups: list[str]) -> dict:
    by_status: dict[int, dict] = {}
    for group in groups:
        for status_code, code, message in _ERRORS[group]:
            by_status.setdefault(status_code, {})[code] = {
                "summary": code, "value": {"error": {"code": code, "message": message}},
            }
    return {
        str(status_code): {
            "description": ", ".join(examples),
            "content": {"application/json": {
                "schema": {"$ref": "#/components/schemas/Error"}, "examples": examples,
            }},
        }
        for status_code, examples in sorted(by_status.items())
    }


def _build(server_url: str) -> dict:
    from .router import router

    routes = [r for r in router.routes if isinstance(r, APIRoute) and r.include_in_schema]
    spec = get_openapi(
        title=TITLE, version=VERSION, openapi_version="3.1.0",
        description=_DESCRIPTION, routes=routes,
        servers=[{"url": server_url}],
    )
    components = spec.setdefault("components", {})
    schemas = components.setdefault("schemas", {})
    schemas.pop("HTTPValidationError", None)
    schemas.pop("ValidationError", None)
    schemas["Error"] = _ERROR_SCHEMA
    components["securitySchemes"] = {"bearerAuth": {
        "type": "http", "scheme": "bearer", "bearerFormat": "pk_live_…",
        "description": "API key dạng `pk_live_…` tạo ở Tài khoản › API. Cũng chấp nhận header `X-API-Key`.",
    }}
    spec["security"] = [{"bearerAuth": []}]
    spec["tags"] = [{"name": "Buyer API", "description": "Danh mục, ví và đơn hàng."}]

    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            doc = _DOCS.get((method, path), {})
            op["tags"] = ["Buyer API"]
            op["summary"] = doc.get("summary", op.get("summary"))
            if "description" in doc:
                op["description"] = doc["description"]
            responses = op.setdefault("responses", {})
            responses.pop("422", None)
            ok = next((c for c in ("200", "201") if c in responses), None)
            if ok and "example" in doc:
                responses[ok]["content"]["application/json"]["example"] = deepcopy(doc["example"])
            if method == "post" and path == "/v1/orders":
                responses["200"] = {
                    "description": "Idempotent replay: cùng Idempotency-Key + cùng body, trả lại kết quả cũ.",
                    "headers": {"Idempotent-Replayed": {"schema": {"type": "string", "enum": ["true"]}}},
                    "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/V1Order"}, "example": deepcopy(doc["example"]),
                    }},
                }
                op["requestBody"]["content"]["application/json"]["example"] = doc["request_example"]
                for param in op.get("parameters", []):
                    if param.get("name") == "Idempotency-Key":
                        param["required"] = True
                        param["description"] = "Khóa duy nhất cho mỗi lần đặt đơn (ví dụ UUID v4), tối đa 128 ký tự; giữ 24 giờ."
                        param["schema"] = {"type": "string", "maxLength": service.IDEMPOTENCY_KEY_MAX}
                        param["example"] = "7f9c2b1e-4d3a-4c55-9a8e-2f1b6d0c9e41"
            if path == "/v1/orders/{order_code}":
                for param in op.get("parameters", []):
                    if param.get("name") == "order_code":
                        param["description"] = "Mã đơn `ORD-…` trả về khi đặt đơn."
                        param["example"] = "ORD-7K2M9QXA"
            responses.update(_error_responses(doc.get("errors", ["auth"])))
    return spec


@lru_cache(maxsize=4)
def public_openapi(server_url: str | None = None) -> dict:
    return _build((server_url or settings.backend_base_url).rstrip("/"))
