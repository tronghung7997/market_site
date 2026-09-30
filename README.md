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
- BFF lưu access JWT trong cookie `dx_session` và refresh token trong `dx_refresh` (HTTP-only), thêm `Authorization`, và HMAC-sign mọi request sang FastAPI bằng `BFF_REQUEST_SIGNING_SECRET`.
- `/internal/*` không được public qua catch-all BFF.
- BFF forward IP người dùng (đọc từ header của edge proxy, `ADMIN_CLIENT_IP_HEADER`, mặc định `x-real-ip`) sang FastAPI qua `X-Client-IP`; backend chỉ tin header này trên request đã ký. IP này dùng cho rate-limit đăng nhập, lịch sử đăng nhập (`login_events`) và cột `ip` trong audit log.
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

Backend cài dependency `tzdata` để dashboard và báo cáo inventory đọc được múi giờ trình duyệt (bao gồm `Asia/Saigon`) ngay cả khi hệ điều hành không có timezone database.

Trang kho seller mặc định hiển thị cả sản phẩm đang bán và tạm dừng để seller tiếp tục quản lý, nạp và xuất kho khi ngừng bán. Bộ lọc trạng thái sản phẩm vẫn cho phép chọn riêng từng nhóm.

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

Backend suite dùng chung `marketplace_test`; trước mỗi test, `clean_db` chỉ `TRUNCATE ... RESTART IDENTITY` các bảng đang có dữ liệu hoặc đã dùng sequence (truncate cả ~70 bảng tốn ~0,5 s/test). **Không chạy hai tiến trình pytest song song**, kể cả từ agent/worktree khác.

Vòng lặp nhanh khi phát triển (không cần chạy cả suite):

```bash
cd marketplace-svc
uv run pytest -q tests/test_orders.py -x --ff   # dừng ở lỗi đầu tiên, chạy test vừa fail trước
uv run pytest -q --lf                           # chỉ chạy lại các test fail ở lần trước
uv run pytest -q tests/test_auth.py -k refresh  # lọc theo tên test
uv run pytest -q tests/test_gateway.py --durations=10
```

Trong test, `tests/conftest.py` hạ bcrypt xuống cost 4 (production vẫn cost 12) và dùng Redis DB 15 (`REDIS_URL` có sẵn trong môi trường, ví dụ CI, được giữ nguyên). Test thuần logic không đụng database đánh dấu `pytestmark = pytest.mark.no_db` để bỏ qua bước dọn database.

Đo các database hot path bằng dữ liệu tổng hợp trong database test:

```bash
cd marketplace-svc
uv run python scripts/benchmark_hot_queries.py --scenario small --repeat 5
```

Benchmark này xóa và seed lại toàn bộ `marketplace_test`, đồng thời từ chối chạy nếu tên database không chính xác. Không chạy benchmark song song với pytest.

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
| Buyer | `/[locale]`, `/[locale]/categories`, `/[locale]/search`, `/[locale]/products/[id]`, `/[locale]/orders`, `/[locale]/wallet`, `/[locale]/transactions`, `/[locale]/messages` |
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
| `LOG_LEVEL`, `LOG_FORMAT`, `APP_VERSION` | Log JSON ra stdout (mặc định `INFO`, `json`); `APP_VERSION` = git sha gắn vào mỗi dòng. Thu thập và xem log bằng OpenObserve: `observability/README.md` |
| `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT_SECONDS`, `DB_POOL_RECYCLE_SECONDS` | Pool kết nối PostgreSQL của mỗi process (mặc định 10 / 20 / 10 s / 1800 s). Web, scheduler và background task dùng chung pool; giữ `(DB_POOL_SIZE + DB_MAX_OVERFLOW) × số process` dưới `max_connections` của PostgreSQL (mặc định 100) |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_SECONDS` | PostgreSQL đóng session ngồi yên trong transaction quá thời gian này (mặc định 900 s, `0` = tắt). Lưới an toàn chống rò session giữ connection và row lock; phải lớn hơn lời gọi provider dài nhất khi đang mở transaction |
| `PROVISION_MAX_CONCURRENCY` | Số lượt provision nền chạy đồng thời mỗi process (mặc định 4). Mỗi lượt giữ row lock của đơn và tối đa 2 connection trong lúc gọi provider; đơn dư chờ lượt. Đơn adapter kẹt `pending` được `provision_sweep_job` thử lại sau 2 phút và hoàn tiền sau 15 phút; đơn nguồn catalog (igbm, không có idempotency key) chỉ được thử lại khi lệnh mua chưa từng gửi đi, đã gửi thì không mua lại mà hoàn tiền kèm cảnh báo critical để đối soát tay |
| `SCHEDULER_ENABLED` | Process có tham gia chạy job định kỳ không (mặc định `true`). Chỉ process giữ Postgres advisory lock mới chạy job, nên nhiều worker/replica cùng bật vẫn an toàn; tắt ở web khi đã có process `python -m src.worker` riêng |
| `WEB_CONCURRENCY` | Số worker uvicorn trong container backend (mặc định 1; uvicorn tự đọc biến này khi không truyền `--workers`). Chat events tới được stream của mọi worker qua Redis pub/sub; mỗi worker có pool DB và giới hạn provisioning riêng |
| `SEARCH_QUERY_LOG_RETENTION_DAYS` | Số ngày giữ `search_query_log` (mặc định 90); log truy vấn được gom trong process và ghi theo lô |
| `JWT_SECRET` | Bắt buộc, unique, tối thiểu 32 byte |
| `INTERNAL_API_KEY` | Bắt buộc, khác JWT secret, tối thiểu 32 byte |
| `BFF_REQUEST_SIGNING_SECRET` | Bắt buộc, tối thiểu 32 byte; cùng giá trị server-only với frontend/BFF để ký hop BFF → FastAPI |
| `ENCRYPTION_KEY` | Bắt buộc, khác các secret khác, tối thiểu 32 byte |
| `PRINCIPAL_HMAC_SECRET` | Nên đặt riêng ở staging/production |
| `FRONTEND_BASE_URL`, `CORS_ALLOWED_ORIGINS` | Origin frontend được backend chấp nhận; reset-password links dùng `FRONTEND_BASE_URL` |
| `BACKEND_BASE_URL` | Public callback base URL; production yêu cầu public HTTPS |
| `MAIL_PROVIDER` | `log` (dev), `smtp`, hoặc `resend`. Seed lần đầu cho admin mail-config |
| `MAIL_FROM`, `MAIL_FROM_NAME` | Seed địa chỉ From; sau seed, admin sửa trên `/admin/display-settings?tab=mail` |
| `RESEND_API_KEY` | Secret Resend; bắt buộc khi gửi qua Resend. Không bao giờ trả về admin API |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_STARTTLS` | Secret/hạ tầng SMTP; bắt buộc khi `MAIL_PROVIDER=smtp` |
| `MAIL_WORKER_ENABLED`, `MAIL_MAX_ATTEMPTS` | Worker seed + trần retry; `MAIL_MAX_ATTEMPTS` chỉ env |
| `EMAIL_VERIFICATION_REQUIRED` | Seed cho `auth_runtime_config` (mặc định `false` từ 2026-09-22): bật thì tài khoản đăng ký **trong lúc bật** (`accounts.must_verify_email`) không được cấp phiên cho tới khi bấm link xác nhận rồi đăng nhập lại (login trả 403 `EMAIL_NOT_VERIFIED`, gửi lại link qua `POST /auth/verify-email/resend-public`); tài khoản cũ chưa xác nhận vẫn đăng nhập được nhưng bị chặn mua/nạp/rút. Tắt công tắc là gỡ chặn cho tất cả. Admin đổi ở `/admin/display-settings?tab=accounts`. Mail xác nhận vẫn gửi khi đăng ký |
| `MFA_FEATURE_ENABLED`, `REQUIRE_ADMIN_2FA`, `REQUIRE_2FA_FOR_WITHDRAWAL` | Seed cho `auth_runtime_config` (mặc định đều `false`): công tắc tổng 2FA TOTP, admin phải bật TOTP mới vào console, rút tiền cần mã TOTP. Admin bật/tắt ở tab Tài khoản; 2 quy tắc chỉ có tác dụng khi công tắc tổng bật |
| `TURNSTILE_SECRET_KEY` | Secret Cloudflare Turnstile (server-only). Chỉ có tác dụng khi admin đã dán site key ở tab Tài khoản; để trống = tắt captcha. Áp cho đăng ký / đăng nhập / quên mật khẩu; đăng nhập admin không dùng captcha (mạng nội bộ không tới được Cloudflare) |
| `DISPUTE_RESOLUTION_TIMEOUT_HOURS` | Thời gian buyer phản hồi sau remedy/response của seller; mặc định 24 giờ, hết hạn case tự settle |
| `DISPUTE_ABANDON_GRACE_HOURS` | Sau hết hạn escrow, không có claim batch mới trong bấy nhiêu giờ thì case chưa remedy tự settle remaining cho seller; chat không gia hạn đồng hồ này; mặc định 24 |
| `MEDIA_STORAGE` | Nơi ghi ảnh upload mới: `db` (mặc định, bytes trong Postgres) hoặc `s3` (R2/S3/B2…). Ảnh cũ chuyển bằng `scripts/media_migrate.py`; quy trình ở `docs/media-storage.md` |
| `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`, `MEDIA_S3_PUBLIC_BUCKET`, `MEDIA_S3_PRIVATE_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | Kho S3-compatible (R2: region `auto`). Hai bucket phải khác nhau; chỉ bucket public được gắn domain công khai. Secret chỉ để trong env |
| `MEDIA_PUBLIC_BASE_URL` | Domain CDN (https) của bucket public. Để trống thì app tự phục vụ ảnh tại `/media/<key>`; chỉ đặt sau khi đã chuyển hết ảnh sang S3 |
| `MEDIA_SIGNED_URL_TTL_SECONDS`, `MEDIA_MAX_UPLOAD_BYTES`, `MEDIA_UPLOAD_RATE_LIMIT_PER_HOUR` | Tuổi URL ký sẵn cho ảnh riêng tư (600 s), trần body upload (10 MB), số upload mỗi tài khoản mỗi giờ (120) |

Payment/provider variables là server-only. Không đặt credential trong `NEXT_PUBLIC_*`, tài liệu, log hoặc client response. Không đổi trực tiếp `ENCRYPTION_KEY` của môi trường có dữ liệu: key này mã hoá cả credential nhà cung cấp, toàn bộ nội dung kho hàng (`resources.data`) và dữ liệu bàn giao dạng text của đơn (`orders.delivered_data`), và là khoá HMAC chống trùng/tìm kiếm của kho — đổi key mà không rotate thì mọi hàng trong kho không đọc được. Dùng quy trình rotate trong `marketplace-svc/scripts/rotate_encryption_key.py` (mã hoá lại provider, kho và dữ liệu bàn giao trong cùng một transaction) sau khi backup và dry-run. Backup tạo trước migration `fx…` vẫn chứa kho hàng ở dạng nguyên văn; backup trước migration `ge1…` vẫn chứa `orders.delivered_data` nguyên văn.

### Frontend/BFF

Nguồn đầy đủ: `frontend/.env.example` và `frontend/next.config.mjs`.

| Biến | Yêu cầu |
|---|---|
| `API_URL` | Backend upstream dùng server-side; production không được trỏ localhost |
| `GOOGLE_INDEXING_ENABLED` | Mặc định tắt; chỉ giá trị chính xác `true` mới cho phép index, xuất sitemap và crawl public routes |
| `BFF_REQUEST_SIGNING_SECRET` | Bắt buộc, server-only; phải khớp backend và không dùng tiền tố `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_ENABLE_DEMO_TOPUP` | Chỉ opt-in development; production luôn bị tắt |
| `ADMIN_ALLOWED_IPS` | Optional server-side admin network gate |
| `ADMIN_CLIENT_IP_HEADER` | Header do trusted edge proxy ghi đè (không nối thêm). Cấu hình edge và các bước khôi phục rate-limit: [`docs/edge-client-ip.md`](docs/edge-client-ip.md) |
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
