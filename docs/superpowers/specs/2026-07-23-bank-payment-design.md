# Thanh toán nạp/rút qua PayOS — thiết kế & kế hoạch việc

Quyết định 2026-07-23: dùng **PayOS** (https://payos.vn/docs/) thay cho phương án SePay/memo-matching trước đó. Lý do: PayOS cấp `orderCode` gắn 1-1 với lệnh nạp ngay từ lúc tạo link → **không còn bài toán match memo** (nguồn lỗi lớn nhất của phương án cũ); có sẵn API Payout (chi tiền) để tự động hoá luồng rút ở phase 2.

## 0. PayOS — tóm tắt tích hợp

- Base URL: `https://api-merchant.payos.vn`. Auth headers: `x-client-id`, `x-api-key`.
- **Tạo link thanh toán**: `POST /v2/payment-requests` với `orderCode` (int, duy nhất, do MÌNH cấp), `amount`, `description` (≤ 9 ký tự với tài khoản thường — dùng `NAP<id>`), `returnUrl`, `cancelUrl`, `expiredAt` (epoch), `signature`.
  - `signature = HMAC_SHA256("amount=$amount&cancelUrl=$cancelUrl&description=$description&orderCode=$orderCode&returnUrl=$returnUrl", checksum_key)` (field sort alphabet).
  - Response: `checkoutUrl`, `qrCode` (VietQR string), `paymentLinkId`, `accountNumber`, `status`.
- **Webhook**: PayOS POST về URL đã đăng ký (`POST /confirm-webhook` một lần lúc setup) payload `{code, desc, success, data{orderCode, amount, reference, transactionDateTime, paymentLinkId, ...}, signature}`; verify `signature` = HMAC-SHA256 trên `data` (key sort alphabet) với checksum key.
- **Đối soát chủ động**: `GET /v2/payment-requests/{orderCode}` trả `status`, `amountPaid`, `transactions` — dùng khi nghi ngờ miss webhook.
- **Huỷ**: `POST /v2/payment-requests/{id}/cancel`.
- **Payout (phase 2 rút tiền)**: `POST /v1/payouts` với `x-idempotency-key` + `x-signature`, fields `referenceId`, `amount`, `toBin`, `toAccountNumber`; `GET /v1/payouts-account/balance` xem quỹ chi.

Secrets cần quản lý: `payos_client_id`, `payos_api_key`, `payos_checksum_key` (settings/env — không hardcode, không log).

## 1. Luồng nạp (deposit)

```
Buyer bấm "Nạp tiền" (số tiền X ≥ min)
  → POST /wallet/deposits
      → tạo deposit_intents row (status=pending) — id làm orderCode
      → gọi PayOS POST /v2/payment-requests (orderCode=id, amount=X,
        description="NAP"+id, expiredAt=+30', signature)
      → lưu payment_link_id/checkout_url/qr_code vào intent
      → trả FE {checkout_url, qr_code, amount, expires_at}
  → FE hiện QR (hoặc mở checkoutUrl), poll GET /wallet/deposits/me
Buyer quét QR chuyển khoản
PayOS → POST /webhooks/payos
  → verify signature (HMAC data, checksum key, compare_digest)
  → insert payos_webhook_events (unique theo (payment_link_id, reference) → replay = no-op)
  → khoá intent theo orderCode FOR UPDATE:
      pending → credit ví = data.amount THỰC NHẬN, status=paid, cùng transaction
      đã paid/cancelled/expired → chỉ ghi event, alert admin nếu bất thường
  → LUÔN trả 2xx (trừ sai chữ ký → 401)
FE poll thấy paid → cập nhật số dư
```

Điểm khác phương án cũ: `orderCode` map thẳng intent — **không có trạng thái "unmatched"**; ca lỗi duy nhất là miss webhook, xử lý bằng job đối soát (§3).

## 2. Schema (alembic mới)

- `deposit_intents`
  - `id` (PK — đồng thời là `orderCode` gửi PayOS), `account_id` FK, `amount` int (VND),
    `status` enum `pending|paid|cancelled|expired`, `payment_link_id` varchar unique nullable,
    `checkout_url` text, `qr_code` text, `paid_amount` int nullable, `payos_reference` varchar nullable,
    `created_at`, `expires_at`, `paid_at`.
- `payos_webhook_events` (sổ thô, immutable — đối soát + idempotency)
  - `id`, `payment_link_id`, `order_code` bigint, `reference` varchar, `amount` int,
    `raw` jsonb, `signature_valid` bool, `received_at`. **Unique (payment_link_id, reference)**.
- `withdraw_requests` thêm cột: `bank_bin`, `bank_name`, `bank_account_number`, `bank_account_holder`,
  `payout_reference` nullable, `paid_at` nullable. (`bank_bin` để phase 2 gọi Payout API `toBin`.)
- `transactiontype` enum thêm `deposit`.

## 3. Backend (module mới `src/payments/`)

- `payos_client.py`: wrapper mỏng — `create_payment_request()`, `get_payment_info()`, `cancel()`,
  ký signature (một hàm `_sign(fields: dict)` dùng chung, test được), timeout 10s, log vào
  `provider_call_logs`-style bảng riêng hay structlog (đơn giản: structlog + audit).
- `POST /wallet/deposits` (auth): body `{amount}`; min từ `settings.deposit_min_amount` (mặc định 10.000),
  tối đa 3 intent pending/account. Tạo intent → gọi PayOS → trả FE. PayOS lỗi → xoá intent, 502.
- `GET /wallet/deposits/me` (auth): list intent của mình (FE poll 5s).
- `POST /wallet/deposits/{id}/cancel` (auth, chủ intent): huỷ intent pending + gọi PayOS cancel (best-effort).
- `POST /webhooks/payos` (public):
  - Verify chữ ký như §0. Sai → 401. Payload không parse được → 200 + log (không cho retry-bão).
  - Idempotent qua unique event; xử lý trong 1 transaction với `SELECT ... FOR UPDATE` intent.
  - Credit qua MỘT hàm chung `apply_deposit_paid(intent, amount, reference, db)` — job đối soát dùng lại đúng hàm này.
- Scheduler (`src/scheduler.py` pattern sẵn có):
  - `deposit_reconcile_job` (mỗi 5'): intent `pending` quá 10' → `GET /v2/payment-requests/{orderCode}`;
    `PAID` → apply_deposit_paid (bù miss webhook); `CANCELLED/EXPIRED` → cập nhật trạng thái.
  - `deposit_expire_job`: pending quá `expires_at` + buffer → expired (PayOS tự expire theo `expiredAt` đã gửi).
- Admin: `GET /admin/deposits` (filter status), `GET /admin/payos-events` (soi raw), nút "đối soát lại" 1 intent.
- Settings mới: `payos_client_id`, `payos_api_key`, `payos_checksum_key`, `deposit_min_amount`,
  `enable_demo_topup` (default **false**, chỉ bật dev).

## 4. Luồng rút (withdraw)

Phase này (manual payout, PayOS chuẩn bị sẵn):
- `WithdrawRequestCreate` thêm bắt buộc: `bank_bin`, `bank_name`, `bank_account_number`, `bank_account_holder`
  (snapshot vào request — đổi số TK sau không ảnh hưởng lệnh cũ).
- Trạng thái: `pending → approved → paid` / `rejected`. Admin approve → chuyển tay → bấm "Đã chi" + `payout_reference`.

Phase 2 (auto-payout PayOS): approve → `POST /v1/payouts` (`x-idempotency-key` = `withdraw-{id}`,
`referenceId` = `wd-{id}`, `toBin`/`toAccountNumber` từ request) → poll `GET /v1/payouts/{id}` → `paid`.
Check `GET /v1/payouts-account/balance` trước khi chi + alert khi quỹ thấp. Chính sách affiliate rút: vẫn seller-only, quyết định business sau.

## 5. Frontend

- `/wallet`: khối "Nạp tiền" → nhập số tiền → hiện QR (`qr_code` render VietQR) + nút mở `checkout_url`
  + đếm ngược + poll trạng thái. Gỡ demo-topup UI (giữ sau flag dev).
- Form rút: thêm chọn ngân hàng (bin/tên) + số TK + chủ TK; hiển thị paid/payout_reference.
- Admin: trang Deposits (status, đối soát lại), Withdrawals thêm bước "Đã chi".

## 6. Bảo mật & edge case (checklist test)

1. Webhook replay cùng (payment_link_id, reference) → credit đúng 1 lần.
2. Chữ ký sai/thiếu → 401, không xử lý, không lộ chi tiết.
3. Hai webhook song song cùng orderCode → FOR UPDATE, 1 thắng.
4. `data.amount` ≠ intent.amount (chuyển thiếu/thừa qua checkout PayOS gần như không xảy ra, nhưng
   webhook là nguồn sự thật) → credit theo `data.amount`, ghi chú lệch.
5. Miss webhook → reconcile job bù trong ≤ 5–10'.
6. Intent expired rồi tiền mới về (webhook PAID muộn) → vẫn credit (tiền thật đã nhận), status paid, log cảnh báo.
7. orderCode không tồn tại → 200 + log + alert.
8. Demo-topup tắt ở prod (test config).
9. amount ≤ 0 / < min → 422; > 3 intent pending → 429.
10. PayOS API down lúc tạo intent → 502 sạch, không để intent mồ côi (xoá/rollback).
11. Signature helper: unit test vector cố định (biết trước HMAC) cho cả chiều tạo link lẫn chiều verify webhook.

## 7. Kế hoạch việc

| # | Việc | Phụ thuộc | Ước lượng |
|---|---|---|---|
| T01 | Migration: `deposit_intents`, `payos_webhook_events`, cột withdraw, enum `deposit` | — | 45' |
| T02 | Models + settings PayOS | T01 | 30' |
| T03 | `payos_client.py` (+_sign, unit test vector) | T02 | 60' |
| T04 | Service deposits: create/cancel/apply_deposit_paid | T03 | 60' |
| T05 | Webhook endpoint + verify + idempotency | T04 | 60' |
| T06 | Reconcile + expire jobs | T04 | 45' |
| T07 | Withdraw: bank fields + trạng thái paid | T01 | 45' |
| T08 | FE trang nạp (QR + poll + cancel) + gỡ demo-topup | T05 | 90' |
| T09 | FE withdraw + admin deposits/events UI | T05, T07 | 90' |
| T10 | Tests checklist §6 + webhook giả lập ký đúng/sai | T05–T07 | 90' |
| T11 | Setup thật: đăng ký kênh PayOS, confirm-webhook, env prod, docs vận hành | T08 | 45' |

Điều kiện live: T01–T08 + T10 xong, `enable_demo_topup=false`, webhook đã confirm về
`{backend}/webhooks/payos`. Phase 2 (auto-payout) tách đợt sau khi luồng nạp chạy ổn.
