# Checklist refactor frontend phía buyer — 2026-07-29

Mục tiêu: code buyer-side đọc được cho cả người và AI — mỗi file một câu chuyện,
luật nghiệp vụ có tên gọi, hằng số một nguồn — **không đổi hành vi** trừ các mục
đánh dấu ⚠️ (đổi có chủ đích, ghi rõ trong commit).

Nhánh làm việc: `refactor/buyer-frontend`. Mỗi mục = 1 commit nhỏ, chạy được.
Sau mỗi đợt: `npx tsc --noEmit` + mở trang bấm thử các trạng thái chính.

## Nguyên tắc

- **Move-only mặc định**: JSX/logic di chuyển nguyên văn; diff hành vi = 0.
- **Deep module, không micro-split**: mỗi file giấu trọn một mảng việc sau
  interface nhỏ (props / return của hook). Không tách vỏ chuyển-tiếp-props.
- Seam đặt theo trục "thay đổi cùng nhau": data-fetch · luật mua · UI phiếu đặt ·
  hậu-mua · nội dung hiển thị.
- Giữ nguyên toàn bộ comment "vì sao" — di chuyển theo code của nó.
- Không thêm dependency mới. Không Context/Redux. Không barrel `index.ts`.

## Đợt 0 — Nền móng dùng chung

- [ ] `lib/utils/format.ts` là nguồn duy nhất của `vnd()` — `lib/api.ts` re-export
      để 22 file import cũ không phải sửa ngay (xoá bản định nghĩa trùng).
- [ ] ⚠️ Hợp nhất `cn()`: chuẩn hoá về bản clsx+twMerge (`lib/utils/cn.ts`),
      `lib/cn.ts` re-export. twMerge khác bản nối-chuỗi khi có class xung đột —
      soát mắt các trang chính sau khi đổi.
- [ ] ⚠️ Tạo `lib/order-status.ts` — MỘT map trạng thái đơn (label + tone + hint),
      từ vựng lấy theo `app/orders/page.tsx` (bản đầy đủ nhất). Thay cho các bản
      chép ở: orders, products/[id] (OrderResult), home (RECENT_ORDER_STATUS).
      Chữ hiển thị đổi nhẹ ở product page ("Đang xử lý" → "Chờ xử lý"…) — chấp nhận.
- [ ] `lib/hooks/useDebounce.ts` — một bản, thay 7 bản chép (6 admin + orders).
- [ ] Chuyển `components/admin/pagination.tsx` → `components/ui/pagination.tsx`
      (admin import đường mới); orders sẽ dùng ở Đợt 2.
- [ ] `components/ui.tsx` bổ sung: `Monogram` (14 chỗ đang tự chế
      `title.slice(0,2).toUpperCase()`), `CopyButton` (2 bản chép).
- [ ] `lib/categories.ts` — `flattenCategories()` + `subtreeIds()` (đang chép ×3:
      home, categories, sellers/[id]).
- [ ] Xoá `lib/query-keys.ts` (không ai import).

## Đợt 1 — `app/products/[id]` (plan chi tiết đã chốt)

Cấu trúc đích — colocate trong thư mục route:

- [ ] `OrderResult.tsx` — thế giới hậu-mua: `useOrderPolling`, `useElapsed`,
      `ProvisionSteps`, status map (→ dùng `lib/order-status`).
- [ ] `purchase.ts` — luật mua dạng hàm thuần: `purchasable()`,
      `pickDefaultVariant()`, `clampQty()`, `panelMode()`, `ctaState()`.
- [ ] `useProductDetail.ts` — fetch product + pricing strategy + related.
- [ ] `usePurchase.ts` — state machine: selected/qty/order/placing/placeError.
- [ ] `sections.tsx` — ProductIdentity, SpecsPlate, DescriptionCard,
      WarrantyCard, RelatedProducts, SectionHead (thuần hiển thị).
- [ ] `ReviewsCard.tsx` — tự fetch review theo productId.
- [ ] `OrderPanel.tsx` — phiếu đặt hàng + modal xác nhận; `MobileBuyBar.tsx`.
- [ ] `page.tsx` còn ~140 dòng — đọc như mục lục trang.
- [ ] Doc-comment 1 đoạn đầu mỗi file: làm gì, interface, invariant.

## Đợt 2 — `app/orders` (1.075 dòng → ~5 file)

- [ ] Tách `OrderCard.tsx` (khối render ~120 dòng, 8 nhánh tính năng) +
      `ReviewForm.tsx` (state form rời khỏi cấp page).
- [ ] Tách `OrderProxyPanel.tsx` (+ `ProxyWhitelistBox`) — giữ nguyên ruột.
- [ ] Tách `OrderFilters.tsx` (search/date/sort/tab) + dùng `useDebounce` chung.
- [ ] `DisputeModal` dùng `components/ui/dialog` (radix có sẵn) thay modal tay.
- [ ] Pagination inline (dòng ~1032) → `components/ui/pagination`.
- [ ] Status maps → `lib/order-status`.

## Đợt 3 — `app/wallet`

- [ ] ⚠️ Bỏ toàn bộ 8 `alert()` → lỗi/validation inline tại field (pattern
      `depositErr` đã có sẵn trong chính file này).
- [ ] Tách `DepositCard.tsx` / `WithdrawCard.tsx` (khối seller) /
      `TransactionList.tsx`; giữ `describeTransaction()` + `Promise.allSettled`.
- [ ] Gộp 2 formatter đếm ngược ("còn X phút") wallet + orders → `lib/time.ts`.

## Đợt 4 — `app/page.tsx` (home)

- [ ] ⚠️ Fix N+1 (hiện `api.products()` rồi `api.product(id)` cho TỪNG sản phẩm):
      bước tạm FE-only — chỉ fetch detail cho sản phẩm hiển thị (priceboard +
      featured); bước đúng — backend thêm `min_price`/`stock` vào list response
      (marketplace-svc, đề xuất riêng).
- [ ] Một `ProductTile` dùng chung (hiện 4 bản: bảng, lưới, featured, related).
- [ ] Tách section: Hero/PriceBoard, Market, Featured, Sellers, RecentOrders,
      HowItWorks/WhyUs, Faq.
- [ ] ⚠️ Quyết định nội dung bịa: 3 testimonial hardcode + badge "4.9/5 từ
      1.200+ doanh nghiệp" — gỡ hoặc thay số thật (chờ chủ sản phẩm chốt).

## Đợt 5 — Chiến lược (bàn riêng, chưa làm)

- [ ] react-query cho buyer (số dư/đơn tự invalidate sau khi mua; admin đã dùng).
- [ ] Server components / SSR cho SEO (đụng cách auth — việc riêng, cần thiết kế).

## Ghi chú phát hiện (bằng chứng chính)

- 2 hệ data: react-query chỉ admin dùng; buyer tự chế useEffect (17 effect/3 trang).
- 2 UI kit: `components/ui.tsx` vs `components/ui/` (radix) — 3 modal tự chế
  trong khi `ui/dialog.tsx` nằm không; wallet trộn cả hai.
- `cn()` ×2 khác semantics; `vnd()` ×2 (may là cùng output).
- Từ vựng trạng thái đơn ≥5 bản, drift thật: pending = "Chờ xử lý"/"Đang xử lý",
  completed = "Hoàn tất"/"Hoàn thành", delivered tone iris/good.
- `useDebounce` ×7 · monogram ×14 · flatten/subtreeIds ×3 · countdown ×2 ·
  CopyButton ×2 · SectionHead ×2 · pagination inline vs component admin.
- `frontend/.env` đang dirty local (flip prod→localhost) — KHÔNG commit.
