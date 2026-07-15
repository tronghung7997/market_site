# Proxora — Marketplace Platform

Nền tảng cung cấp tài khoản, proxy và dữ liệu số cho doanh nghiệp. Ký quỹ an toàn, giao ngay.

## Tech Stack

| Layer | Công nghệ |
|---|---|
| Frontend | Next.js 15, React 19, TailwindCSS, TanStack Table/Query, Recharts, Framer Motion |
| Backend API | FastAPI, SQLAlchemy (async), Pydantic v2, APScheduler |
| Database | PostgreSQL 17 |
| Cache / Queue | Redis 7, RabbitMQ 4 |
| Auth | JWT (PyJWT + bcrypt) |
| Runtime | Python 3.13, Node.js, Docker Compose |

## Cấu trúc dự án

```
marketplace/
├── frontend/                   # Next.js app
│   ├── app/
│   │   ├── page.tsx            # Trang chủ (chợ sản phẩm)
│   │   ├── products/[id]/      # Chi tiết sản phẩm
│   │   ├── orders/             # Quản lý đơn hàng (buyer)
│   │   ├── wallet/             # Ví, nạp tiền, lịch sử giao dịch
│   │   ├── login/ & register/  # Xác thực
│   │   ├── seller/             # Portal nhà bán
│   │   │   ├── page.tsx        # Dashboard seller
│   │   │   ├── products/       # CRUD sản phẩm + variants
│   │   │   └── orders/         # Xử lý đơn, giao hàng, phản hồi khiếu nại
│   │   ├── admin/              # Admin console
│   │   │   ├── page.tsx        # Tổng quan (KPIs, chart, system status)
│   │   │   ├── orders/         # Quản lý toàn bộ đơn hàng
│   │   │   ├── products/       # Quản lý sản phẩm toàn hệ thống
│   │   │   ├── disputes/       # Xử lý khiếu nại (hoàn tiền / từ chối)
│   │   │   ├── providers/      # Nhà cung cấp & health monitoring
│   │   │   ├── alerts/         # Cảnh báo hệ thống
│   │   │   ├── tasks/          # Tác vụ nền
│   │   │   ├── resources/      # Quản lý tài nguyên
│   │   │   ├── reports/        # Báo cáo
│   │   │   └── logs/           # Nhật ký hệ thống
│   │   └── solutions/          # Landing page giải pháp
│   ├── components/
│   │   ├── TopNav.tsx          # Navigation (role-aware)
│   │   ├── SiteFooter.tsx      # Footer
│   │   ├── ui.tsx              # Hand-rolled UI primitives
│   │   ├── ui/                 # shadcn-style components (dialog, tooltip, ...)
│   │   └── admin/              # Admin-specific components
│   └── lib/
│       ├── api.ts              # API client (fetch wrapper)
│       ├── auth.tsx            # AuthProvider + useAuth hook
│       ├── types.ts            # TypeScript interfaces
│       └── utils/              # Formatters (vnd, date)
│
├── marketplace-svc/            # FastAPI backend
│   └── src/
│       ├── main.py             # App entrypoint + scheduled jobs
│       ├── config.py           # Settings (env vars)
│       ├── database.py         # Async SQLAlchemy session
│       ├── models/             # ORM models
│       │   ├── account.py      # User accounts + roles
│       │   ├── product.py      # Products, variants, pricing
│       │   ├── order.py        # Orders, disputes, escrow
│       │   ├── wallet.py       # Wallet + transactions
│       │   ├── resource.py     # Deliverable resources (accounts, proxies)
│       │   ├── provider.py     # External service providers
│       │   ├── alert.py        # System alerts
│       │   └── review.py       # Product reviews
│       ├── auth/               # JWT auth, registration, login
│       ├── products/           # Product CRUD, variants, pricing
│       ├── orders/             # Order lifecycle, escrow, confirmation
│       ├── wallet/             # Balance, topup, escrow hold/release
│       ├── disputes/           # Dispute flow (buyer → seller → admin)
│       ├── resources/          # Resource assignment, expiry
│       ├── providers/          # Provider health, scoring
│       ├── pricing/            # Dynamic pricing (credit, task, tiered)
│       ├── reviews/            # Ratings & reviews
│       ├── alerts/             # Alert management
│       ├── seller/             # Seller-specific endpoints
│       ├── categories/         # Product categories
│       ├── audit/              # Event logging
│       ├── tasks/              # Background service tasks
│       ├── adapters/           # External service adapters
│       └── scheduler.py        # APScheduler jobs (escrow, SLA, health)
│
├── publishing-svc/             # Async worker service
├── docker-compose.yml          # Production stack
├── docker-compose.dev.yml      # Dev override (hot reload)
└── init-db.sql                 # DB initialization
```

## Chạy dự án

### Prerequisites

- Docker Desktop
- Node.js 20+
- Python 3.13+ (khuyến nghị dùng [uv](https://docs.astral.sh/uv/))
- Git

### Development

```bash
# 1. Hạ tầng (Postgres + Redis) — chạy trong Docker
docker compose -f docker-compose.dev.yml up -d

# 2. Backend — chạy native (hot reload nhanh hơn qua bind-mount)
cd marketplace-svc
uv sync                       # hoặc: python -m venv .venv && .venv/bin/pip install -e ".[dev]"
uv run alembic upgrade head
uv run uvicorn src.main:app --reload --port 8001

# 3. Frontend — chạy native
cd frontend && npm install && npm run dev
```

`docker-compose.dev.yml` chỉ chứa Postgres + Redis, expose port ra host (`5432`/`6379`) để backend native connect vào và để bạn debug trực tiếp bằng psql/DBeaver. Config mặc định trong `marketplace-svc/src/config.py` đã trỏ sẵn `localhost:5432`/`localhost:6379` với user/pass `marketplace`/`marketplace` — không cần set biến môi trường gì thêm khi chạy native.

### Production

```bash
# Backend
docker compose up -d --build

# Frontend
cd frontend && npm run build && npm start
```

### Demo (tunnel ra ngoài)

```bash
# Chạy backend + frontend production build, rồi:
cloudflared tunnel --url http://localhost:3000
# hoặc
ngrok http 3000 --domain=your-domain.ngrok-free.app
```

## Ports

| Service | Port | URL |
|---|---|---|
| Frontend | 3000 | http://localhost:3000 |
| Marketplace API | 8001 | http://localhost:8001 |
| Publishing API | 8002 | http://localhost:8002 |
| PostgreSQL | 5432 | — |
| Redis | 6379 | — |
| RabbitMQ Management | 15672 | http://localhost:15672 |

## Scheduled Jobs (APScheduler)

| Job | Interval | Chức năng |
|---|---|---|
| `escrow_release` | 30 phút | Giải phóng tiền ký quỹ khi hết hạn |
| `sla_check` | 10 phút | Kiểm tra đơn quá SLA |
| `health_check` | 15 phút | Ping provider health |
| `resource_expire` | 15 phút | Đánh dấu tài nguyên hết hạn |
| `provider_scoring` | 15 phút | Tính điểm uy tín provider |

## Giao diện theo role

| Role | Route | Chức năng chính |
|---|---|---|
| Buyer | `/`, `/products`, `/orders`, `/wallet` | Mua hàng, ký quỹ, khiếu nại |
| Seller | `/seller/*` | Quản lý sản phẩm, giao hàng, phản hồi khiếu nại |
| Admin | `/admin/*` | Giám sát toàn hệ thống, xử lý khiếu nại, quản lý provider |

## API Authentication

```
POST /auth/register    # Đăng ký
POST /auth/login       # Đăng nhập → access_token
GET  /me               # Thông tin tài khoản

# Header: Authorization: Bearer <token>
```

## Environment Variables

### Backend (`marketplace-svc`)

| Biến | Mặc định | Mô tả |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace` | Connection string |
| `JWT_SECRET` | `dev-secret-change-in-production` | JWT signing key |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `PLATFORM_FEE_PERCENT` | `0` | Phí nền tảng (%) |

### Frontend

| Biến | Mặc định | Mô tả |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | — | API URL (nếu không set, dùng `/api` proxy) |
