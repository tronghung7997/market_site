# Proxora — Site Inventory (phục vụ Redesign)

> Tổng hợp toàn bộ cấu trúc và chức năng đang hoạt động của nền tảng, khảo sát ngày 2026-07-02.
> Proxora: marketplace bán tài khoản, proxy và dữ liệu số cho doanh nghiệp — ký quỹ an toàn, giao ngay.

## 1. Tổng quan kiến trúc

| Layer | Công nghệ |
|---|---|
| Frontend | Next.js 15, React 19, TailwindCSS, TanStack Query/Table, Recharts, Framer Motion (port 3000) |
| Backend API | FastAPI, SQLAlchemy async, Pydantic v2, APScheduler (`marketplace-svc`, port 8001) |
| Database | PostgreSQL 17 |
| Cache / Queue | Redis 7, RabbitMQ 4 |
| Auth | JWT (access + refresh token), PyJWT + bcrypt |
| Runtime | Python 3.13, Node.js 20+, Docker Compose |

**3 vai trò:** `buyer` → `seller` (nộp đơn `POST /seller/apply`, admin duyệt) → `admin`.
Navigation nhận biết role: `frontend/components/TopNav.tsx`.

## 2. Chức năng theo khu vực

### 2.1. Khu vực công khai / Buyer

| Trang | Chức năng |
|---|---|
| `/` | Chợ sản phẩm (trang chủ, danh sách + tìm kiếm) |
| `/categories` | Duyệt theo danh mục |
| `/products/[id]` | Chi tiết sản phẩm: variants, tính giá động, form đặt hàng động (`DynamicOrderForm`), reviews |
| `/orders` | Đơn hàng của buyer: xác nhận nhận hàng, mở khiếu nại, xem tài nguyên được giao, dashboard theo dõi dịch vụ (`ServiceDashboard`) |
| `/wallet` | Số dư, nạp tiền (có demo-topup), rút tiền, lịch sử giao dịch |
| `/affiliate` | Dashboard affiliate: link giới thiệu, thống kê click / hoa hồng |
| `/solutions` | Landing page giải pháp (marketing) |
| `/login`, `/register` | Xác thực JWT |

Component `ReferralCapture` bắt mã giới thiệu `?ref=` trên toàn site (dedup click theo visitor / 24h).

### 2.2. Seller portal (`/seller/*`)

- **Dashboard** (`/seller`): thống kê bán hàng (`GET /seller/stats`), cảnh báo riêng (`GET /seller/alerts`).
- **Sản phẩm** (`/seller/products`, `/new`, `/[id]`): CRUD sản phẩm + variants; delivery mode `instant` (kho tự động) hoặc `manual`.
- **Kho tài nguyên**: nạp resource (tài khoản/proxy) vào variant, xóa, báo lỗi. Vòng đời resource: `available → assigned → expired / error`.
- **Đơn hàng** (`/seller/orders`): nhận đơn (`accept`), giao hàng (`deliver`), phản hồi khiếu nại (`respond`).
- **Trở thành seller**: buyer gửi `POST /seller/apply` → admin approve/reject.

### 2.3. Admin console (`/admin/*`) — 14 trang

| Trang | Chức năng |
|---|---|
| `/admin` | Tổng quan: KPIs, biểu đồ, trạng thái hệ thống |
| `/admin/orders` | Toàn bộ đơn hàng hệ thống |
| `/admin/products` (+ `/[id]`) | Quản lý / sửa / suspend sản phẩm, cấu hình operations |
| `/admin/disputes` | Trọng tài khiếu nại: hoàn tiền hoặc từ chối |
| `/admin/accounts` | Quản lý tài khoản + gán role |
| `/admin/categories` | CRUD danh mục |
| `/admin/providers` | Nhà cung cấp ngoài: tạo/sửa, health check, test kết nối, chấm điểm uy tín |
| `/admin/resources` | Toàn bộ kho tài nguyên + summary |
| `/admin/affiliates` (+ `/[id]`) | Quản lý affiliate: stats từng người, đổi mã, quỹ hoa hồng (topup fund) |
| `/admin/alerts` | Cảnh báo hệ thống, dismiss |
| `/admin/tasks` | Tác vụ nền (service tasks) |
| `/admin/reports` | Báo cáo |
| `/admin/logs` | Audit log toàn hệ thống |
| (trong accounts) | Duyệt đơn seller: `/admin/seller-applications` approve/reject |

## 3. Luồng nghiệp vụ cốt lõi

### 3.1. Vòng đời đơn hàng (escrow là trung tâm)

```
pending → processing → delivered → completed
                └→ disputed → refunded
                └→ cancelled
```

- Khi mua: tiền bị giữ ký quỹ (`purchase_hold`).
- Buyer xác nhận hoặc hết hạn escrow (job 30'/lần) → giải phóng cho seller (`purchase_release`) trừ phí nền tảng (`platform_fee`, env `PLATFORM_FEE_PERCENT`).

### 3.2. Khiếu nại 3 bên

Buyer mở dispute → seller phản hồi → admin phán quyết (`resolved_refund` / `resolved_reject`).

### 3.3. Pricing động — 4 chiến lược (`src/pricing/`)

| Mode | Mô tả |
|---|---|
| `fixed` | Giá cố định |
| `config` | Theo cấu hình (tiered) |
| `credit` | Theo credit |
| `task` | Theo tác vụ |

Frontend gọi `GET /products/{id}/pricing-options` + `POST /products/{id}/calculate` để tính giá realtime trước khi đặt.

### 3.4. Giao hàng tự động (adapters `src/adapters/`)

`manual`, `mock`, `seller_pool` (lấy resource từ kho seller). Đơn `instant` tự gán resource qua `POST /internal/resources/acquire` / `release`.

### 3.5. Affiliate / Referral

- Bắt click qua `?ref=`, dedup theo visitor / 24h.
- Hoa hồng ghi vào ví (transaction type `affiliate_commission`).
- Quỹ hoa hồng riêng (`affiliate_fund_entries`), admin topup.
- Trang stats cho user (`/affiliate`) và admin (`/admin/affiliates`).

### 3.6. Ví & rút tiền

- 7 loại giao dịch: `topup`, `purchase_hold`, `purchase_release`, `platform_fee`, `withdraw`, `refund`, `affiliate_commission`.
- Rút tiền: `WithdrawRequest` pending → admin approve/reject (`/admin/withdrawals`).

### 3.7. Reviews

Buyer review theo đơn hàng (`POST /orders/{id}/review`), hiển thị ở trang sản phẩm (`GET /products/{id}/reviews`).

### 3.8. Jobs nền (APScheduler, `src/scheduler.py`)

| Job | Interval | Chức năng |
|---|---|---|
| `escrow_release` | 30 phút | Giải phóng tiền ký quỹ khi hết hạn |
| `sla_check` | 10 phút | Kiểm tra đơn quá SLA |
| `health_check` | 15 phút | Ping provider health |
| `resource_expire` | 15 phút | Đánh dấu tài nguyên hết hạn |
| `provider_scoring` | 15 phút | Tính điểm uy tín provider |

## 4. Trạng thái & Enum chính (models)

| Enum | Giá trị |
|---|---|
| `AccountRole` | buyer, seller, admin |
| `OrderStatus` | pending, processing, delivered, completed, disputed, refunded, cancelled |
| `DisputeStatus` | open, resolved_refund, resolved_reject |
| `ProductStatus` | draft, active, paused, suspended |
| `DeliveryMode` | instant, manual |
| `ServiceType` | proxy, account, token, endpoint, takedown, cloud, payment, other |
| `ResourceStatus` | available, assigned, expired, error |
| `TransactionType` | topup, purchase_hold, purchase_release, platform_fee, withdraw, refund, affiliate_commission |
| `WithdrawStatus` | pending, approved, rejected |
| `ApplicationStatus` | pending, approved, rejected |

## 5. Bề mặt API (~88 endpoints, 16 module)

Prefix quy ước: public (`/products`, `/categories`, `/providers`) · user (`/orders`, `/wallet`, `/affiliate`, `/me`) · `/seller/*` · `/admin/*` · `/internal/*`.

### auth
```
POST  /auth/register
POST  /auth/login
POST  /auth/refresh
GET   /me
GET   /admin/accounts
PATCH /admin/accounts/{account_id}/roles
```

### products
```
GET    /products
GET    /products/{product_id}
GET    /seller/products
GET    /seller/stats
POST   /seller/products
PATCH  /seller/products/{product_id}
DELETE /seller/products/{product_id}
POST   /seller/products/{product_id}/variants
PATCH  /seller/variants/{variant_id}
DELETE /seller/variants/{variant_id}
GET    /admin/products
PATCH  /admin/products/{product_id}
PUT    /admin/products/{product_id}/operations
POST   /admin/products/{product_id}/suspend
```

### orders
```
POST /orders
GET  /orders
GET  /orders/stats
GET  /orders/{order_id}
POST /orders/{order_id}/confirm
GET  /orders/{order_id}/dashboard
GET  /seller/orders
POST /seller/orders/{order_id}/accept
POST /seller/orders/{order_id}/deliver
GET  /admin/orders
GET  /admin/orders/{order_id}
```

### wallet
```
GET  /wallet
POST /wallet/topup
POST /wallet/demo-topup
GET  /wallet/transactions
POST /wallet/withdraw
GET  /admin/withdrawals
POST /admin/withdrawals/{req_id}/approve
```

### disputes
```
POST /orders/{order_id}/dispute
GET  /seller/orders/{order_id}/dispute
POST /seller/disputes/{dispute_id}/respond
GET  /admin/disputes
GET  /admin/disputes/{dispute_id}
POST /admin/disputes/{dispute_id}/refund
POST /admin/disputes/{dispute_id}/reject
```

### resources
```
POST   /seller/variants/{variant_id}/resources
GET    /seller/variants/{variant_id}/resources
DELETE /seller/resources/{resource_id}
POST   /seller/resources/{resource_id}/error
POST   /internal/resources/acquire
POST   /internal/resources/release
GET    /orders/{order_id}/resources
GET    /admin/resources
GET    /admin/resources/summary
```

### providers
```
GET  /providers
GET  /providers/{provider_id}/health
POST /admin/providers
PUT  /admin/providers/{provider_id}
POST /admin/providers/{provider_id}/test
```

### pricing
```
GET  /products/{product_id}/pricing-options
POST /products/{product_id}/calculate
GET  /products/{product_id}/operations
GET  /admin/providers/{provider_id}/products
```

### affiliate
```
POST  /affiliate/click
GET   /affiliate/me
GET   /admin/affiliates
GET   /admin/affiliates/{account_id}
PATCH /admin/affiliates/{account_id}/code
GET   /admin/affiliate-fund
POST  /admin/affiliate-fund/topup
```

### reviews
```
POST /orders/{order_id}/review
GET  /products/{product_id}/reviews
```

### seller (application)
```
POST /seller/apply
GET  /admin/seller-applications
POST /admin/seller-applications/{app_id}/approve
POST /admin/seller-applications/{app_id}/reject
```

### categories
```
GET    /categories
POST   /admin/categories
PATCH  /admin/categories/{cat_id}
DELETE /admin/categories/{cat_id}
```

### alerts
```
GET  /admin/alerts
POST /admin/alerts/{alert_id}/dismiss
GET  /seller/alerts
```

### tasks / audit / debug
```
GET /admin/tasks
PUT /admin/tasks/{task_id}
GET /admin/logs
GET /debug/version
```

## 6. Cấu trúc thư mục

```
market_site/
├── frontend/                   # Next.js app
│   ├── app/
│   │   ├── page.tsx            # Trang chủ (chợ sản phẩm)
│   │   ├── categories/         # Danh mục
│   │   ├── products/[id]/      # Chi tiết sản phẩm
│   │   ├── orders/             # Đơn hàng (buyer)
│   │   ├── wallet/             # Ví, nạp/rút, lịch sử
│   │   ├── affiliate/          # Dashboard affiliate
│   │   ├── login/ & register/  # Xác thực
│   │   ├── solutions/          # Landing giải pháp
│   │   ├── seller/             # Portal nhà bán (layout riêng)
│   │   │   ├── page.tsx        # Dashboard
│   │   │   ├── products/       # CRUD sản phẩm + variants (+ new, [id])
│   │   │   └── orders/         # Xử lý đơn, giao hàng, khiếu nại
│   │   └── admin/              # Admin console (layout riêng, 14 trang)
│   ├── components/
│   │   ├── TopNav.tsx          # Navigation role-aware
│   │   ├── SiteFooter.tsx
│   │   ├── DynamicOrderForm.tsx
│   │   ├── ServiceDashboard.tsx
│   │   ├── AffiliateStatsView.tsx
│   │   ├── ReferralCapture.tsx # Bắt ?ref=
│   │   ├── RouteProgress.tsx   # Loading bar
│   │   ├── ui/                 # shadcn-style: button, card, dialog, input,
│   │   │                       #   select, badge, textarea, tooltip, spinner
│   │   └── admin/              # AdminShell, stats-card, status-badge,
│   │                           #   filter-pills, pagination, slide-panel,
│   │                           #   confirm-modal, search-input, status-config
│   ├── hooks/                  # TanStack Query hooks theo domain:
│   │                           #   use-products, use-orders, use-affiliate,
│   │                           #   use-alerts, use-disputes, use-providers,
│   │                           #   use-resources
│   └── lib/
│       ├── api.ts              # API client tập trung
│       ├── auth.tsx            # AuthProvider + useAuth
│       ├── types.ts            # TypeScript interfaces
│       ├── query-*.ts          # TanStack Query setup
│       └── utils/              # cn, cookies, format (VND, date)
│
├── marketplace-svc/            # FastAPI backend
│   ├── src/
│   │   ├── main.py             # Entrypoint + mount routers
│   │   ├── scheduler.py        # APScheduler jobs
│   │   ├── config.py / database.py / middleware.py / exceptions.py
│   │   ├── models/             # account, product, order, wallet, resource,
│   │   │                       #   provider, alert, review, affiliate,
│   │   │                       #   category, pricing_config, service_task, log_entry
│   │   ├── auth/ products/ orders/ wallet/ disputes/ resources/
│   │   ├── providers/ pricing/ reviews/ affiliate/ alerts/
│   │   ├── categories/ seller/ tasks/ audit/ debug/
│   │   └── adapters/           # manual, mock, seller_pool
│   ├── alembic/                # 11 migrations
│   ├── scripts/                # seed_demo, seed_orders
│   └── tests/                  # 20 test files (pytest)
│
├── docker-compose.dev.yml
├── init-db.sql / db/marketplace-seed.sql
└── docs/
```

## 7. Hiện trạng UI — lưu ý cho redesign

- **Hai hệ component tách biệt**: `components/ui/` (shadcn-style, dùng cho public/buyer/seller) và `components/admin/` (bộ riêng cho admin). Redesign nên hợp nhất thành một design system.
- **3 layout**: public/buyer (TopNav + SiteFooter), seller (`app/seller/layout.tsx`), admin (`app/admin/layout.tsx` + AdminShell sidebar).
- **Data layer đã chuẩn, không cần đụng khi redesign UI**: TanStack Query hooks theo domain, API client tập trung (`lib/api.ts`), types tập trung (`lib/types.ts`).
- **Có sẵn**: RouteProgress, `loading.tsx` skeletons (orders / wallet / affiliate / products), mobile nav, format tiền VND, Recharts, Framer Motion.
- **Ngôn ngữ UI**: tiếng Việt. Thương hiệu: **Proxora**.
- **Trạng thái repo lúc khảo sát**: có thay đổi chưa commit ở nhánh affiliate/orders (9 files) — nên commit để có baseline sạch trước khi redesign.

## 8. Environment variables

| Biến | Mặc định | Mô tả |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace` | Connection string |
| `JWT_SECRET` | `dev-secret-change-in-production` | JWT signing key |
| `REDIS_URL` | `redis://localhost:6379` | Redis |
| `PLATFORM_FEE_PERCENT` | `0` | Phí nền tảng (%) |
| `NEXT_PUBLIC_API_URL` | — | API URL (không set → dùng `/api` proxy) |
