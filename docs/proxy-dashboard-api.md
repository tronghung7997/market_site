# Buyer proxy dashboard — API contract (`/proxies`)

Cập nhật 2026-09-23. Nhánh `feat/dproxy-internal-seller`. Thay lớp mock
`features/buyer-proxies/store.ts` (port từ worktree `market_site-proxy-dashboard`)
bằng API thật. Buyer **không bao giờ** thấy nguồn hàng: không có trường
`provider` / `adapter_type` / tên nhà cung cấp.

## Loại proxy = 3 chiều (cố định trong code)

| Chiều | Giá trị | Nguồn |
|---|---|---|
| `ip_type` | `residential` · `mobile` · `datacenter` | Chốt lúc giao từ gói đã bán (mã loại của gói; TopProxy theo `loaiproxy`) |
| `rotation` | `static` · `rotating` · `rotating_key` | `rotating_key` = key xoay qua cổng cố định (TopProxy xoay). Còn lại tính **lúc đọc** từ node thật: `rotating` khi `rotation_available`, không thì `static` |
| `country`, `network` | vd `VN`, `Viettel` / `Việt Nam` | Nhãn gói (`network_display`), chốt lúc giao |

Nhãn hiển thị ghép từ 3 chiều ở frontend (vd `residential` + `rotating` → "Dân cư xoay").

## Dòng proxy — `ProxyLine`

Một dòng = một `proxy_allocations` (hiện 1 dòng/đơn → `line_no = 1`).

```jsonc
{
  "id": "ORD-LUAVGKHU#01",          // public, không bao giờ là row id
  "order_code": "ORD-LUAVGKHU",
  "line_no": 1,
  "product_title": "Proxy dân cư Việt Nam 7 ngày",
  "variant_name": "Residential · Việt Nam · 7 ngày",   // nhãn gói
  "ip_type": "residential",
  "rotation": "rotating",
  "protocol": "HTTP",                // "HTTP" | "SOCKS5"
  "network": "Việt Nam",
  "country": "VN",                   // có thể null
  "host": "203.0.113.15", "port": 20165,
  "username": "u_mock_5", "password": "mock-pass-5",   // null khi key xoay xác thực bằng IP
  "public_ip": "203.0.113.201",
  "status": "allocated",             // allocated|offline|expired|released|error
  "created_at": "…", "expires_at": "…",
  "rotation_available": true,
  "cooldown_seconds": 15, "last_rotated_at": "…",
  "whitelist_supported": false, "whitelist_ips": null,
  "socks5_port": null,
  "credentials_editable": false,     // chưa nguồn nào hỗ trợ qua API
  "replaceable": false,
  "renew_mode": null,                // chưa có gia hạn — UI ẩn nút gia hạn
  "plan_days": 7,
  "last_check": null,
  "tag_ids": ["t8k2m4qa"],
  "note": "",
  "auto_renew_days": null
}
```

## Endpoints (buyer đăng nhập, qua BFF `/api`)

| Method | Path | Body / query | Trả |
|---|---|---|---|
| GET | `/me/proxies` | `status=running\|soon\|problem`, `q`, `tags=a,b` (`__none__` = chưa gắn tag), `ip_type=a,b`, `rotation=a,b`, `expires=24h\|3d\|7d\|expired`, `sort=expiry_asc\|expiry_desc\|newest\|line`, `page`, `per_page` (25/50/100) | `{items: ProxyLine[], total, page, per_page, summary, facets}` — xem dưới |
| GET | `/me/proxy-tags` | — | `ProxyTag[]` `{id, name, tone, created_at, count}` |
| POST | `/me/proxy-tags` | `{name, tone}` | `ProxyTag` (409 trùng tên) |
| PATCH | `/me/proxy-tags/{id}` | `{name?, tone?}` | `ProxyTag` |
| DELETE | `/me/proxy-tags/{id}` | — | 204 (gỡ khỏi mọi dòng) |
| POST | `/me/proxies/tags` | `{line_ids, add: [tagId], remove: [tagId], mode: "merge"\|"replace"}` | `{updated}` |
| PATCH | `/me/proxies/note` | `{line_id, note}` (≤ 200 ký tự) | `ProxyLine` |
| POST | `/orders/{order_code}/proxy/rotate` | (có sẵn) | trạng thái proxy mới; 429 cooldown |
| PUT | `/orders/{order_code}/proxy/whitelist` | `{ips: [ipv4]}` (có sẵn) | trạng thái proxy |

Mọi bộ lọc kết hợp đồng thời (AND). `summary` = `{all, running, soon, problem}`
trên **toàn bộ** proxy của buyer. `facets` = số đếm theo bộ lọc hiện tại, mỗi
chiều đếm theo các chiều **khác** (chọn "IP tĩnh" không làm các giá trị khác
của chiều đổi IP về 0):

```jsonc
"facets": {
  "status":   {"all": 1, "running": 1, "soon": 1, "problem": 0},
  "ip_type":  {"residential": 1, "mobile": 0, "datacenter": 0},
  "rotation": {"static": 0, "rotating": 0, "rotating_key": 1},
  "expires":  {"24h": 0, "3d": 1, "7d": 1, "expired": 0},
  "tags":     {"<tagId>": 1, "__none__": 1}
}
```

`tone` ∈ `iris|good|warn|neutral|ink`. `status` tab tính theo đồng hồ:
`running` = allocated và chưa quá `expires_at`; `soon` = đang chạy và hết hạn
trong 3 ngày; `problem` = offline|error|expired, hoặc allocated nhưng đã quá
`expires_at` (dòng đó trả `status: "expired"`).

Chưa có backend (UI ẩn thao tác, không giả lập): gia hạn, kiểm tra live,
đổi thông tin đăng nhập, thay IP, tự gia hạn.
