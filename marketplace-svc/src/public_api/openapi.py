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

def _description() -> str:
    """The hand-written guide, as Markdown: Scalar lists every `##` heading in
    its sidebar under the `#` heading ("Hướng dẫn")."""
    wait_max, wait_default = service.ORDER_WAIT_MAX_SECONDS, service.ORDER_WAIT_DEFAULT_SECONDS
    return f"""# Hướng dẫn

API bán hàng cho người mua: xem danh mục, đặt đơn bằng số dư ví và nhận hàng ngay trong script của bạn.
Đơn qua API là đơn bình thường — cùng giá, ký quỹ, hoàn tiền và khiếu nại như trên website.

## Bắt đầu nhanh

1. Tạo key `pk_live_…` ở **Tài khoản › API** (mọi tài khoản đã xác minh email đều dùng được).
2. Gọi `GET /v1/products` để lấy `variants[].id` (hàng theo gói) hoặc `options` (proxy, gói request…).
3. Gọi `POST /v1/orders` — **một lệnh** trừ tiền và trả về hàng đã giao trong `items`:

```bash
curl -X POST "$BASE/v1/orders" \\
  -H "Authorization: Bearer pk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{{"variant": "v_9f3c2a1b", "quantity": 2}}'
```

```json
{{"order": "ORD-7K2M9QXA", "status": "delivered", "total": 40000,
 "items": [{{"line": 1, "data": "tok_…"}}, {{"line": 2, "data": "tok_…"}}]}}
```

## Xác thực

Gửi key trong header `Authorization: Bearer pk_live_…` (hoặc `X-API-Key: pk_live_…`). Key chỉ hiện một lần khi
tạo; có thể giới hạn scope (`orders:read`, `orders:write`), danh sách IP và hạn mức chi mỗi ngày. Tiền tệ là số
nguyên VND, không có phần thập phân.

## Chờ kết quả

`POST /v1/orders` giữ request tối đa `wait` giây (0–{wait_max}, mặc định {wait_default}) trong lúc giao hàng:

| HTTP | Nghĩa |
|---|---|
| `201` | Đơn đã xong: `delivered` (hàng trong `items` / `gateway`), hoặc `failed` / `refunded` (đã hoàn tiền). |
| `202` | Hết thời gian chờ mà đơn vẫn `processing` — gọi `GET /v1/orders/{{order}}?wait=20` để lấy hàng. |

`wait=0` trả về ngay. `GET /v1/orders/{{order}}?wait=…` (mặc định 0) chờ tương tự rồi luôn trả `200`. Mỗi key chờ
đồng thời tối đa {service.ORDER_WAITERS_PER_KEY} request; vượt quá thì trả về ngay. Hết thời gian chờ không huỷ việc giao hàng.

## Gửi lại an toàn

Header `Idempotency-Key` là **tuỳ chọn nhưng nên gửi**: mỗi đơn một chuỗi ngẫu nhiên (UUID), tối đa
{service.IDEMPOTENCY_KEY_MAX} ký tự. Gửi lại cùng key + cùng body trong 24 giờ (ví dụ sau khi mất kết nối) trả lại
đúng đơn cũ kèm `Idempotent-Replayed: true` và không trừ tiền lần hai; nếu đơn còn đang giao, lần gửi lại cũng chờ
như request gốc. Cùng key khác body → `409 idempotency_conflict`. Không gửi key thì mỗi request là một đơn mới.

## Giới hạn

| Giới hạn | Mức |
|---|---|
| Request mỗi key | 60 / phút |
| Đặt đơn mỗi key | 20 / phút |
| Request mỗi IP | 120 / phút |
| Chi tiêu mỗi key | hạn mức ngày đặt ở Tài khoản › API (giờ Việt Nam) |

Vượt giới hạn tốc độ → `429 rate_limited` kèm `Retry-After`.

## Mã lỗi

Mọi lỗi có dạng `{{"error": {{"code": "…", "message": "…"}}}}`; hãy rẽ nhánh theo `code`, `message` chỉ để đọc.

{_errors_table()}

## Code mẫu

Python (`requests`):

```python
import uuid, requests

BASE = "https://<api-host>/v1"
headers = {{"Authorization": "Bearer pk_live_…", "Idempotency-Key": str(uuid.uuid4())}}
r = requests.post(f"{{BASE}}/orders", json={{"variant": "v_9f3c2a1b", "quantity": 1}}, headers=headers, timeout=40)
order = r.json()
while r.status_code == 202:  # still processing: wait on the order
    r = requests.get(f"{{BASE}}/orders/{{order['order']}}?wait=20", headers=headers, timeout=40)
    order = r.json()
    if order["status"] != "processing":
        break
print(order["status"], [i["data"] for i in order.get("items") or []])
```

JavaScript (Node 18+):

```js
const BASE = "https://<api-host>/v1";
const headers = {{ Authorization: "Bearer pk_live_…", "Content-Type": "application/json",
                  "Idempotency-Key": crypto.randomUUID() }};
let res = await fetch(`${{BASE}}/orders`, {{ method: "POST", headers,
  body: JSON.stringify({{ variant: "v_9f3c2a1b", quantity: 1 }}) }});
let order = await res.json();
while (order.status === "processing") {{
  order = await (await fetch(`${{BASE}}/orders/${{order.order}}?wait=20`, {{ headers }})).json();
}}
console.log(order.status, (order.items ?? []).map((i) => i.data));
```
"""

_ORDER_EXAMPLE = {
    "order": "ORD-7K2M9QXA",
    "status": "delivered",
    "kind": "account",
    "product": "gmail-aged-account-a1b2c3d4",
    "product_title": "Gmail aged account",
    "variant": "v_9f3c2a1b",
    "variant_name": "Aged 1 year",
    "quantity": 2,
    "delivered_quantity": 2,
    "total": 40000,
    "refunded_amount": 0,
    "currency": "VND",
    "created_at": "2026-09-30T08:00:00Z",
    "items": [{"line": 1, "data": "user1@example.com|password1"}, {"line": 2, "data": "user2@example.com|password2"}],
    "items_truncated": False,
    "gateway": None,
}
_PROXY_ORDER_EXAMPLE = _ORDER_EXAMPLE | {
    "order": "ORD-3PX8V2NE", "kind": "proxy", "product": "proxy-viettel-k7f3q9x2",
    "product_title": "Proxy tĩnh Viettel", "variant": None, "variant_name": None, "total": 120000,
    "items": [{"line": 1, "data": "103.45.10.2:8080:px_user:px_pass"},
              {"line": 2, "data": "103.45.10.3:8080:px_user2:px_pass2"}],
}
_GATEWAY_ORDER_EXAMPLE = _ORDER_EXAMPLE | {
    "order": "ORD-9GW4T6RA", "kind": "gateway", "product": "facebook-lookup-api-m2n4p6q8",
    "product_title": "Facebook lookup API", "variant": None, "variant_name": None, "quantity": 1000,
    "delivered_quantity": 1000, "total": 200000, "items": None, "items_truncated": None,
    "gateway": {"url": "https://api.example.com/gw/gwk_live_…/<endpoint>", "key": "gwk_live_…",
                "key_hint": "gwk_live_AbCdEfG...wxyz"},
}
_ORDER_SUMMARY_EXAMPLE = {k: v for k, v in _ORDER_EXAMPLE.items() if k not in ("items", "items_truncated", "gateway")} | {
    "status": "processing", "delivered_quantity": 0,
}

_PROCESSING_ORDER_EXAMPLE = _ORDER_EXAMPLE | {"status": "processing", "delivered_quantity": 0, "items": []}

_PRODUCTS_EXAMPLE = {"currency": "VND", "items": [
    {
        "product": "gmail-aged-account-a1b2c3d4", "title": "Gmail aged account", "kind": "account",
        "variants": [{"id": "v_9f3c2a1b", "name": "Aged 1 year", "price": 20000,
                      "min_quantity": 1, "max_quantity": 500, "in_stock": True, "available": 132}],
        "options": None, "quantity": None,
    },
    {
        "product": "proxy-viettel-k7f3q9x2", "title": "Proxy tĩnh Viettel", "kind": "proxy", "variants": [],
        "options": [{"name": "plan_key", "type": "enum", "label": "Gói proxy", "required": True, "values": [
            {"value": "HTTP|Viettel|30", "label": "HTTP · Viettel · 30 ngày"},
        ]}],
        "quantity": {"min": 1, "max": 50},
    },
    {
        "product": "facebook-lookup-api-m2n4p6q8", "title": "Facebook lookup API", "kind": "gateway", "variants": [],
        "options": [{"name": "package_size", "type": "enum", "label": "Số request trong gói", "required": True,
                     "values": [{"value": 1000, "label": "1.000 request", "price": 200000}]}],
        "quantity": {"min": 1, "max": 1},
    },
]}

_OPTIONS_HELP = (
    "Sản phẩm có hai cách mua:\n\n"
    "- **Theo gói** (`variants` không rỗng — tài khoản, token…): gửi `{\"variant\": \"<variants[].id>\", "
    "\"quantity\": N}`.\n"
    "- **Theo tuỳ chọn** (`options` khác `null` — proxy, gói request gateway, dịch vụ): gửi "
    "`{\"product\": \"<product>\", \"options\": {\"<options[].name>\": <giá trị>}, \"quantity\": N}`. "
    "Với `type = enum` hãy gửi đúng một `values[].value` (giữ nguyên kiểu số/chuỗi); `integer` là số nguyên trong "
    "`min`…`max`; `text` là chuỗi nhiều dòng (ví dụ mỗi dòng một URL). `quantity` nằm trong `quantity.min`…"
    "`quantity.max` (bỏ trống = 1); với gói request, kích thước gói là tuỳ chọn `package_size` và `quantity` "
    "luôn là 1.\n\n"
    "`kind` cho biết dạng hàng nhận được: `account`/`token`/`proxy` giao từng dòng trong `items`, `gateway` giao "
    "`gateway.url` + `gateway.key` để gọi `/gw/{key}/<endpoint>`, `service` là dịch vụ xử lý theo đơn."
)

_ORDER_BODY_EXAMPLES = {
    "variant": {"summary": "Theo gói (tài khoản, token)", "value": {"variant": "v_9f3c2a1b", "quantity": 2}},
    "proxy": {"summary": "Proxy theo tuỳ chọn", "value": {
        "product": "proxy-viettel-k7f3q9x2", "options": {"plan_key": "HTTP|Viettel|30"}, "quantity": 2}},
    "gateway": {"summary": "Gói request gateway", "value": {
        "product": "facebook-lookup-api-m2n4p6q8", "options": {"package_size": 1000}}},
}

# (status, code, message) — every code the /v1 seam can emit.
_ERRORS: dict[str, list[tuple[int, str, str]]] = {
    "auth": [
        (401, "invalid_api_key", "The API key is missing, invalid or revoked."),
        (403, "api_access_disabled", "API access is suspended for this account."),
        (403, "ip_not_allowed", "This key cannot be used from your IP address."),
        (429, "rate_limited", "Too many requests. Retry after the time in Retry-After."),
        (503, "service_unavailable", "The marketplace is under maintenance. Retry later."),
    ],
    "body": [
        (400, "invalid_quantity", "quantity must be a positive integer."),
        (400, "quantity_limit", "Quantity is outside the allowed range for this product."),
        (400, "invalid_options", "The options are not valid for this product."),
        (400, "invalid_request", "The request body or parameters are invalid."),
        (404, "product_not_available", "This product is not available through the API."),
    ],
    "write": [
        (403, "forbidden_scope", "This key does not have the orders:write scope."),
        (403, "daily_limit_exceeded", "This order would exceed the key's daily spend limit."),
        (402, "insufficient_balance", "Your wallet balance is too low for this order."),
        (409, "idempotency_conflict", "This Idempotency-Key was already used with a different body."),
        (409, "request_in_progress", "A request with this Idempotency-Key is still being processed."),
        (409, "out_of_stock", "Not enough stock for this quantity right now."),
    ],
    "product": [(404, "product_not_available", "This product is not available through the API.")],
    "read_order": [(404, "not_found", "Order not found.")],
    "rotate": [
        (403, "forbidden_scope", "This key does not have the orders:write scope."),
        (400, "not_a_gateway_order", "This order has no gateway key."),
        (404, "not_found", "Order not found."),
    ],
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
            "Liệt kê các sản phẩm được mở bán qua API. `price` là giá mỗi đơn vị (VND); `available` có thể `null` "
            "khi kho không đếm được. Tham số `locale` (`vi`/`en`, mặc định `en`) chọn ngôn ngữ tên hiển thị.\n\n"
            + _OPTIONS_HELP
        ),
        "errors": ["auth", "invalid"],
        "example": _PRODUCTS_EXAMPLE,
    },
    ("get", "/v1/products/{product}"): {
        "summary": "Chi tiết một sản phẩm",
        "description": (
            "Cùng dữ liệu với một phần tử của `GET /v1/products`, theo mã `product` (`slug-key`). "
            "`404 product_not_available` khi sản phẩm không còn bán qua API hoặc tạm ngừng."
        ),
        "errors": ["auth", "product"],
        "example": _PRODUCTS_EXAMPLE["items"][1],
    },
    ("post", "/v1/orders/quote"): {
        "summary": "Báo giá (không trừ tiền)",
        "description": (
            "Cùng body với `POST /v1/orders`; trả về `total` mà đơn sẽ bị trừ, không tạo đơn, không trừ ví, "
            "không cần `Idempotency-Key`. Cần scope `orders:read`."
        ),
        "errors": ["auth", "body"],
        "example": {"total": 120000, "currency": "VND"},
        "body_examples": True,
    },
    ("post", "/v1/orders"): {
        "summary": "Đặt đơn",
        "description": (
            "Đặt đơn theo gói (`variant` + `quantity`) hoặc theo tuỳ chọn (`product` + `options` + `quantity`), "
            "trừ tiền từ ví — cùng kiểm tra, giá, ký quỹ và hoàn tiền như khi mua trên website. Header "
            "`Idempotency-Key` là tuỳ chọn nhưng nên gửi để thử lại an toàn (chuỗi ngẫu nhiên, ví dụ UUID, tối đa 128 "
            "ký tự): gửi lại cùng key + cùng body trong 24 giờ sẽ trả lại đúng đơn cũ kèm header "
            "`Idempotent-Replayed: true`, không trừ tiền lần hai; cùng key khác body → `409 idempotency_conflict`. "
            "Không gửi key thì mỗi request là một đơn mới. Hạn mức ngày của key được giữ theo tổng báo giá của đơn.\n\n"
            f"API chờ giao hàng ngay trong request: tối đa `wait` giây (0–{service.ORDER_WAIT_MAX_SECONDS}, mặc định "
            f"{service.ORDER_WAIT_DEFAULT_SECONDS}). `201` — đơn đã xong (`delivered`, `failed`, `refunded`…), hàng nằm "
            "trong `items`/`gateway`; `202` — đơn vẫn `processing` khi hết thời gian chờ: gọi "
            "`GET /v1/orders/{order_code}?wait=…` để lấy hàng. `wait=0` trả về ngay. Gửi lại cùng key + body khi đơn "
            f"đang xử lý cũng chờ như vậy. Mỗi key chờ đồng thời tối đa {service.ORDER_WAITERS_PER_KEY} request; vượt "
            "quá thì trả về ngay. Hết thời gian chờ không huỷ việc giao hàng. Cần scope `orders:write`.\n\n"
            + _OPTIONS_HELP
        ),
        "errors": ["auth", "body", "write"],
        "example": _ORDER_EXAMPLE,
        "body_examples": True,
    },
    ("get", "/v1/orders"): {
        "summary": "Danh sách đơn",
        "description": (
            "Các đơn của bạn, mới nhất trước, kèm `kind`, `product_title` và `variant_name` (theo `locale`). "
            "Phân trang bằng `limit` (1–100) và `cursor` lấy từ `next_cursor` của trang trước; `next_cursor = null` "
            "là hết. Không kèm hàng đã giao."
        ),
        "errors": ["auth", "invalid"],
        "example": {"items": [_ORDER_SUMMARY_EXAMPLE], "next_cursor": None},
    },
    ("get", "/v1/orders/{order_code}"): {
        "summary": "Chi tiết đơn & hàng đã giao",
        "description": (
            "Trạng thái đơn (`processing`, `delivered`, `completed`, `disputed`, `refunded`, `failed`) và hàng "
            f"đã giao. Tài khoản, token và proxy nằm trong `items` (mỗi dòng một `line` đánh số từ 1; với proxy "
            f"mỗi proxy là một item, `line` trùng số `#NN` trên website, `data` dạng `host:port:user:pass`). Tối đa "
            f"{service.ORDER_ITEMS_MAX_LINES} dòng / 5 MB; vượt quá thì `items_truncated = true` — xem đầy đủ trên "
            "website. Đơn gói request (`kind = gateway`) không có `items` mà có `gateway`: gọi "
            "`gateway.url` (thay `<endpoint>`) với key `gateway.key`; `key_hint` là dạng rút gọn để đối chiếu. "
            f"`wait` (0–{service.ORDER_WAIT_MAX_SECONDS} giây, mặc định 0): khi đơn còn `processing`, giữ request đến "
            "khi đơn xong hoặc hết thời gian rồi trả trạng thái lúc đó (luôn `200`)."
        ),
        "errors": ["auth", "read_order"],
        "example": _ORDER_EXAMPLE,
        "examples": {"account": _ORDER_EXAMPLE, "proxy": _PROXY_ORDER_EXAMPLE, "gateway": _GATEWAY_ORDER_EXAMPLE},
    },
    ("post", "/v1/orders/{order_code}/gateway-key/rotate"): {
        "summary": "Đổi gateway key",
        "description": (
            "Cấp key mới cho đơn gói request (`kind = gateway`); key cũ ngừng hoạt động ngay. Trả về `url` và "
            "`key` mới (cũng hiện trong `GET /v1/orders/{order_code}` từ lúc này). Cần scope `orders:write`."
        ),
        "errors": ["auth", "rotate"],
        "example": {"url": "https://api.example.com/gw/gwk_live_…/<endpoint>", "key": "gwk_live_…",
                    "key_hint": "gwk_live_AbCdEfG...wxyz"},
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



def _errors_table() -> str:
    seen: dict[str, tuple[int, str]] = {}
    for rows in _ERRORS.values():
        for status_code, code, message in rows:
            seen.setdefault(code, (status_code, message))
    lines = ["| HTTP | `code` | Ý nghĩa |", "|---|---|---|"]
    lines += [f"| {st} | `{code}` | {msg} |" for code, (st, msg) in sorted(seen.items(), key=lambda kv: (kv[1][0], kv[0]))]
    return "\n".join(lines)

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


_TAGS = {"me": "Tài khoản", "products": "Sản phẩm", "orders": "Đơn hàng"}


def _build(server_url: str) -> dict:
    from .router import router

    routes = [r for r in router.routes if isinstance(r, APIRoute) and r.include_in_schema]
    spec = get_openapi(
        title=TITLE, version=VERSION, openapi_version="3.1.0",
        description=_description(), routes=routes,
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
    spec["tags"] = [
        {"name": "Tài khoản", "description": "Số dư ví và hạn mức chi của key."},
        {"name": "Sản phẩm", "description": "Danh mục bán qua API: gói, tuỳ chọn và tồn kho."},
        {"name": "Đơn hàng", "description": "Báo giá, đặt đơn, chờ giao hàng và lấy hàng đã giao."},
    ]

    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            doc = _DOCS.get((method, path), {})
            op["tags"] = [_TAGS[path.split("/")[2]]]
            op["summary"] = doc.get("summary", op.get("summary"))
            if "description" in doc:
                op["description"] = doc["description"]
            responses = op.setdefault("responses", {})
            responses.pop("422", None)
            ok = next((c for c in ("200", "201") if c in responses), None)
            if ok and "examples" in doc:
                responses[ok]["content"]["application/json"]["examples"] = {
                    name: {"summary": name, "value": deepcopy(value)} for name, value in doc["examples"].items()
                }
            elif ok and "example" in doc:
                responses[ok]["content"]["application/json"]["example"] = deepcopy(doc["example"])
            if doc.get("body_examples"):
                op["requestBody"]["content"]["application/json"]["examples"] = deepcopy(_ORDER_BODY_EXAMPLES)
            if method == "post" and path == "/v1/orders":
                replay_header = {"Idempotent-Replayed": {
                    "description": "`true` khi là lần gửi lại cùng Idempotency-Key + body (không tạo đơn mới).",
                    "schema": {"type": "string", "enum": ["true"]},
                }}
                responses["201"]["description"] = "Đơn đã xong (đã giao hoặc thất bại) trong thời gian chờ."
                responses["201"]["headers"] = deepcopy(replay_header)
                responses["202"] = {
                    "description": "Đơn vẫn đang xử lý khi hết `wait`; lấy hàng bằng GET /v1/orders/{order_code}.",
                    "headers": deepcopy(replay_header),
                    "content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/V1Order"},
                        "example": deepcopy(_PROCESSING_ORDER_EXAMPLE),
                    }},
                }
                for param in op.get("parameters", []):
                    if param.get("name") == "Idempotency-Key":
                        param["required"] = False
                        param["description"] = (
                            "Tuỳ chọn, nên gửi để thử lại an toàn: khóa duy nhất cho mỗi đơn (ví dụ UUID v4), tối đa "
                            "128 ký tự; giữ 24 giờ. Không gửi thì mỗi request là một đơn mới."
                        )
                        param["schema"] = {"type": "string", "maxLength": service.IDEMPOTENCY_KEY_MAX}
                        param["example"] = "7f9c2b1e-4d3a-4c55-9a8e-2f1b6d0c9e41"
            for param in op.get("parameters", []):
                if param.get("name") == "wait":
                    param["description"] = (
                        "Số giây tối đa chờ đơn xong trước khi trả lời "
                        f"(0–{service.ORDER_WAIT_MAX_SECONDS}; mặc định "
                        f"{service.ORDER_WAIT_DEFAULT_SECONDS if method == 'post' else 0})."
                    )
                    param["example"] = 25 if method == "post" else 10
                elif param.get("name") == "order_code":
                    param["description"] = "Mã đơn `ORD-…` trả về khi đặt đơn."
                    param["example"] = "ORD-7K2M9QXA"
                elif param.get("name") == "product":
                    param["description"] = "Mã sản phẩm `slug-key` lấy từ `GET /v1/products`."
                    param["example"] = "proxy-viettel-k7f3q9x2"
            responses.update(_error_responses(doc.get("errors", ["auth"])))
    return spec


@lru_cache(maxsize=4)
def public_openapi(server_url: str | None = None) -> dict:
    return _build((server_url or settings.backend_base_url).rstrip("/"))
