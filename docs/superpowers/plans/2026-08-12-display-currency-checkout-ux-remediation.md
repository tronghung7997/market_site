# Handoff: Display currency UX — bỏ lộ VND ledger, sửa checkout và chuẩn bị payment rail

**Ngày:** 2026-08-12  
**Loại:** Implementation handoff cho agent khác  
**Mục tiêu:** Người mua chỉ thấy currency họ chọn (mặc định USD). VND là implementation detail của ledger hiện tại, không xuất hiện ở catalog/checkout/history. Chỉ wallet nêu rõ payment method đang dùng là PayOS/VND.

## Quyết định bắt buộc

1. Locale (`en` / `vi`) và display currency (`USD` / `VND`) vẫn độc lập.
2. Buyer không cần biết base ledger hiện tại là VND. Không hiển thị các copy như:
   - “All payments settle in VND.”
   - “USD is an approximate conversion.”
   - “Pay in VND.”
   - “not the purchase-time rate” trên từng order card.
3. Catalog, product page, checkout summary, order list/history và buyer wallet dùng **display currency** đã chọn.
4. Nạp tiền là exception có chủ đích: wallet phải hiển thị payment rail cụ thể đang active:
   - Hiện tại: `PayOS bank transfer` và amount VND mà PayOS/QR sẽ nhận.
   - Tương lai: `USDT` network/amount nếu chọn crypto rail.
5. Không đổi money API, VND ledger, PayOS webhook, escrow/refund/commission trong task này. Không gửi USD từ frontend vào API.

## 1. Sửa UX checkout trong ảnh

### Vấn đề hiện tại

Ảnh đang có:

```text
Unit: ≈ $1.92
Quantity: 2
Total: ≈ $3.85
All payments settle in VND. USD is an approximate conversion.
```

- Dòng cuối làm lộ implementation detail mà buyer không cần biết.
- `2 × ≈ $1.92` có thể khiến buyer nhẩm ra `$3.84`, trong khi total đúng là `$3.85`: hệ thống tính trên VND gốc rồi mới round total. Không sai về số học, nhưng UI tạo cảm giác sai do round từng unit trước.
- Dấu `≈` cạnh total cỡ lớn dễ giống icon/lỗi glyph và nhấn mạnh sự “không chắc chắn” ngay trước CTA.

### Target UI

```text
Choose package
Gói cơ bản                                  $1.92

Quantity                                  [ −  2  + ]

Total                                      $3.85
2 units · final amount shown at checkout

[ Buy now ]
Escrow 3 days · Funds release only when you confirm
```

Rules:

- Không prefix `≈` trên unit price hoặc total trong checkout.
- Tổng luôn tính từ raw `amount_vnd` trước, sau đó format đúng một lần; **không** nhân giá USD đã rounded.
- Không nêu VND, FX rate hay disclaimer tỷ giá ở product/order modal.
- Nếu vẫn cần legal transparency, chỉ để một link/tooltip kín đáo `How prices work`, không phải inline copy cạnh nút Buy.
- Khi display currency là VND: vẫn chỉ hiện VND bình thường, không copy giải thích.

### Code hướng sửa

- `frontend/app/[locale]/products/[id]/OrderPanel.tsx`
  - bỏ `payInVnd` block.
  - formatter checkout không prepend `≈`; thêm API rõ nghĩa, ví dụ `formatCheckoutMoney(amountVnd, context)`.
  - dùng formatter này cho package, unit, total và confirmation modal.
- Không dùng string USD đã format để tính `total`; giữ `total` raw như hiện tại.
- Bổ sung test: `50,000 / 26,000 = $1.923...`, quantity `2` render `$3.85`, không `$3.84`.

## 2. Tách formatter theo mục đích thay vì ép `≈` toàn site

Giữ một module duy nhất `frontend/lib/money/`, nhưng API cần thể hiện intent:

```ts
formatBrowseMoney(amountVnd, context)     // catalog: $x.xx hoặc ₫x; không copy rail
formatCheckoutMoney(amountVnd, context)  // checkout: $x.xx hoặc ₫x; không ≈
formatOrderHistoryMoney(amountVnd, snapshotRate, context)
formatLedgerMoney(amountVnd, locale)     // admin/form nội bộ, luôn VND
```

Không để component tự `/ fxRate`, tự gọi `Intl.NumberFormat`, hay hard-code `$`, `₫`, `VND`, `USD`.

### Order history

- Order mới: dùng `display_fx_rate_snapshot` để currency display không trôi.
- Order cũ không snapshot: force legacy `26,000 VND/USD` như đã chốt.
- Không render disclaimer dài trên từng card. Nếu cần disclosure:
  - tooltip trên small info icon cạnh amount; hoặc
  - một notice duy nhất đầu trang Orders khi danh sách có legacy orders.
- Buyer chỉ thấy `$x.xx` hoặc `₫x`; không nói VND is ledger/base.

## 3. Wallet: nơi duy nhất nói payment method

### Wallet balance/history

- Balance và transaction list tiếp tục theo display preference như buyer UI khác.
- Không gọi balance là “VND balance” trong chrome/buyer history.

### Deposit

Tại flow nạp, hiển thị payment rail như sản phẩm thanh toán, không phải implementation detail:

```text
Add funds
Payment method: Bank transfer via PayOS
You will transfer: ₫100,000
[ Create payment link ]
```

- Khi user đang chọn USD, amount input vẫn có thể hiển thị USD theo UX mong muốn, nhưng trước khi tạo PayOS link phải có review/payment sheet nói **amount PayOS sẽ thu** là VND.
- Không thay API hoặc convert input USD trong task này nếu chưa có design riêng.
- PayOS QR/checkout page là nguồn sự thật cho payment amount hiện tại.

## 4. Chuẩn bị cho USDT sau này — không làm giả crypto từ bây giờ

Không buộc buyer biết VND hôm nay **không** chặn migration sang USDT. Cần giữ payment rail tách khỏi display currency:

```text
Display currency (USD/VND)   ≠   Payment rail (PayOS/USDT)   ≠   Ledger implementation
```

Khi triển khai USDT:

1. Wallet deposit thêm chọn `Payment method`: `Bank transfer (PayOS)` / `USDT`.
2. USDT flow hiện chính xác network, token, address, expiry, crypto amount và confirmations.
3. Nếu USDT vẫn credit VND ledger: conversion rate, quote expiry và amount credited phải được ghi/audit ở backend; buyer thấy payment contract USDT trong wallet, không ở product catalog.
4. Nếu sau này wallet thật sự giữ USD/USDT: đó là multi-currency ledger project riêng, không mở rộng display-currency feature này.

Không được đổi price display sang “USDT” chỉ vì payment rail là USDT; đó là 3 domain khác nhau.

## 5. Admin money UX remediation

### Bugs/UX cần xử lý

1. Bỏ heading trùng `Tỷ giá hiển thị`: `AdminShell` đã render page title, page content chỉ giữ subtitle.
2. `Reset về tỷ giá ENV` hiện reset cả rate, default currency và hai visibility flags. Sửa một trong hai:
   - reset **chỉ rate**; hoặc
   - rename `Reset all display settings from ENV` + confirm modal liệt kê 4 fields bị thay.
3. Input rate có thousand separator và suffix `VND per USD`; preview phải dùng formatter chung, không string `Example`/`$` hard-code.
4. Hiện source theo ngôn ngữ product: `Admin override` / `Environment default`, không phải “Cơ sở dữ liệu (admin)” như technical metadata chính.

### Layout đích

```text
Tỷ giá hiển thị
Controls how buyers see USD and VND. Does not change prices, balances, or settlements.

┌ Current display rate ─────────────────────────────────────────┐
│ 26,000 VND per USD       Admin override                         │
│ Preview: 50,000 → $1.92                                        │
│ ENV default: 25,500                         [Reset rate]       │
└────────────────────────────────────────────────────────────────┘

┌ Default experience ────────────────────────────────────────────┐
│ New visitor currency   [ USD | VND ]                            │
│ [✓] Let visitors change currency                                │
│ [ ] Show language switcher                                      │
│                                               [Save changes]    │
└────────────────────────────────────────────────────────────────┘
```

- Desktop: dùng `max-w-3xl`, không để card 575px giữa khoảng trắng lớn.
- Mobile: giữ single-column; không có duplicate title; Save sticky footer nếu form dài.
- Khi rate thay đổi, note cho admin: “Affects future browsing immediately. New orders retain their own snapshot.” Đây là information cho operator, không hiển thị buyer.

## 6. Regression checklist

- [ ] USD buyer checkout không có `≈`, `VND`, `PayOS`, `FX`, hoặc copy ledger; total uses raw amount then rounds once.
- [ ] VND buyer checkout vẫn hoạt động và chỉ hiện VND như UI cũ.
- [ ] Đổi USD/VND không gọi order, quote, deposit, withdraw, refund hoặc charge endpoint.
- [ ] Order mới dùng snapshot; order cũ dùng 26,000; disclosure legacy không lặp trên từng card.
- [ ] Wallet deposit (PayOS) mới hiển thị VND/payment method rõ ràng đúng lúc tạo payment.
- [ ] Admin reset action khớp chính xác với label và confirmation.
- [ ] EN/VI thay đổi độc lập USD/VND.
- [ ] Unit tests import source formatter thật, gồm rounding `50,000 × 2 @ 26,000 = $3.85`.
