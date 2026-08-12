# NOWPayments — xác minh contract Payment API (2026-08-12)

Nghiên cứu này chỉ dùng tài liệu chính thức NOWPayments, nhằm chốt các điểm cần thiết trước khi áp dụng plan nạp USDT.

Nguồn chính:

- [API and endpoint description](https://nowpayments.zendesk.com/hc/en-us/articles/21345824322717-API-and-endpoint-description)
- [IPN and how to setup](https://nowpayments.zendesk.com/hc/en-us/articles/21395546303389-IPN-and-how-to-setup)
- [Dashboard payment details](https://nowpayments.io/help/dashboard/how-to-view-past-payments-and-purchases)
- [Integration guide](https://nowpayments.zendesk.com/hc/en-us/articles/21341613323421-NOWPayments-Integration-Guide)

## Create payment và price currency

`POST https://api.nowpayments.io/v1/payment` yêu cầu `price_amount` và `price_currency`; API doc mô tả `price_currency` là mã fiat và chỉ dùng `usd` làm ví dụ. Những field phù hợp với luồng này gồm `pay_currency`, `ipn_callback_url`, `order_id`, `order_description`, `is_fixed_rate`, và `is_fee_paid_by_user`.

Tài liệu không liệt kê đầy đủ các `price_currency` hợp lệ. Vì vậy **chưa thể khẳng định `vnd` được hỗ trợ**. Phase 1 nên khoá `price_currency: "usd"`; chỉ mở `vnd` sau khi sandbox/API call với merchant account xác nhận nó hoạt động.

Response được document tối thiểu gồm `payment_id` và `pay_address`; phải persist provider payment ID và `order_id` ngay khi tạo payment.

## Số tiền và credit policy

Official dashboard định nghĩa “Amount Sent” là số khách *cần* gửi, không phải số đã gửi — tương ứng với `pay_amount`. IPN example gửi cả `pay_amount`, `actually_paid`, `outcome_amount`, `outcome_currency`, và `fee`:

- `actually_paid`: số user thực gửi; dùng để tính gross credit nếu policy là credit theo tiền user trả.
- `pay_amount`: số phải gửi/quote; **không được fallback** khi `actually_paid` vắng mặt hoặc bằng 0.
- `outcome_amount`: số merchant thực nhận sau xử lý/fee; không phải bằng chứng số user đã trả, và chỉ phù hợp nếu product cố ý credit theo net settlement.

Ví dụ IPN chính thức có `pay_amount=15`, `actually_paid=15`, nhưng `outcome_amount=14.8106`, kèm fee. Plan phải chọn duy nhất gross-credit hoặc net-credit; UI/ledger phải phản ánh đúng policy đó.

Chỉ credit khi: signature hợp lệ, `payment_status == "finished"`, `payment_id` và `order_id` cùng khớp deposit đã tạo, `pay_currency` đúng rail đã khoá, và `actually_paid` parse được, dương.

## Min amount và quote

`GET /v1/min-amount` dùng cặp crypto `currency_from` và `currency_to`, với `fiat_equivalent`, `is_fixed_rate`, `is_fee_paid_by_user` là optional; response trả `min_amount` và optional fiat equivalent. Giá trị này dynamic.

Với user trả `usdtbsc`, validate min theo `currency_from=usdtbsc` và outcome currency merchant đã cấu hình — không phải cặp `usd→usdtbsc`. `GET /v1/estimate` nhận `amount`, `currency_from` (fiat), `currency_to` (crypto) để lấy quote hiển thị.

## Expiry

Payment create API không document một TTL/expiration parameter. `POST /v1/payment/:id/update-merchant-estimate` trả `expiration_estimate_date`, nhưng đây là hạn estimate, không được document là payment expiry. Fixed rate khoá rate trong 10 phút.

Tài liệu chính thức mâu thuẫn về default payment expiry: trang dashboard nói 24 giờ, trang payment-details khác nói 7 ngày. Do đó local 60 phút chỉ được gọi là UI/quote window, không phải provider expiry; không tự từ chối một payment về sau được provider báo `finished`. Reconciliation retention cần policy vận hành riêng, dài hơn UI window.

## IPN, retries, idempotency

IPN là POST mỗi khi payment đổi status, có header `x-nowpayments-sig`; body tương tự GET payment status. Verification contract là recursively sort keys, JSON serialize canonical payload, HMAC-SHA512 với IPN secret, rồi so sánh signature (implementation dùng constant-time comparison).

Khi endpoint trả lỗi, NOWPayments gửi recurrent notifications; count và interval cấu hình ở Payment Settings (ví dụ doc: 3 lần cách nhau 1 phút). Handler phải durable/idempotent: journal event trước, validate identity, và chỉ trả success sau khi xử lý an toàn. IPN không thay thế reconciliation bằng GET status/list payments.

## Hosted invoice reconciliation

Hosted checkout trả `invoice_url` và `id` (invoice ID), còn payment ID chỉ tồn tại sau khi buyer chọn network. Khi IPN bị lỡ, `GET /v1/payment/:payment_id` không đủ vì app chưa biết payment ID.

API chính thức có `GET /v1/payment/?invoiceid=<invoice_id>` để list payment của invoice, nhưng endpoint này yêu cầu cả `x-api-key` và `Authorization: Bearer <token>`. Token lấy từ `POST /v1/auth` với email/password NOWPayments và chỉ có hiệu lực 5 phút. Vì vậy credential này là secret server-side; không được trả qua admin API/frontend. Dùng list để tìm candidate, sau đó vẫn phải `GET /payment/:id` và chạy đầy đủ validation invoice ID + `DEP-{intent_id}` + USDT allowlist + `actually_paid` trước khi credit.

## Điểm cần xác minh bằng sandbox / merchant configuration

1. `vnd` có được account/provider chấp nhận làm `price_currency` không.
2. `usdtbsc` có enabled cho merchant và outcome wallet/currency đã chọn không.
3. Cặp min-amount thực tế và fee setting (`is_fee_paid_by_user`, fixed rate) cho rail đó.
4. Provider lifecycle/expiry thực tế trước khi chốt reconciliation retention.
