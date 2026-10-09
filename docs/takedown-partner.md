# Gỡ link vi phạm — kết nối đối tác "Takedown Module"

Khách gửi link trên `/takedown`, đối tác (Takedown Module, tài liệu `API.vi.md`) làm việc gỡ.
GMMO gọi đối tác bằng **client key của chính GMMO** (vai trò `member`); đối tác báo trạng thái
về bằng **webhook có chữ ký**. Code: `marketplace-svc/src/takedown/`, giao diện:
`frontend/features/takedown` (khách) và `frontend/features/admin-takedown` (admin).

## Luồng và ai làm gì

| Bước | Ai | GMMO | Đối tác |
|---|---|---|---|
| Gửi link (link, loại vi phạm, bảo hành 24h/72h, ghi chú) | Khách | `review` | `POST /orders` → `pending_review` |
| Báo giá vốn | Đối tác | vẫn `review`, admin thấy giá vốn | `quote` → `quoted` |
| Đặt giá bán | Admin GMMO (`/admin/takedown/{code}`) | `quoted` | — |
| Chấp nhận | Khách | trừ số dư, tạo đơn thường của seller nội bộ → `started` | `accept` → `awaiting_payment` |
| Xác nhận thanh toán, gỡ | Đối tác | `processing` | `confirm-payment` → `processing` |
| Đã gỡ | Đối tác | `warranty` | `complete` → `in_warranty` |
| Link sống lại | Khách | `warranty_claim` | `warranty` → `warranty_pending` |
| Hết bảo hành | tự động | `done`, đơn `delivered` | `success` |
| Không gỡ được | Đối tác | `failed`, **hoàn tiền khách ngay** | `fail` → `failed` |
| Từ chối giá / huỷ | Khách | `rejected` / `cancelled` (đã trả thì hoàn) | `decline` / `cancel` |
| Không nhận làm | Đối tác | `declined` | `reject` |

- Mã gửi đối tác: `reason` luôn bắt đầu bằng `[TD-XXXXXXXX]` (đối tác chưa có trường mã ngoài). Mất response khi tạo đơn thì lần thử sau tìm lại theo mã này, không tạo trùng.
- `refund` của đối tác (trả giá vốn cho GMMO) chỉ được ghi lại cho admin; tiền khách đã hoàn từ lúc `failed`.
- Ảnh bằng chứng: backend tải ảnh từ URL đối tác (chỉ PNG/JPEG/WebP/GIF, ≤ 8 MB) và phát lại ở `/takedown/requests/{code}/evidence/{live|dead}` — khách không thấy domain đối tác, URL `http://` vẫn hiển thị được. Khách chỉ xem khi link đã gỡ.
- Lưới an toàn: job `takedown_sync` (2 phút/lần) đọc lại đơn chưa khớp, đơn quá 5 phút chưa đồng bộ, và đơn đã gỡ chưa có ảnh (đối tác đặt ảnh không gửi webhook). Admin có nút "Đồng bộ ngay".

## Khi đối tác gửi link/key thật — làm theo thứ tự

1. **Lấy từ đối tác** (không gửi qua chat, dán thẳng vào env server):
   - Địa chỉ API, gồm cả prefix: ví dụ `https://takedown.example.com/api/v1`.
   - Client key của GMMO (`tdk_...`): admin bên họ tạo bằng `POST /client-keys` với email của GMMO.
   - `WEBHOOK_SECRET` của họ (hoặc hai bên thống nhất một chuỗi ngẫu nhiên ≥ 32 ký tự).
2. **Gửi cho đối tác**: `WEBHOOK_URL = https://<backend công khai>/webhooks/takedown`
   (đi thẳng vào FastAPI như webhook SePay, không qua BFF). Nếu họ lọc IP ra/vào thì trao đổi IP server.
3. **Điền env backend** (file env trên server, không commit):

   ```
   TAKEDOWN_API_BASE_URL=https://takedown.example.com/api/v1
   TAKEDOWN_CLIENT_KEY=tdk_...
   TAKEDOWN_WEBHOOK_SECRET=<giống WEBHOOK_SECRET bên họ>
   TAKEDOWN_SELLER_EMAIL=<email tài khoản seller nội bộ đứng tên đơn>
   # TAKEDOWN_PRODUCT_ID=<tuỳ chọn: id sản phẩm "Gỡ link" để đơn gắn sản phẩm>
   TAKEDOWN_ESCROW_DAYS=0
   ```

   Chạy migration `alembic upgrade head` (revision `tk1a2b3c4d5e6`) rồi khởi động lại backend.
4. **Kiểm tra** ở `/admin/takedown`: banner cấu hình phải hết cảnh báo (đã cấu hình, có secret, có seller, đối tác phản hồi `/health`).
5. **Chạy thử trên staging** với một link thử, đối tác thao tác bên họ:
   gửi link → họ `quote` → admin đặt giá → khách chấp nhận (số dư giảm) → họ `confirm-payment` → `complete` + đặt ảnh →
   khách thấy ảnh → khách báo bảo hành → họ `warranty-reject` → hết hạn → `done`, đơn `delivered`.
   Làm thêm một đơn `fail` để thấy tiền hoàn về. Log `upstream_call` với `integration=takedown` ghi mọi lệnh gọi đối tác.

Chưa có env thì trang khách vẫn mở nhưng gửi link trả `503` ("dịch vụ chưa sẵn sàng"), không tạo gì.

## Chạy thử local với mock

```sh
cd marketplace-svc
uv run uvicorn scripts.mock_takedown:app --port 9402
# backend: TAKEDOWN_API_BASE_URL=http://127.0.0.1:9402/api/v1 TAKEDOWN_CLIENT_KEY=tdk_mock_gmmo
#          TAKEDOWN_WEBHOOK_SECRET=mock-takedown-webhook-secret TAKEDOWN_SELLER_EMAIL=<seller nội bộ>
```

Mock gửi webhook về `http://127.0.0.1:8002/webhooks/takedown` (đổi bằng `MOCK_TAKEDOWN_WEBHOOK_URL`).
Trang `http://127.0.0.1:9402/_mock` đóng vai admin đối tác: báo giá, xác nhận, hoàn thành, gắn ảnh, cho hết bảo hành, fail, refund.
`MOCK_TAKEDOWN_DROP_WEBHOOKS=1` bỏ mọi webhook để thử lưới đồng bộ. Mock giữ dữ liệu trong RAM: khởi động lại thì đơn cũ thành "Order not found".

## Còn mở

- Chưa gửi thông báo (chuông/email) cho khách khi có giá hoặc khi đổi trạng thái — khách thấy khi mở trang (tự làm mới 10 giây).
- Danh sách admin chưa phân trang phía server (tối đa 2000 dòng, phân trang ở trình duyệt).
- Backend tải ảnh từ URL do đối tác trả về; nếu muốn chặn cả URL nội bộ (SSRF) thì thêm danh sách host được phép.
