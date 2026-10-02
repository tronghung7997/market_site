# Log vận hành → OpenObserve

Mọi process ghi **một object JSON mỗi dòng ra stdout**. Vector đọc stdout, chuẩn hoá rồi đẩy vào OpenObserve (stream `market_site`). App không bao giờ gọi thẳng OpenObserve: OpenObserve chậm/chết thì log nằm chờ trong buffer đĩa của Vector, request không bị ảnh hưởng.

```
FastAPI (marketplace-svc) ─┐
Scheduler jobs            ─┼─ stdout JSON ─▶ Vector (normalise + disk buffer) ─▶ OpenObserve /api/{org}/app/_json
Next BFF (frontend-bff)   ─┘
```

Nguồn: `marketplace-svc/src/logging.py`, `src/middleware.py`, `src/observability/outbound.py`, `src/observability/jobs.py`, `frontend/lib/bff-log.ts`, pipeline `observability/vector/`.

## Xem lỗi nhanh

Ô query (không cần SQL): `level='error'` (thêm `or level='warning'` để thấy cả lỗi bên thứ ba). Bấm tên field ở cột trái để thêm cột: `event`, `service`, `route`, `status`, `error_code`, `error_message`, `error_where`. Mọi lỗi đều nằm ở `error_message` — field `error` cũ (`error=str(e)`) được pipeline tự chuyển sang đó.

## Truy vết một lỗi

1. Người dùng báo lỗi → lấy `x-request-id` từ response (DevTools › Network) — BFF tạo id này và gửi sang FastAPI.
2. OpenObserve › Logs › stream `market_site`: `request_id='…'` → thấy theo thứ tự thời gian: dòng BFF (nếu backend không tới được), mọi `upstream_call` / `provider_call` tới bên thứ ba, và `http_request` kết thúc với `status`, `error_code`, `error_where`.
3. Lỗi từ job nền: `job_run_id='…'` (lấy từ dòng `job_run` lỗi) cho đúng một lượt chạy.

## Từ điển field

| Field | Ý nghĩa |
|---|---|
| `timestamp`, `level`, `event` | Thời điểm (UTC ISO), `debug`/`info`/`warning`/`error`, tên sự kiện dạng `snake_case` |
| `service`, `env`, `version` | `marketplace-svc` / `frontend-bff`; `DEPLOYMENT_ENVIRONMENT`; `APP_VERSION` (git sha) |
| `logger` | Module ghi log (`src.middleware`, `upstream`, `scheduler`, `uvicorn.error`…) |
| `request_id`, `method`, `client_ip`, `account_id` | Ngữ cảnh request, gắn vào **mọi** dòng log trong request đó |
| `route`, `status`, `duration_ms` | Route template (`/orders/{order_ref}`, không phải URL thật), mã HTTP, thời gian |
| `error_code`, `error_detail` | Mã lỗi API (`ORDER_NOT_FOUND`, `VALIDATION_ERROR`…) hoặc detail ngắn của HTTPException |
| `error_type`, `error_message`, `error_where`, `error_cause`, `error_stack` | Exception: tên lớp, thông điệp, **file:dòng trong `src/` nơi lỗi nổ** (bỏ qua middleware/logging), nguyên nhân gốc, traceback (≤ 8 KB, giữ phần cuối) |
| `job`, `job_run_id` | Tên job APScheduler + id của lượt chạy, gắn vào mọi dòng log trong job |
| `integration`, `upstream_host`, `upstream_method`, `upstream_path` | Bên thứ ba (`payos`, `sepay`, `topproxy`, `dproxy`, `igbm`, `telegram`…; host lạ thì là host), path đã thay id/key bằng `{id}`/`{key}` |
| `outcome` | `ok`, `client_error` (4xx), `server_error` (5xx), `timeout`, `connect_error`, `transport_error`, `failed` |
| `provider_id`, `operation`, `order_id`, `attempt` | `provider_call`: lời gọi nghiệp vụ tới nhà cung cấp (bản sao của `provider_call_logs`) |
| `slow` | `true` khi upstream ≥ 5 s hoặc job ≥ 60 s |
| `unstructured` | Dòng không phải JSON (banner framework, `print`) — nên sửa tại nguồn. Stack trace nhiều dòng được Vector gộp thành một dòng (`multiline` trong `docker-source.yaml`); dòng bắt đầu bằng `⨯`, `Traceback`, `…Error` mang `level=error` |

Không bao giờ có trong log: body request/response, query string, cookie, token, mật khẩu, dữ liệu bàn giao. `_redact_processor` còn che mọi field có tên giống bí mật (`password`, `token`, `api_key`, `secret`, `signature`…) như lưới an toàn cuối.

## Event chính

| `event` | Khi nào | Mức |
|---|---|---|
| `http_request` | Mỗi request FastAPI, 1 dòng | `error` nếu 5xx (kể cả exception không bắt), còn lại `info` |
| `upstream_call` | Mỗi lời gọi HTTP ra ngoài (httpx) | `info` khi ok; `warning` khi 4xx/5xx/timeout/lỗi kết nối/chậm |
| `provider_call` | Mỗi lần adapter gọi nhà cung cấp | `info` / `warning` khi thất bại |
| `job_run` | Mỗi lượt job scheduler | `info`; `error` + stack khi job ném lỗi; `mail_outbox`/`telegram_dispatch` thành công ở `debug` |
| `bff_upstream_unreachable` | BFF không gọi được FastAPI (502) | `error`, kèm `error_cause` như `ECONNREFUSED` |
| `bff_upstream_error` | FastAPI trả 5xx qua BFF | `warning` |

## Sự kiện nghiệp vụ và kênh bán

- Mỗi `log_event(...)` (bảng `log_entries`: `order_placed`, `deposit_created`/`deposit_paid`, `withdraw_*`, `escrow_released`, `dispute_*`, `*_refund`…) được ghi thêm lên log stream **sau khi transaction commit** (`src/observability/business.py`), với `business=true`, `audit_message` và các field vô hướng của metadata (`order_id`, `amount` VND, `seller_id`, `source`…). Transaction rollback thì không ghi, nên số tiền trên dashboard không đếm đơn đã huỷ ngầm.
- Mọi dòng log có `channel`: `public_api` (`/v1/...`), `web`, `job`. Dòng `http_request` của `/v1` có `api_key_id`.
- Dashboard tiền/đơn luôn lọc `business = true` (vài sự kiện như `deposit_paid` còn được ghi thẳng một lần nữa, không có cờ này).

## Cảnh báo admin và ảnh chụp trạng thái

- Mọi cảnh báo admin (`alerts.service.add_alert` / `upsert_incident` / `emit_incident`, trang `/admin/alerts`) cũng lên log stream sau khi commit: `event=system_alert`, `alert_type`, `severity` (cũng là `level`), `target_type`, `target_id`, `occurrence_count`.
- Job `state_snapshot` (15 phút, `src/observability/state.py`) ghi một dòng `state_snapshot`: `escrow_held_vnd` (đơn chưa giải ngân/hoàn), `orders_{pending,processing,delivered,disputed}`, `orders_stuck` (pending/processing > 30 phút), `wallet_available_vnd`, `wallet_locked_vnd`, `withdraw_pending_{count,vnd}`, `withdraw_approved_unpaid_{count,vnd}`, `disputes_open`, `disputes_seller_overdue`, `disputes_resolution_overdue`, `deposits_pending`, `alerts_active`; và một dòng `provider_credit_state` cho mỗi nhà cung cấp có theo dõi credit (`warning` khi dưới ngưỡng).
- Rollback một SAVEPOINT chỉ bỏ các sự kiện ghi trong savepoint đó; rollback cả transaction bỏ hết.

## Dashboard `market_site` (OpenObserve dùng chung)

Tabs: **Default** (lỗi, top lỗi, 5xx, p95, bên thứ ba, job, error_code) · **Tiền & đơn** (GMV theo kênh, nạp/rút, hoàn tiền/tranh chấp, top seller, public API) · **Hiệu suất** (xu hướng theo ngày: request, % 5xx, p95, tỉ lệ thành công đối tác, cấp hàng, nạp tiền, SLA theo API key, job) · **Database** (từ traces: SQL chậm nhất, SQL tốn tổng thời gian nhất, request nhiều SQL/N+1, chờ kết nối pool) · **Rủi ro & bảo mật** (tiền bất thường: webhook lạ/sai chữ ký, escrow/hoàn tiền lỗi, NCC hết tiền; đối soát sổ cái; đăng nhập/token; đổi quyền; public API bị từ chối; hệ thống phụ trợ lỗi; cảnh báo admin) · **Trạng thái** (từ `state_snapshot`: escrow/ví theo giờ, ảnh chụp mới nhất, đơn mở/kẹt, rút tiền chờ, tranh chấp quá hạn, credit nhà cung cấp).

Field mới chỉ truy vấn được sau khi OpenObserve đã nhận ít nhất một dòng chứa nó; panel dùng field chưa từng xuất hiện báo `Schema error`. Gửi một dòng `event=schema_seed` (`env=schema`) có đủ field là xong.

## Truy vấn hay dùng (SQL mode, stream `market_site`)

```sql
-- Tất cả lỗi, mới nhất trước, chỉ cột cần đọc
SELECT _timestamp, service, event, route, status, error_code, error_type, error_message, error_where, request_id
FROM "market_site" WHERE level = 'error' ORDER BY _timestamp DESC

-- Bên thứ ba nào đang lỗi
SELECT integration, outcome, count(*) AS n, approx_percentile_cont(duration_ms, 0.95) AS p95_ms
FROM "market_site" WHERE event = 'upstream_call' GROUP BY integration, outcome ORDER BY n DESC

-- Route nào trả 5xx / chậm
SELECT route, count(*) AS n, approx_percentile_cont(duration_ms, 0.95) AS p95_ms
FROM "market_site" WHERE event = 'http_request' AND status >= 500 GROUP BY route ORDER BY n DESC

-- Lỗi nghiệp vụ phổ biến (4xx có mã)
SELECT error_code, route, count(*) AS n FROM "market_site"
WHERE event = 'http_request' AND error_code IS NOT NULL GROUP BY error_code, route ORDER BY n DESC

-- Job thất bại
SELECT _timestamp, job, job_run_id, error_type, error_message, error_where FROM "market_site"
WHERE event = 'job_run' AND outcome = 'failed' ORDER BY _timestamp DESC
```

Ở chế độ không-SQL chỉ cần gõ điều kiện, ví dụ `level='error'`, `integration='payos' and outcome!='ok'`, `request_id='…'`. Trong UI, bấm vào tên field ở cột trái để thêm cột: `event`, `level`, `route`, `status`, `integration`, `outcome`, `error_where`, `error_message`.

Gợi ý alert khi lên server: `level='error'` > N trong 5 phút; `event='upstream_call' and integration in ('payos','sepay','nowpayments') and outcome!='ok'`; `event='job_run' and outcome='failed'`.

## Traces và metrics (OpenTelemetry)

Bật bằng biến môi trường chuẩn của OTel; không đặt `OTEL_EXPORTER_OTLP_ENDPOINT` thì tắt hoàn toàn (`src/observability/tracing.py`).

| Biến | Ví dụ |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:5080/api/default` (OpenObserve tự nối `/v1/traces`, `/v1/metrics`) |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic%20<base64 user:token>` (dấu `=` trong base64 viết `%3D`) |
| `OTEL_TRACES_SAMPLER_ARG` | Tỉ lệ giữ trace, mặc định `1.0`; production nên `0.1`–`0.2` |

- **Traces** (menu Traces, stream `default`): mỗi request là một cây span — FastAPI › từng câu SQL › từng lời gọi httpx ra bên thứ ba (span `ERROR` khi lỗi). Tìm theo `request_id` (thuộc tính của span gốc) hoặc mở từ `trace_id` trên dòng log.
- **Log ↔ trace**: mọi dòng log trong request có `trace_id`, `span_id`.
- **Metrics** (menu Metrics, đẩy mỗi 30 s): `http_server_duration` (theo route/status, có bucket cho p95), `http_server_active_requests`, `http_client_duration` (lời gọi ra bên thứ ba), `db_client_connections_usage` (pool DB)… dùng cho dashboard/alert rẻ hơn đếm log.
- Mỗi lượt job scheduler là một trace `job <tên>`; SQL và lời gọi ngoài của job nằm bên trong.

PromQL (Metrics › Visualize hoặc panel dashboard):

```promql
# p95 thời gian xử lý theo route (ms)
histogram_quantile(0.95, sum by (le, http_target) (rate(http_server_duration_bucket[5m])))
# Số request theo route + status trong 5 phút
sum by (http_target, http_status_code) (increase(http_server_duration_count[5m]))
# Pool DB: đang dùng vs rảnh (đầy "used" = nghẽn DB)
sum by (state) (db_client_connections_usage)
```

Cách dùng: metrics trả lời "có vấn đề không, ở route nào" (dashboard, alert); traces trả lời "chậm/lỗi ở bước nào" (mở trace lỗi/chậm nhất); logs trả lời "tại sao" (`trace_id` hoặc `request_id` → `error_where`, `error_stack`).

- Bỏ qua: `/health`, `/internal/metrics`, SSE `/chat/events`.
- Chi phí: span xuất theo lô ở luồng nền; với sampling 10 % chi phí thêm không đáng kể.

## Chạy thử ở local

```bash
# 1. OpenObserve (UI http://localhost:5080, dev@local.test / Local-Dev-2026!) + Vector
docker compose -f docker-compose.observe.yml up -d

# 2. Chạy app, tee stdout vào observability/local-logs/ (Vector đọc thư mục này)
cd marketplace-svc
# thêm traces/metrics (tuỳ chọn):
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5080/api/default
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic%20$(printf 'dev@local.test:Local-Dev-2026!' | base64 | sed 's/=/%3D/g')"
uvicorn src.main:app --port 8001 2>&1 | tee -a ../observability/local-logs/backend.log
cd ../frontend
npm run dev 2>&1 | tee -a ../observability/local-logs/frontend.log

# 3. Dọn
docker compose -f docker-compose.observe.yml down -v && rm observability/local-logs/*.log
```

Tên file log thành `service` cho dòng không-JSON. `LOG_FORMAT=console` in log màu dễ đọc trên terminal (không dùng khi ship). `LOG_LEVEL` mặc định `INFO`.

## Lên server

1. Tạo organization/stream trong OpenObserve, tạo **service account / ingestion token** riêng (không dùng tài khoản root).
2. Chạy Vector cạnh các container app, đọc Docker logs:
   ```bash
   docker run -d --name vector --restart unless-stopped \
     -v /var/run/docker.sock:/var/run/docker.sock:ro \
     -v "$PWD/observability/vector:/etc/vector:ro" -v vector-data:/var/lib/vector \
     -e O2_ENDPOINT=https://<openobserve-host> -e O2_ORG=<org> -e O2_STREAM=app \
     -e O2_USER=<service-account-email> -e O2_PASSWORD=<ingestion-token> \
     timberio/vector:0.50.0-alpine \
     --config /etc/vector/pipeline.yaml --config /etc/vector/docker-source.yaml
   ```
   Giá trị thật đặt trong env file trên server, không commit.
3. Đặt `DEPLOYMENT_ENVIRONMENT` và `APP_VERSION=<git sha>` cho container backend và frontend để lọc theo môi trường/bản build.
4. Retention trong OpenObserve (ví dụ 30 ngày) thay cho việc giữ log trong Postgres; bảng `log_entries`/`provider_call_logs` vẫn giữ nguyên cho màn admin.

Scale: app chỉ ghi stdout nên thêm process/container không cần đổi gì; Vector gom lô (≤ 1000 dòng / 2 s, gzip) và buffer đĩa 512 MB (đầy thì bỏ dòng mới nhất thay vì chặn). `route` là template và `upstream_path` đã thay id nên số giá trị khác nhau luôn nhỏ, lọc/group nhanh.
