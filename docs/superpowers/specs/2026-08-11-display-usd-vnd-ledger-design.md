# Display currency USD/VND · Ledger VND — thiết kế an toàn

**Ngày:** 2026-08-12
**Trạng thái:** Implemented (P0–P4) — 2026-08-12
**Phạm vi:** Tách ngôn ngữ khỏi currency, đổi cách hiển thị tiền và lưu rate snapshot cho đơn. Ledger, API money, payment rail và giá lưu trữ vẫn là VND integer.

## 1. Quyết định product

| # | Quyết định |
|---|---|
| D1 | Locale (`vi` / `en`) và display currency (`VND` / `USD`) là **hai preference độc lập**. Đổi ngôn ngữ không tự đổi currency; người dùng EN vẫn chọn VND, người dùng VI vẫn chọn USD. |
| D2 | VND là đơn vị sổ cái duy nhất: wallet, quote, order, refund, escrow, commission, PayOS và mọi API amount giữ nguyên `int` VND. |
| D3 | USD là giá trị quy đổi để hiển thị: `usd = amount_vnd / rate_vnd_per_usd`; luôn mang `≈` và disclaimer thanh toán VND. |
| D4 | Site có một rate hiện hành do admin quản trị. Config persist trong DB ưu tiên hơn ENV; ENV chỉ bootstrap/fallback. User chỉ chọn currency; không được tự chọn rate. |
| D5 | Order mới lưu snapshot rate tại lúc tạo. Lịch sử hiển thị USD theo snapshot, không theo rate hiện tại. Order cũ không có snapshot dùng fixed historical fallback `26_000 VND/USD`, được gắn nhãn rõ ràng. |
| D6 | UI submit tiền (mua, nạp, rút, admin top-up) luôn là VND. Không có nhập USD, USD → VND conversion, hay `currency=USD` trong request ở phase này. |

Không làm: multi-currency wallet, đổi đơn vị DB, PayOS USD, giá seller lưu USD, hay auto FX theo API ngoài.

## 2. Trải nghiệm kiểu Booking

Ngôn ngữ và tiền tệ là hai control cạnh nhau trong TopNav/Settings:

```
Language: [Tiếng Việt | English]       Currency: [VND | USD]
```

- Locale tiếp tục do i18n/router quản lý như hiện tại.
- Currency là setting site-wide độc lập. Default site là `USD`, không suy luận từ locale.
- Preference currency lưu cookie `display_currency=VND|USD` để SSR có cùng state với client; `localStorage` chỉ là mirror/cache, không phải source ban đầu.
- Nếu user chưa chọn hoặc cookie sai: dùng `DISPLAY_CURRENCY_DEFAULT=USD`.
- Toggle chỉ thay format render, không gọi bất cứ API charge/quote/order/deposit/withdraw nào.

## 3. Mô hình tiền và tỷ giá lịch sử

```
amount_vnd integer ── current rate ──> catalog / wallet / quote hiện tại: ≈ USD
       │
       └── order created ──> display_fx_rate_snapshot ──> order history: ≈ USD lúc mua
```

`display_fx_rate` là số VND cho 1 USD; chỉ format mới làm tròn 2 chữ số USD. Không được round-trip USD về DB.

### Chính sách hiển thị

| Bề mặt | Khi preference VND | Khi preference USD |
|---|---|---|
| Catalog, quote hiện tại, ví, TopNav | VND | `≈ $x.xx` theo **rate hiện tại** |
| Checkout / deposit / withdrawal input và confirmation | VND chính | VND chính, có thể thêm hint `≈ $x.xx` theo rate hiện tại |
| Order history có snapshot | VND | `≈ $x.xx at purchase rate` theo **snapshot** |
| Order history không snapshot (đơn cũ) | VND | `≈ $x.xx` theo fixed historical fallback `26_000 VND/USD`, kèm nhãn *Calculated at the legacy display rate (26,000 VND/USD); not the purchase-time rate.* |
| Admin, payout, reconciliation | VND bắt buộc | VND bắt buộc; USD không thay số đối soát |

Vì rate thời điểm mua của order cũ không thể suy ra chính xác từ rate hiện tại, không được backfill snapshot bằng rate hiện tại. Product chấp nhận một legacy display rate cố định `26_000 VND/USD`; đây chỉ là fallback hiển thị, không phải chứng từ tỷ giá lúc mua và không tác động VND ledger. Constant này phải immutable sau rollout để lịch sử cũ không tiếp tục trôi.

## 4. Nguồn sự thật rate

Production dùng backend runtime config, không dùng `NEXT_PUBLIC_*` làm source rate:

```env
# marketplace-svc: giá seed/fallback cho lần bootstrap đầu tiên
DISPLAY_FX_RATE=25500
DISPLAY_FX_RATE_MIN=10000
DISPLAY_FX_RATE_MAX=50000
DISPLAY_CURRENCY_DEFAULT=USD
DISPLAY_ALLOW_USER_TOGGLE=true
```

- **Precedence:** config rate persist trong DB hợp lệ → `DISPLAY_FX_RATE` từ ENV → fallback an toàn VND-only (không render USD). ENV không bao giờ ghi đè record DB đang có khi service restart/deploy.
- Lần bootstrap đầu tiên, nếu DB chưa có record, service seed record bằng `DISPLAY_FX_RATE` ENV. Admin PATCH rate ghi record DB và audit `actor_id`, `old_rate`, `new_rate`, `changed_at`.
- Nếu vận hành muốn quay về giá ENV, dùng action admin **Reset to environment rate** có audit; không xóa record hay đổi rate âm thầm qua restart.
- Backend validate rate là integer finite, `min <= rate <= max`; reject 0, âm và ngoài range.
- `GET /public/money-config` trả rate hiện hành, default và toggle flag. FE có một provider duy nhất fetch/cache config theo request lifecycle; không để từng component tự fetch.
- FE có fallback VND nếu config vắng mặt hoặc invalid; không render `NaN`, `Infinity`, hay USD không có rate.

## 5. Contract tối thiểu

```http
GET /public/money-config
```

```json
{
  "ledger_currency": "VND",
  "display_fx_rate": 25500,
  "display_currency_default": "USD",
  "allow_user_toggle": true
}
```

Khi tạo order, backend resolve **effective rate** theo precedence trên, rồi lưu giá trị đó vào `orders.display_fx_rate_snapshot` trong cùng transaction tạo order. API order trả field này. Không đổi `total_amount`, wallet hay các payload amount hiện có.

Với order có `snapshot = null` (toàn bộ order tạo trước rollout), FE dùng constant immutable `LEGACY_ORDER_DISPLAY_FX_RATE=26000`; API không mutate hay backfill các order cũ. Luôn render disclaimer: *Calculated using legacy rate 26,000 VND/USD — not purchase-time rate.*

Migration chỉ thêm nullable snapshot column. Rollback có thể tắt toggle/default VND mà không động tới money ledger; snapshot đã lưu được giữ lại vì là dữ liệu lịch sử vô hại.

## 6. Một đường dùng chung — không hard-code

Tạo một module frontend, ví dụ `frontend/lib/money/`, là nơi duy nhất biết VND, USD, rate và `Intl.NumberFormat`:

```ts
type DisplayCurrency = "VND" | "USD";

formatLedgerMoney(amountVnd, locale) // luôn VND: form, admin, reconciliation
formatDisplayMoney(amountVnd, { locale, currency, fxRate }) // VND hoặc ≈ USD
formatHistoricalOrderMoney(amountVnd, snapshotRate, context) // snapshot hoặc legacy fixed rate 26_000
```

`CurrencyProvider` sở hữu config runtime và preference cookie; `useMoney()` trả các formatter trên. Component không tự chia rate, không tự đặt `Intl.NumberFormat`, `₫`, `$`, `đ`, `VND`, `USD`, hay `toLocaleString("vi-VN")` cho giá trị tiền.

`vnd()` hiện tại trở thành alias của `formatLedgerMoney()` trong giai đoạn migration để UI cũ giữ nguyên. Chỉ những caller đã được phân loại buyer-facing mới đổi sang `formatDisplayMoney()`.

`MoneyInput` vẫn nhận chuỗi số nguyên VND, vẫn submit VND và luôn dùng `formatLedgerMoney`. Khi preference USD, chỉ render hint quy đổi. Không cho nhập decimal/USD.

Thêm lint/CI guard cho các thư mục UI money: cấm import formatter trực tiếp hoặc literals currency ngoài module `lib/money` và copy i18n đã cho phép. Kèm test/inventory để xử lý các bypass `vnd()` trước khi bật feature flag.

## 7. Bảo toàn UI và logic cũ

1. Ship module + tests nhưng feature flag `DISPLAY_ALLOW_USER_TOGGLE=false`; tất cả render tiếp tục VND qua alias `vnd()`.
2. Phân loại toàn bộ call site: buyer display, form/action, history, admin/reconciliation. Không thay global một lần.
3. Chuyển buyer catalog/quote/wallet/TopNav sang `useMoney().formatDisplayMoney`; màn form/action và admin gọi `formatLedgerMoney` rõ ràng.
4. Thêm backend config + snapshot order, test API contract giữ nguyên; sau đó bật toggle cho một môi trường/test cohort.
5. Bật production với `DISPLAY_CURRENCY_DEFAULT=USD`. User đã lưu preference VND vẫn thấy VND; logic money và request payload không đổi.

Invariant bắt buộc:

- Mọi request body amount trước/sau rollout byte-for-byte cùng đơn vị VND.
- Quyết định UI (disable button, min/max, validation, totals dùng để submit) tiếp tục dùng raw VND, không dùng string đã format.
- PayOS QR, webhook, refund, escrow và commission không nhận code-path currency display.
- Admin và đối soát luôn thấy VND dù cookie user là USD.

## 8. Kế hoạch PR

| PR | Nội dung |
|---|---|
| P0 | `lib/money` + unit tests; giữ `vnd()` alias; audit toàn bộ formatter/literal money; không đổi UI. |
| P1 | CurrencyProvider + cookie preference + toggle độc lập i18n; default USD/feature flag; buyer surfaces chuyển dần qua formatter chung. |
| P2 | Backend runtime money config, admin persistence/audit và public config endpoint. |
| P3 | Migration nullable `orders.display_fx_rate_snapshot`; resolve effective rate và capture snapshot atomically khi tạo order; API/schema; order cũ `NULL` dùng fixed legacy rate 26.000. |
| P4 | E2E/regression, bật flag theo môi trường; default USD. |

## 9. Test checklist

- [ ] Locale `en` + VND và locale `vi` + USD đều hoạt động; đổi locale không đổi currency, đổi currency không đổi locale.
- [ ] Cookie absent/invalid fallback USD; SSR và client không hydration mismatch.
- [ ] `50000 VND` tại rate `25500` hiển thị `≈ $1.96`; rate invalid fallback VND.
- [ ] DB rate hợp lệ thắng ENV; DB trống được seed một lần từ ENV; restart với ENV khác không làm đổi DB rate; admin reset-to-ENV có audit.
- [ ] Catalog/wallet dùng rate hiện tại; order mới dùng snapshot; order cũ không snapshot dùng đúng fixed legacy rate 26.000 và có nhãn disclaimer, không dùng rate hiện tại.
- [ ] Toggle không phát sinh API call money và không đổi order/deposit/withdraw request payload.
- [ ] MoneyInput, validation min/max và button logic giữ raw VND, kể cả khi display USD.
- [ ] Admin/reconciliation luôn VND khi preference USD.
- [ ] Search/CI không còn bypass formatter ngoài allowlist; PayOS/order/refund tests vẫn assert integer VND.

## 10. Tóm tắt

> Locale là ngôn ngữ; VND/USD là preference hiển thị độc lập. VND luôn là tiền thật. USD là quy đổi có dấu `≈`; order mới giữ rate snapshot, order cũ thành thật hiển thị VND khi không có dữ liệu lịch sử.
