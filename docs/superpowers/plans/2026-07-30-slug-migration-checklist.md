# Checklist: đổi slug tiếng Việt cho categories / products / solutions

> Khảo sát ngày 2026-07-30 (nhánh `refactor/buyer-frontend`). Mọi file:line dưới đây
> đã soi thật tại thời điểm đó — nếu làm sau khi codebase đổi nhiều, grep lại
> `/products/${` và `/categories/${` để cập nhật danh sách link site.
>
> Ước lượng tổng: **~2,5–3 ngày** (đợt 1 ~1 ngày, đợt 2 ~1,5–2 ngày).
> Phần solutions đọc từ admin: **hoãn** (+2–3 ngày, chỉ đáng khi >2 giải pháp).

## Hiện trạng (đã khảo sát — không cần soi lại)

| | Slug trong DB | Admin sửa được | API trả về | Frontend dùng |
|---|---|---|---|---|
| Categories | ✅ `String(100) unique NOT NULL` — `marketplace-svc/src/models/category.py:12` | ✅ form có field Slug — `frontend/app/admin/categories/page.tsx:100` | ✅ `/categories` trả slug (`CategoryResponse.slug`) | ❌ link theo `id` (7 chỗ) |
| Products | ❌ chưa có cột (`marketplace-svc/src/models/product.py`) | ❌ | ❌ | ❌ link theo `id` (17 chỗ) |
| Solutions | — không có backend, mảng hardcode trong `frontend/app/solutions/page.tsx` (href cứng `/products/11`, `/products/12`) | — | — | 2 link ở TopNav |

Fact đã verify:
- Slug categories hiện tại trong DB dev là tiếng Anh: `social`, `twitter`, `telegram`, `facebook`, `take-down`, `proxies`, `cloud`, `payment`, `cloud-service`, `vpn` (+1 rác `notifdemo…`).
- Backend **không nơi nào tự build URL frontend** (đã check notifications/scheduler) → không có bãi mìn ẩn.
- `frontend/next.config.mjs` mới chỉ có `rewrites()` (proxy `/api`), **chưa có** `redirects()`; **không có** `middleware.ts`.
- `frontend/lib/types.ts:28` — type `Category` đã khai báo `slug: string` sẵn.
- 35 sản phẩm trên dev, có title rác (`"1"`, `"Notif Demo Product"`) → backfill slug vẫn chạy, slug xấu kệ (data dev).

## Quyết định cần chốt TRƯỚC khi bắt đầu

- [ ] **Slug thuần hay slug+id?** Đề xuất: **slug thuần** (`/san-pham/proxy-dan-cu-tinh-viet-nam`), vì backend giữ fallback tra theo id vĩnh viễn (mục B3) nên link cũ không chết. Kiểu Tiki (`…-p25`) chỉ đáng khi vạn sản phẩm trùng tên.
- [ ] **Có gộp với SSR/SEO không?** Các trang này đang `"use client"` + fetch, chưa có metadata động → slug đẹp chỉ ăn phần share-link/UX. Nếu đích là SEO thì gộp đợt 2 với đợt SSR (item treo từ refactor buyer) làm một, tổng ~3–4 ngày.
- [ ] **Policy đổi slug từ admin:** đổi slug = URL cũ chết (chấp nhận với category vì ít + fallback id vẫn sống). Nếu sau này cần chuỗi redirect lịch sử slug → bảng `slug_history`, NGOÀI phạm vi đợt này.

---

## Đợt slug-1 — Categories + route tiếng Việt + rename solutions (~1 ngày, không đụng DB)

### A1. Đổi route folder (Next.js app router)

- [ ] `frontend/app/categories/` → `frontend/app/danh-muc/` (cả trang hub lẫn `[id]/` → `[slug]/`)
- [ ] `frontend/app/products/[id]/` → `frontend/app/san-pham/[slug]/` (làm luôn ở đợt 1 cho đỡ rename 2 lần; trong đợt 1 segment `[slug]` vẫn nhận id số — xem A4)
- [ ] `frontend/app/solutions/` → `frontend/app/giai-phap/`
- [ ] `git mv` để giữ history, KHÔNG copy-paste folder

### A2. Trang danh mục resolve theo slug (client-side, không cần endpoint mới)

- [ ] `app/danh-muc/[slug]/page.tsx`: thay `Number(id)` → tìm trong `flattenCategories(cats)` theo `c.slug === param`; nếu param là **số** thì tìm theo id rồi `router.replace()` sang URL slug canonical (link cũ `/categories/6` sống)
- [ ] Trang này vốn đã fetch cả cây `api.categories()` → resolve tại chỗ, zero backend

### A3. Sửa link site categories (7 chỗ, `c.id` → `c.slug`)

- [ ] `frontend/app/categories/page.tsx:99` (định danh kệ)
- [ ] `frontend/app/categories/page.tsx:116` (chip danh mục con)
- [ ] `frontend/app/categories/page.tsx:124` ("Vào danh mục")
- [ ] `frontend/app/categories/page.tsx:134` (ô "Xem tất cả")
- [ ] `frontend/app/categories/[id]/page.tsx:116` (breadcrumb cha)
- [ ] `frontend/app/page.tsx:156` (card danh mục ở home)
- [ ] `frontend/app/products/[id]/page.tsx:75` (breadcrumb trang sản phẩm — cần `category_slug`, xem A5)
- [ ] Đường dẫn trong link đổi `/categories/…` → `/danh-muc/…`

### A4. Redirect link cũ (thêm `redirects()` vào `frontend/next.config.mjs`)

- [ ] `/categories` → `/danh-muc` (permanent)
- [ ] `/categories/:id` → `/danh-muc/:id` (permanent — id số được A2 tự canonical hoá tiếp)
- [ ] `/products/:id` → `/san-pham/:id` (permanent)
- [ ] `/solutions` → `/giai-phap` (permanent)
- [ ] 2 link TopNav: `frontend/components/TopNav.tsx:75` và `:147` (`/solutions` → `/giai-phap`); NAV_LINKS `/categories` → `/danh-muc` (`TopNav.tsx:16`) — active-state dùng `startsWith`, đổi path xong vẫn chạy

### A5. Backend 2 dòng — `category_slug` cho breadcrumb sản phẩm

- [ ] `marketplace-svc/src/products/schemas.py`: thêm `category_slug: str | None` vào response (cạnh `category_name`)
- [ ] `marketplace-svc/src/products/service.py`: serializer detail (chỗ đang gắn `category_name`) thêm `"category_slug"`
- [ ] `frontend/lib/types.ts`: thêm `category_slug` vào `ProductDetail`

### A6. Nhập slug tiếng Việt trong admin (data, ~10 phút tay)

Đề xuất (tên riêng giữ nguyên, không dấu, `đ→d`):

| id | name | slug cũ | slug mới |
|---|---|---|---|
| 1 | Mạng xã hội | `social` | `mang-xa-hoi` |
| 5 | Twitter / X | `twitter` | `twitter` (giữ) |
| 6 | Telegram | `telegram` | `telegram` (giữ) |
| 7 | Facebook | `facebook` | `facebook` (giữ) |
| 8 | Dịch vụ Takedown | `take-down` | `dich-vu-takedown` |
| 2 | Proxy & VPN | `proxies` | `proxy-vpn` |
| 3 | Cloud & Server | `cloud` | `cloud-server` |
| 4 | Thanh toán & Credit | `payment` | `thanh-toan-credit` |
| 9 | Dịch vụ Cloud | `cloud-service` | `dich-vu-cloud` |
| 10 | VPN | `vpn` | `vpn` (giữ) |

- [ ] Dọn hoặc kệ category rác `#11 NotifDemo…` (data dev)
- [ ] Nhớ làm cả trên **prod** khi deploy (slug prod có thể khác dev)

---

## Đợt slug-2 — Products slug end-to-end (~1,5–2 ngày, có migration)

### B1. Model + migration + backfill

- [ ] `marketplace-svc/src/models/product.py`: `slug: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)`
- [ ] Hàm slugify tiếng Việt — file mới `marketplace-svc/src/products/slug.py`:
  - `slugify_vi(title)`: NFD strip dấu, `đ→d`, lowercase, non-alnum → `-`, gộp/trim `-`, cắt 140 ký tự
  - `unique_slug(base, db)`: trùng thì thêm hậu tố `-2`, `-3`… (hoặc `-{id}`)
- [ ] Migration alembic (nếp đặt tên sẵn trong `marketplace-svc/alembic/versions/`): thêm cột nullable → backfill 35 sản phẩm bằng `slugify_vi(title)` + chống trùng → set NOT NULL + unique index. Backfill viết **trong migration** (server-side), không script tay

### B2. Backend write path

- [ ] `create_product` (`service.py`): tự sinh slug từ title nếu body không gửi; đảm bảo unique
- [ ] `ProductCreate` (`schemas.py:6`): thêm `slug: str | None = None` (optional, validate regex `^[a-z0-9]+(-[a-z0-9]+)*$`)
- [ ] `ProductUpdate` (`schemas.py:22`): thêm `slug` (seller sửa được), validate + check unique trong `update_product`
- [ ] PATCH `/admin/products/{id}` (`router.py:88`): thêm `slug` vào schema body admin dùng
- [ ] Slug trùng → trả 409/422 message rõ, đừng 500 vì IntegrityError

### B3. Backend read path — nhận cả id lẫn slug

- [ ] `router.py:18` `get_product(product_id: int)` → `get_product(id_or_slug: str)`: `isdigit()` → tra id, ngược lại tra slug (404 nếu không có). Route con `/products/{id}/operations|reviews|pricing-options|calculate` khác số segment → không conflict, giữ nguyên int
- [ ] Thêm `"slug"` vào **cả hai** serializer dùng chung trong `service.py` (list + detail — chúng build dict tay, không from_attributes)
- [ ] `ProductResponse` (`schemas.py`): thêm `slug: str`
- [ ] Tests `marketplace-svc/tests/test_products.py`: case tra theo slug, tra theo id vẫn chạy, slug trùng khi create/update, backfill format

### B4. Frontend — 17 link site `p.id` → `p.slug` + route

- [ ] `frontend/lib/types.ts`: `Product` + `ProductDetail` thêm `slug: string`
- [ ] `frontend/lib/api.ts:77`: `product: (idOrSlug: string)` (giữ gọi được bằng id cho fallback)
- [ ] `app/san-pham/[slug]/useProductDetail.ts`: bỏ `Number(id)`, truyền thẳng string; nếu param là id số → sau khi fetch, `router.replace` sang `/san-pham/{slug}` canonical
- [ ] Link sites buyer (12):
  - `frontend/components/ProductTile.tsx:32`
  - `frontend/components/home/PriceBoard.tsx:28`
  - `frontend/components/home/MarketSection.tsx:126`, `:143`, `:157`
  - `frontend/components/home/FeaturedSection.tsx:32`
  - `frontend/app/products/[id]/sections.tsx:172` (related)
  - `frontend/app/sellers/[id]/page.tsx:231`
  - `frontend/components/ServiceDashboard.tsx:255`, `:268`
  - `frontend/app/solutions/page.tsx:11`, `:34` (href cứng `/products/11|12` → `/san-pham/<slug>` — đổi tay)
- [ ] `login?next=` (2): `frontend/components/DynamicOrderForm.tsx:126`, `frontend/app/products/[id]/OrderPanel.tsx:51`
- [ ] Seller/admin "Xem trang mua" (3): `frontend/app/seller/(dashboard)/products/page.tsx:95`, `frontend/app/seller/(dashboard)/products/[id]/page.tsx:426`, `frontend/app/admin/products/[id]/page.tsx:186`

### B5. Form seller/admin

- [ ] `frontend/app/seller/(dashboard)/products/new/page.tsx`: field "Đường dẫn (slug)" optional, auto-gợi ý live từ title (slugify js — viết `frontend/lib/slug.ts` cùng luật với backend), cho sửa tay
- [ ] `frontend/app/seller/(dashboard)/products/[id]/page.tsx`: field slug trong form edit (file 1.3k dòng — chỉ chèn field, đừng refactor kèm)
- [ ] `frontend/app/admin/products/[id]/page.tsx`: hiện + cho sửa slug
- [ ] Hiện lỗi 409 slug trùng inline tại field

## Hoãn — Solutions đọc config từ admin (+2–3 ngày, KHÔNG làm đợt này)

Hiện chỉ có 2 solutions hardcode. Muốn admin quản lý = bảng `solutions` mới + CRUD + trang admin + FE render từ API. Chỉ xây khi có >2 giải pháp thật. Đợt 1 chỉ rename route `/giai-phap`.

## QC sau mỗi đợt (click-flow thật, mobile 375px)

- [ ] Hub `/danh-muc` → kệ → `/danh-muc/mang-xa-hoi` → chip con lọc → sản phẩm `/san-pham/<slug>` → breadcrumb quay về đúng danh mục
- [ ] Link CŨ: `/categories/6`, `/products/25`, `/solutions` → 301/canonical về URL mới (test cả khi đã login lẫn guest)
- [ ] `login?next=/san-pham/<slug>` round-trip: logout → bấm mua → login → quay đúng trang sản phẩm
- [ ] Đổi slug trong admin → trang cũ theo slug cũ 404, theo id vẫn sống, link mới chạy
- [ ] Tạo sản phẩm mới không nhập slug → slug tự sinh từ title tiếng Việt có dấu, không trùng
- [ ] `tsc --noEmit` sạch + `pytest tests/test_products.py tests/test_categories.py` xanh
- [ ] Sort/filter/`?category_id=` query param KHÔNG đổi (chỉ đổi path segment, không đụng query API)

## Bẫy đã biết

- URL slug **không dấu** (`mang-xa-hoi`), tuyệt đối không dùng dấu thật trong path (percent-encoding xấu, gõ khó)
- 2 hàm slugify (py + ts) phải **cùng luật** — viết test đối chiếu vài case chung (`"Proxy dân cư tĩnh Việt Nam (share)"` → `proxy-dan-cu-tinh-viet-nam-share`, `"Đăng ký"` → `dang-ky`)
- `service.py` build dict tay (không from_attributes) → thêm field phải thêm ở **cả** list lẫn detail serializer, quên một cái là FE chỗ có chỗ không
- Migration chạy trên dev DB có providers #12/#13 trỏ TopProxy THẬT — migration chỉ thêm cột products, không đụng providers, nhưng đừng tiện tay RESET_CONFIG
- `frontend/.env` đang dirty có chủ đích — **không commit** file này chung với đợt slug
