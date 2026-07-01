# Affiliate / Referral (Aff) — Design

Date: 2026-07-01

## Mục tiêu

Cho phép mọi tài khoản trên Proxora tự động có một mã giới thiệu (affiliate code). Khách vào site qua link giới thiệu sẽ được gắn cookie; nếu khách đăng ký tài khoản, tài khoản đó được gắn vĩnh viễn với affiliate đã giới thiệu. Khi tài khoản được giới thiệu mua hàng và đơn hoàn tất, affiliate nhận hoa hồng theo tỷ lệ cấu hình theo sản phẩm/danh mục, cộng thẳng vào ví. Có trang thống kê traffic/đơn/hoa hồng cho affiliate và trang quản trị cho admin.

## Phạm vi

- Mọi account tự động có 1 `affiliate_code` cố định (không cần đăng ký/duyệt).
- 1 code / affiliate (không có multi-campaign link).
- Attribution: first-touch, vĩnh viễn — gắn `referred_by_id` một lần duy nhất lúc đăng ký tài khoản.
- Hoa hồng tính theo % của `total_amount`, cấu hình ở cấp Product (override) → Category (fallback) → mặc định hệ thống (fallback cuối).
- Hoa hồng được cộng vào ví affiliate khi đơn hàng chuyển sang trạng thái `completed`.
- Chặn self-referral: không tính hoa hồng nếu `referred_by_id == buyer_id`.
- Không trong phạm vi: multi-tier affiliate (giới thiệu affiliate khác), rút hoa hồng riêng biệt khỏi flow withdraw ví hiện có, link/campaign phụ.

## Data model

### Sửa bảng có sẵn

`marketplace-svc/src/models/account.py` — `Account`:
- `affiliate_code: str` — unique, indexed, sinh tự động khi tạo account (vd 8 ký tự alphanumeric viết hoa).
- `referred_by_id: int | None` — FK `accounts.id`, nullable, set một lần duy nhất lúc đăng ký.

`marketplace-svc/src/models/category.py` — `Category`:
- `commission_rate: float | None` — % hoa hồng mặc định cho toàn bộ sản phẩm thuộc category (nullable).

`marketplace-svc/src/models/product.py` — `Product`:
- `commission_rate: float | None` — % hoa hồng riêng cho sản phẩm, override category (nullable).

`marketplace-svc/src/models/wallet.py` — `TransactionType`:
- Thêm `affiliate_commission = "affiliate_commission"`.

`marketplace-svc/src/config.py`:
- Thêm `DEFAULT_AFFILIATE_COMMISSION_PERCENT: float = 0` — fallback cuối khi cả product và category đều chưa cấu hình.

### Bảng mới

`marketplace-svc/src/models/affiliate.py`:

```python
class AffiliateClick(Base):
    __tablename__ = "affiliate_clicks"
    id: int (PK)
    affiliate_account_id: int (FK accounts.id, nullable=False, indexed)
    path: str | None            # trang khách vào
    referrer: str | None        # HTTP referrer nếu có
    created_at: datetime

class AffiliateCommission(Base):
    __tablename__ = "affiliate_commissions"
    id: int (PK)
    order_id: int (FK orders.id, unique, nullable=False)
    affiliate_account_id: int (FK accounts.id, nullable=False, indexed)
    buyer_account_id: int (FK accounts.id, nullable=False)
    rate_percent: float
    amount: int
    created_at: datetime
```

Migration: 1 file alembic mới nối tiếp `g1b2c3d4e5f6_product_pricing_columns` (đây là revision mới nhất trong `alembic/versions`).

## API mới (module `marketplace-svc/src/affiliate/`)

Theo đúng pattern `router.py` / `schemas.py` / `service.py` như các module hiện có (`wallet/`, `disputes/`).

- `POST /affiliate/click` — public. Body `{code: str}`. Resolve `affiliate_code` → ghi `AffiliateClick`. Trả `204`. Không lỗi nếu code không tồn tại (im lặng bỏ qua, tránh lộ thông tin).
- `GET /affiliate/me` — auth required. Query `from`, `to` (date range, optional). Trả:
  - `code`, `link` (frontend base URL + `?ref=code`)
  - `totals`: `clicks`, `signups`, `orders`, `revenue` (tổng `total_amount` các đơn tính hoa hồng), `commission` (tổng đã cộng ví)
  - `timeseries`: mảng theo ngày `{date, clicks, signups, orders, commission}` để vẽ chart
  - `commissions`: danh sách `AffiliateCommission` gần nhất kèm thông tin order rút gọn (id, product title, amount, rate, created_at)
- `GET /admin/affiliates` — admin only. Danh sách account kèm số liệu tổng hợp (clicks/signups/orders/commission), hỗ trợ search theo email, phân trang.
- `GET /admin/affiliates/{account_id}` — admin only. Chi tiết 1 affiliate, giống payload `/affiliate/me` nhưng admin xem cho account bất kỳ.

### Sửa API có sẵn

- `POST /auth/register` — schema thêm field optional `referral_code: str | None`. Service tạo account: sinh `affiliate_code` mới; nếu `referral_code` hợp lệ (tồn tại, khác chính account vừa tạo — luôn đúng vì account mới) → set `referred_by_id`.
- Schema update Product / Category (trong `products/schemas.py`, `categories/schemas.py`) — thêm field optional `commission_rate: float | None`.

## Luồng xử lý

1. **Click**: mọi trang frontend đọc query `?ref=CODE` (component `ReferralCapture` mount trong `RootLayout`). Nếu có: set cookie `aff_ref=CODE` (max-age 365 ngày, path `/`, không httpOnly), và gọi `api.affiliateClick(code)` (fire-and-forget, bỏ qua lỗi).
2. **Đăng ký**: trang `/register` đọc cookie `aff_ref` nếu tồn tại, gửi kèm `referral_code` khi gọi `api.register(email, password, referralCode)`.
3. **Gắn referral**: `auth/service.py.register()` — sau khi tạo account, nếu `referral_code` hợp lệ, set `referred_by_id`. Trường này chỉ set lúc tạo account, không bao giờ sửa sau.
4. **Hoàn tất đơn & tính hoa hồng**: trong `orders/service.py`, tại điểm order chuyển `status = completed` (cạnh logic escrow release hiện có) — thêm bước:
   - Load `buyer = order.buyer`
   - Nếu `buyer.referred_by_id is None` hoặc `buyer.referred_by_id == order.buyer_id` → bỏ qua (chặn self-referral).
   - Rate = `product.commission_rate` nếu có, else `category.commission_rate` nếu có, else `DEFAULT_AFFILIATE_COMMISSION_PERCENT`.
   - `amount = round(order.total_amount * rate / 100)`
   - Tạo `AffiliateCommission(order_id, affiliate_account_id=buyer.referred_by_id, buyer_account_id=buyer.id, rate_percent=rate, amount)`
   - Tạo `Transaction(type=affiliate_commission, wallet_id=<ví của affiliate>, amount, reference_id=str(order.id))`, cộng thẳng vào `wallet.balance` của affiliate (giống cách `purchase_release`/`refund` đang cộng/trừ ví hiện tại).
   - Bọc trong cùng transaction DB với việc chuyển trạng thái đơn, để đảm bảo nhất quán.

## Frontend

- `frontend/components/ReferralCapture.tsx` — client component, không render UI, side-effect only: đọc `useSearchParams()`, set cookie + gọi click API. Mount trong `RootLayout`.
- `frontend/lib/api.ts` — thêm `affiliateClick(code)`, `affiliateMe(params)`, `adminAffiliates(params)`, `adminAffiliateDetail(id)`; sửa `register()` để nhận thêm `referralCode?: string`.
- `frontend/app/register/page.tsx` — đọc cookie `aff_ref` (helper `getCookie` trong `lib/utils`), truyền vào `register()`.
- `frontend/app/affiliate/page.tsx` — trang mới (cần đăng nhập, dùng `useAuth`): hiển thị link giới thiệu (kèm nút copy), 4 thẻ số liệu tổng (clicks/signups/orders/commission), chart theo ngày (Recharts, theo pattern `admin` dashboard hiện có), bảng danh sách hoa hồng gần nhất, filter khoảng ngày.
- `frontend/app/admin/affiliates/page.tsx` — trang mới trong admin console: bảng danh sách affiliate + số liệu, search, click vào xem chi tiết (dùng pattern `AdminShell`, `stats-card`, `pagination` có sẵn trong `components/admin/`).
- `frontend/app/admin/products/[id]/page.tsx` và category form tương ứng — thêm input `commission_rate`.
- `frontend/components/TopNav.tsx` — thêm link "Affiliate" cho user đã đăng nhập.
- `frontend/lib/types.ts` — thêm types `AffiliateStats`, `AffiliateCommissionRow`, `AffiliateSummary`; mở rộng `Account`/`Product`/`Category` với field mới.

## Testing

- Backend: `marketplace-svc/tests/test_affiliate.py` mới — theo pattern các test hiện có (`test_wallet.py`, `test_orders.py`):
  - Đăng ký có `referral_code` hợp lệ → `referred_by_id` được set.
  - Đăng ký không có `referral_code` → `referred_by_id` là `None`.
  - Order completed với buyer có `referred_by_id` → tạo `AffiliateCommission` đúng rate (product override, category fallback, default fallback) và cộng đúng số dư ví affiliate.
  - Self-referral (`referred_by_id == buyer_id`) → không tạo hoa hồng.
  - `GET /affiliate/me` trả đúng tổng hợp số liệu.
  - `POST /affiliate/click` với code không tồn tại → không lỗi, không tạo record.
- Có thể cần cập nhật `test_auth.py` cho schema register mới, và test liên quan order completion trong `test_orders.py`.

## Rủi ro / lưu ý

- Tính hoa hồng phải nằm trong cùng transaction DB với việc release escrow / chuyển trạng thái order — tránh lệch số liệu nếu có lỗi giữa chừng.
- Cookie `aff_ref` không httpOnly (cần đọc bằng JS ở trang register) — chấp nhận được vì chỉ chứa 1 mã code công khai, không phải thông tin nhạy cảm.
- `affiliate_code` sinh ngẫu nhiên cần đảm bảo unique (retry nếu trùng, xác suất rất thấp với 8 ký tự alphanumeric).
