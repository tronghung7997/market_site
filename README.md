# Proxora — Marketplace Platform

Nền tảng marketplace cho tài khoản số, proxy và dịch vụ dữ liệu; hỗ trợ buyer, seller và admin, ví nội bộ, ký quỹ, giao tài nguyên và tích hợp nhà cung cấp.

## Nguồn sự thật

Tài liệu này chỉ mô tả trạng thái đang có trong repository. Khi có mâu thuẫn, ưu tiên theo thứ tự:

1. code và cấu hình thực thi;
2. tests và Alembic migrations;
3. verification/CI scripts;
4. tài liệu.

Quy tắc dành cho coding agent nằm trong [`AGENTS.md`](AGENTS.md) và các `AGENTS.md` theo thư mục. Visual contract nằm trong [`DESIGN.md`](DESIGN.md); module contracts nằm trong [`frontend/ARCHITECTURE.md`](frontend/ARCHITECTURE.md) và [`marketplace-svc/ARCHITECTURE.md`](marketplace-svc/ARCHITECTURE.md); domain chat hiện tại nằm trong [`CONTEXT.md`](CONTEXT.md).

## Tech stack hiện tại

| Layer | Công nghệ |
|---|---|
| Frontend/BFF | Next.js 16.3, React 19, TypeScript, Tailwind CSS 4, TanStack Query/Table, `next-intl` |
| Backend | Python 3.13+, FastAPI, Pydantic v2, SQLAlchemy async, Alembic, APScheduler |
| Data | PostgreSQL 17; Redis 7 cho rate limit/gateway best-effort |
| Auth | JWT ở backend; frontend giữ session bằng HTTP-only cookie trong same-origin BFF |
| Tooling | npm, uv, pytest, Docker Compose |

Repository hiện không có `publishing-svc` hoặc RabbitMQ runtime. Không thêm dependency/service dựa trên tài liệu cũ nếu code hiện tại không sử dụng.

## Kiến trúc request

```text
Browser
  └─ /api/* (same origin)
       └─ Next.js BFF: app/api/[...path]/route.ts
            └─ FastAPI :8001
                 ├─ PostgreSQL :5432 (system of record)
                 └─ Redis :6379 (best-effort rate limiting/gateway support)
```

- Browser không gọi FastAPI trực tiếp và không nhận access token sau login.
- BFF lưu JWT trong cookie `dx_session` dạng HTTP-only và thêm `Authorization` khi gọi backend.
- `/internal/*` không được public qua catch-all BFF.
- Scheduled jobs hiện chạy trong process backend; danh sách chính xác nằm trong `marketplace-svc/src/main.py`.
- Transactional mail ghi `mail_outbox` cùng transaction domain; worker gửi outbound (log / SMTP / Resend). Server không cần mở inbound. Nhiều host chặn SMTP — production nên dùng Resend (HTTPS :443).

## Cấu trúc chính

```text
market_site/
├── AGENTS.md                    # Quy tắc coding agent toàn repository
├── DESIGN.md                    # Contract thiết kế frontend và skill routing
├── CONTEXT.md                   # Contract domain chat đang được triển khai
├── scripts/                     # Verification gates cho agent/CI/local
├── frontend/
│   ├── AGENTS.md                # Quy tắc Next.js/frontend
│   ├── ARCHITECTURE.md          # Module seams và dependency direction
│   ├── app/[locale]/            # App Router, route en/vi
│   ├── app/api/[...path]/       # Same-origin BFF
│   ├── components/              # Shared, admin và chat UI
│   ├── hooks/                   # TanStack Query hooks
│   ├── i18n/ & messages/        # next-intl config và catalog en/vi
│   └── lib/                     # API client, auth, types, money helpers
├── marketplace-svc/
│   ├── AGENTS.md                # Quy tắc FastAPI/backend
│   ├── ARCHITECTURE.md          # Service/router/adapter/transaction seams
│   ├── src/                     # Feature modules, models, scheduler
│   ├── alembic/                 # Database migrations
│   ├── scripts/                 # Ops/seed/recovery scripts
│   └── tests/                   # Backend pytest suite
├── db/marketplace-seed.sql
├── init-db.sql                  # Tạo marketplace_test trên volume mới
├── docker-compose.dev.yml       # PostgreSQL + Redis cho local development
└── docker-compose.yml           # Deployment-specific stack
```

## Yêu cầu môi trường

- Docker Desktop/Engine với Compose
- Node.js 20.9+ (Node 22 được dùng trong Dockerfile)
- Python 3.13+
- [`uv`](https://docs.astral.sh/uv/)
- Git

## Chạy local

### 1. Khởi động PostgreSQL và Redis

Từ root repository:

```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps
```

Local development dùng:

- PostgreSQL: `marketplace:marketplace@localhost:5432/marketplace`
- Redis: `redis://localhost:6379`

`init-db.sql` tạo `marketplace_test` khi PostgreSQL khởi tạo một volume sạch. Nếu đang dùng volume cũ và test báo database không tồn tại, tạo một lần:

```bash
docker compose -f docker-compose.dev.yml exec postgres \
  psql -U marketplace -d postgres -c 'CREATE DATABASE marketplace_test;'
```

Không chạy lệnh trên nếu database đã tồn tại.

### 2. Chạy backend

```bash
cd marketplace-svc
cp .env.example .env
```

Sửa file local `marketplace-svc/.env`:

- đặt `DATABASE_URL=postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace`;
- tạo ba giá trị khác nhau, tối thiểu 32 byte cho `JWT_SECRET`, `INTERNAL_API_KEY`, `ENCRYPTION_KEY`;
- giữ secret thật ngoài Git. Có thể tạo từng giá trị bằng `openssl rand -hex 32`.

Sau đó:

```bash
uv sync --extra dev
uv run alembic upgrade head
uv run uvicorn src.main:app --reload --port 8001
```

Backend mặc định không bật API docs. Chỉ bật `API_DOCS_ENABLED=true` trong local development nếu cần.

### 3. Chạy frontend

Ở terminal khác:

```bash
cd frontend
npm ci
npm run dev
```

Mở <http://localhost:3000/en> hoặc <http://localhost:3000/vi>. Frontend server gọi backend qua `API_URL` (mặc định local là `http://localhost:8001`); browser luôn gọi `/api` same-origin.

## Kiểm tra cục bộ

Chạy các kiểm tra cần thiết trực tiếp từ từng service. Không dùng verification harness.

```bash
cd frontend
npm run lint
npm run check:i18n
npm test
```

Kiểm tra backend theo file trong lúc phát triển:

```bash
cd marketplace-svc
uv run pytest -q tests/test_chat_inquiries.py tests/test_chat_orders.py
```

Backend suite dùng chung `marketplace_test` và `TRUNCATE` các bảng trước mỗi test. **Không chạy hai tiến trình pytest song song**, kể cả từ agent/worktree khác.

Các command frontend riêng lẻ:

```bash
cd frontend
npm run lint                 # hiện là tsc --noEmit
npm run check:i18n
npm test                     # toàn bộ unit test trong tests/
npm run test:auth-route      # targeted
API_URL=http://marketplace-svc:8001 npm run build   # chỉ khi cần compile production
```

Thay đổi UI vẫn phải được kiểm tra trên browser thật: desktop/mobile, console, network, loading/error/empty/permission states. Build thành công không thay thế runtime verification.

## Routes theo role

Mọi route ứng dụng đều có locale prefix (`/en` hoặc `/vi`).

| Role | Route chính |
|---|---|
| Buyer | `/[locale]`, `/[locale]/categories`, `/[locale]/products/[id]`, `/[locale]/orders`, `/[locale]/wallet`, `/[locale]/transactions`, `/[locale]/messages` |
| Seller | `/[locale]/seller/*` |
| Admin | `/[locale]/admin/*` |

Frontend route visibility không thay thế backend authorization.

## Environment contract

### Backend

Nguồn đầy đủ: `marketplace-svc/.env.example` và `marketplace-svc/src/config.py`.

| Biến | Yêu cầu |
|---|---|
| `DEPLOYMENT_ENVIRONMENT` | `development`, `test`, `staging`, hoặc `production` |
| `DATABASE_URL` | PostgreSQL async URL |
| `REDIS_URL` | Redis URL; mặc định local `redis://localhost:6379` |
| `JWT_SECRET` | Bắt buộc, unique, tối thiểu 32 byte |
| `INTERNAL_API_KEY` | Bắt buộc, khác JWT secret, tối thiểu 32 byte |
| `ENCRYPTION_KEY` | Bắt buộc, khác các secret khác, tối thiểu 32 byte |
| `PRINCIPAL_HMAC_SECRET` | Nên đặt riêng ở staging/production |
| `FRONTEND_BASE_URL`, `CORS_ALLOWED_ORIGINS` | Origin frontend được backend chấp nhận; reset-password links dùng `FRONTEND_BASE_URL` |
| `BACKEND_BASE_URL` | Public callback base URL; production yêu cầu public HTTPS |
| `MAIL_PROVIDER` | `log` (dev), `smtp`, hoặc `resend`. Seed lần đầu cho admin mail-config |
| `MAIL_FROM`, `MAIL_FROM_NAME` | Seed địa chỉ From; sau seed, admin sửa trên `/admin/display-settings?tab=mail` |
| `RESEND_API_KEY` | Secret Resend; bắt buộc khi gửi qua Resend. Không bao giờ trả về admin API |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_STARTTLS` | Secret/hạ tầng SMTP; bắt buộc khi `MAIL_PROVIDER=smtp` |
| `MAIL_WORKER_ENABLED`, `MAIL_MAX_ATTEMPTS` | Worker seed + trần retry; `MAIL_MAX_ATTEMPTS` chỉ env |

Payment/provider variables là server-only. Không đặt credential trong `NEXT_PUBLIC_*`, tài liệu, log hoặc client response. Không đổi trực tiếp `ENCRYPTION_KEY` của môi trường có dữ liệu; dùng quy trình rotate trong `marketplace-svc/scripts/rotate_encryption_key.py` sau khi backup và dry-run.

### Frontend/BFF

Nguồn đầy đủ: `frontend/.env.example` và `frontend/next.config.mjs`.

| Biến | Yêu cầu |
|---|---|
| `API_URL` | Backend upstream dùng server-side; production không được trỏ localhost |
| `NEXT_PUBLIC_ENABLE_DEMO_TOPUP` | Chỉ opt-in development; production luôn bị tắt |
| `ADMIN_ALLOWED_IPS` | Optional server-side admin network gate |
| `ADMIN_CLIENT_IP_HEADER` | Header do trusted edge proxy ghi đè |
| `TIKTOK_LOOKUP_API_URL`, `LOOKUP_API_KEY` | Server-side social lookup integration |

`NEXT_PUBLIC_API_URL` không phải đường bypass BFF: browser client hiện cố định same-origin `/api`.

## Build/deploy

Frontend production compile cần một upstream không phải localhost:

```bash
cd frontend
npm ci
API_URL=https://api.example.com npm run build
npm start
```

`API_URL` được đóng vào `BUILT_API_URL` khi build; cần rebuild nếu đổi upstream. `docker-compose.yml`, `Jenkinsfile` và Dockerfiles là cấu hình deployment-specific, có private registry/internal assumptions và không phải local quick-start. Trước deploy thực tế phải inject secret qua cơ chế quản lý secret, kiểm tra image/API URL, migration, CORS, callback URL và backup database. Không lấy giá trị hard-code trong deployment file làm template credential cho môi trường mới.

## Quy tắc cập nhật tài liệu

- Thay đổi dependency/runtime: cập nhật bảng tech stack và command liên quan.
- Thay đổi API xuyên frontend/backend: cập nhật schema, tests, frontend types/callers cùng lúc.
- Thay đổi database: thêm migration và chạy gate backend.
- Thay đổi chat: đọc/cập nhật `CONTEXT.md`; không coi prototype là contract.
- Chỉ ghi một tính năng là “đã có” khi code path và test tương ứng tồn tại.
