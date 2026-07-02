# Proxora — Stitch Prompt Pack (Redesign)

> Bộ prompt để đưa vào Google Stitch, sinh ra design system + layout đồng nhất cho toàn site.
> Đi kèm: bảng design tokens ở cuối file để Claude Code implement đúng một hệ thống duy nhất.

---

## Cách dùng với Stitch

1. **Mỗi prompt = 1 màn hình.** Stitch làm tốt nhất khi mô tả từng screen, không mô tả cả site trong một prompt.
2. **Luôn dán MASTER STYLE BLOCK vào đầu mọi prompt** — đây là thứ giữ cho mọi màn hình đồng nhất.
3. Sinh xong màn hình đầu (Home), các màn sau nói thêm: *"Same design system and header as the previous screen."*
4. Refine bằng câu ngắn, mỗi lần một thay đổi ("Make the product cards more compact", "Increase table density").
5. Prompt viết tiếng Anh (Stitch hiểu tốt nhất), nhưng **mọi text trong UI là tiếng Việt** — đã ghi rõ trong style block.

---

## MASTER STYLE BLOCK — dán vào đầu MỌI prompt

```
DESIGN SYSTEM — "Proxora Trading Desk"

Product: Proxora — a Vietnamese B2B marketplace for digital infrastructure
(proxies, accounts, API tokens, cloud resources) with escrow protection.
Users are tech-savvy businesses and resellers. All UI copy is in VIETNAMESE.

Mood: a calm, precise fintech trading desk. Light, cool, data-dense but quiet.
Trust comes from clarity and order, not decoration. No gradients, no glassmorphism,
no stock illustrations.

Colors (use exactly):
- Page background: #F6F7F9 (cool gray paper)
- Surface/cards: #FFFFFF with 1px border #E4E7EC
- Text: #101828 primary, #667085 secondary
- Brand primary "escrow green": #0E7A5F (buttons, active nav, links, focus)
- Brand dark ink: #0B1B17 (footer, hero text, sidebar background)
- Status: amber #B45309 (pending/held), red #B42318 (dispute/error),
  green #067647 (completed), gray #475467 (neutral)

Typography (Google Fonts, must support Vietnamese diacritics):
- Headings: Sora, semibold, tight tracking
- Body & UI: Inter
- SIGNATURE RULE: every number, price (₫), ID, code, credential and table figure
  uses IBM Plex Mono. Data looks like data.

Shape & spacing: 10px radius cards, 8px radius controls, 1px borders,
almost no shadows (only on dropdowns/modals). Generous whitespace around
dense mono data. 8pt spacing grid.

Signature component: the "escrow pipeline" — a horizontal step indicator
(Chờ xử lý → Đang xử lý → Đã giao → Hoàn tất) with mono labels and a thin
green progress line, used on every order surface.

Layout shells (reuse exactly):
- PUBLIC SHELL: slim top nav (56px): logo left, links "Chợ, Danh mục, Giải pháp",
  right side wallet balance in mono + primary button "Nạp tiền" + avatar. Footer dark ink.
- CONSOLE SHELL (seller & admin): fixed left sidebar 240px on dark ink #0B1B17
  with grouped nav, white content area with page header (title + actions row),
  content max-width 1200px.
```

---

## PROMPTS THEO MÀN HÌNH

### 01 — Trang chủ / Chợ sản phẩm (`/`)

```
[MASTER STYLE BLOCK]

Design the marketplace homepage. PUBLIC SHELL.

Hero (compact, not a template hero): dark ink #0B1B17 band, left side a Sora
headline "Hạ tầng số cho doanh nghiệp. Ký quỹ an toàn, giao ngay." with a short
subline and search input; right side a live-looking "escrow ticket" card in
mono type showing a sample order: product name, price ₫1.250.000, escrow
pipeline component at step "Đã giao". This ticket is the brand signature.

Below: filter row (category pills: Proxy, Tài khoản, Token, Cloud, Thanh toán;
sort dropdown) then a product grid, 4 columns desktop. Each product card:
service-type badge, product name, seller name with rating stars, delivery
badge "Giao ngay" or "Giao thủ công", price in IBM Plex Mono, ₫ currency.
Cards are white, 1px border, no shadow; hover = green border.

End with a thin trust strip: 3 quiet stats in mono (orders delivered, escrow
released, active sellers). Footer dark ink.
```

### 02 — Danh mục (`/categories`)

```
[MASTER STYLE BLOCK] Same header as homepage.

Category browsing page. Page title "Danh mục" in Sora. Grid of category cards
(2×4): each has a small monochrome line icon, category name in Vietnamese
(Proxy, Tài khoản, Token, Endpoint, Takedown, Cloud, Thanh toán, Khác),
product count in mono, one-line description in secondary gray. Clicking-state:
green border. Keep it extremely quiet and orderly — like a directory index.
```

### 03 — Chi tiết sản phẩm (`/products/[id]`)

```
[MASTER STYLE BLOCK] Same header.

Product detail page, two columns (7/5 split).

Left: breadcrumb, product title (Sora), seller row (name, rating, orders sold
in mono), service-type + delivery badges, long description, then a reviews
section (rating summary bar + review list, each review with mono date).

Right, sticky order panel (white card, 1px border): variant selector (radio
cards with name + price in mono), dynamic pricing block — quantity/duration
inputs, a computed total that reads like a receipt in IBM Plex Mono with
subtotal and platform fee lines — and a full-width primary button "Mua ngay
— ký quỹ". Under the button, a small reassurance line with a shield icon:
"Tiền được giữ ký quỹ đến khi bạn xác nhận."

The receipt-style calculator is the hero of this page.
```

### 04 — Đơn hàng của buyer (`/orders`)

```
[MASTER STYLE BLOCK] Same header.

Buyer orders page. Page title "Đơn hàng", filter pills by status (Tất cả,
Chờ xử lý, Đang xử lý, Đã giao, Hoàn tất, Khiếu nại), search input.

Order list = vertical stack of order cards. Each card: order ID in mono
(#ORD-2941), product name + variant, seller, price in mono, and the escrow
pipeline component showing current step. Expanded card state shows delivered
resources as CREDENTIAL ROWS: dark ink background block, IBM Plex Mono,
masked values with copy buttons (host:port, user, pass) — like reading a
terminal. Actions per card: "Xác nhận đã nhận" (primary), "Khiếu nại" (ghost).

Empty state: quiet illustration-free message "Chưa có đơn hàng nào" with a
link to the marketplace.
```

### 05 — Ví (`/wallet`)

```
[MASTER STYLE BLOCK] Same header.

Wallet page, two columns (4/8).

Left column: balance card — dark ink background, "Số dư khả dụng" label,
huge balance in IBM Plex Mono (₫12.450.000), below it escrow-held amount in
amber mono; two buttons "Nạp tiền" (primary) and "Rút tiền" (outline).

Right column: transaction history table, dense, mono figures. Columns:
time, type badge (Nạp tiền, Giữ ký quỹ, Giải ngân, Phí nền tảng, Rút tiền,
Hoàn tiền, Hoa hồng affiliate), description, amount signed +/− in mono,
running balance. Amounts: green for credit, ink for debit. Filter by type,
pagination. The table should feel like a bank statement.
```

### 06 — Affiliate (`/affiliate`)

```
[MASTER STYLE BLOCK] Same header.

Affiliate dashboard. Top: referral link card — the link shown in IBM Plex Mono
inside a copy field with a "Sao chép" button, plus the referral code as a
large mono token.

Below: 4 stat cards (Lượt click, Đăng ký, Đơn thành công, Hoa hồng) — small
gray label, big mono number. Then a line chart of clicks/commissions over
30 days (thin green line, no area fill, mono axis labels) and a commissions
table: date, referred user (masked email), order ID mono, commission amount
mono, status badge.
```

### 07 — Đăng nhập / Đăng ký (`/login`, `/register`)

```
[MASTER STYLE BLOCK]

Auth screen, split layout. Left 45%: dark ink panel with the Proxora logo,
one Sora sentence "Chợ hạ tầng số có ký quỹ." and a subtle mono ticker of
sample order lines scrolling slowly (decorative, low contrast). Right 55%:
centered white form card — email, password, primary button "Đăng nhập",
link "Mở tài khoản". Inputs 8px radius, green focus ring. No social login.
Same layout for register with extra fields.
```

### 08 — Landing Giải pháp (`/solutions`)

```
[MASTER STYLE BLOCK] Same header.

Marketing landing page for business solutions. Hero: light background this
time, oversized Sora headline "Hạ tầng số, mua như đặt lệnh.", subline, two
CTAs. Then 3 solution rows alternating text/visual; each visual is a
mono-styled UI fragment (an escrow ticket, a credential block, a provider
health board) instead of illustrations. One quiet quote band on dark ink.
Final CTA band with "Mở tài khoản" button. Keep it editorial and sparse —
this is the only page allowed bigger type and more whitespace.
```

### 09 — Seller Dashboard (`/seller`)

```
[MASTER STYLE BLOCK]

Seller console. CONSOLE SHELL: dark sidebar with nav groups — "Tổng quan",
"Sản phẩm", "Đơn hàng", "Kho tài nguyên", "Cảnh báo" — active item has a
green left bar. Content: page header "Tổng quan gian hàng" + date range picker.

Row of 4 stat cards (Doanh thu, Đơn mới, Tỉ lệ hoàn tất, Đang ký quỹ) with
mono numbers. Below: two panels side by side — revenue line chart (thin
green line) and "Đơn cần xử lý" list (order ID mono, product, deadline
countdown in amber mono, button "Nhận đơn"). Bottom: low-stock resources
alert table (variant, remaining count in mono, restock button).
```

### 10 — Seller: Quản lý sản phẩm (`/seller/products` + form)

```
[MASTER STYLE BLOCK] CONSOLE SHELL, same sidebar as seller dashboard.

Products management. Header: "Sản phẩm" + primary button "+ Thêm sản phẩm".
Table: status dot (draft gray / active green / paused amber / suspended red),
product name, category, variants count, price range in mono, delivery badge,
row actions. Row click opens a RIGHT SLIDE-OVER PANEL (480px) for editing:
tabs "Thông tin", "Phiên bản & giá", "Kho tài nguyên". In the variants tab,
each variant row: name, price mono input, delivery mode select, stock count
mono. Keep the slide-over — it is the standard edit pattern for all consoles.
```

### 11 — Admin Overview (`/admin`)

```
[MASTER STYLE BLOCK]

Admin console. CONSOLE SHELL: same dark sidebar pattern as seller but with
admin nav groups: "Tổng quan" / VẬN HÀNH: Đơn hàng, Khiếu nại, Sản phẩm,
Danh mục / HẠ TẦNG: Nhà cung cấp, Tài nguyên, Tác vụ / TÀI CHÍNH: Rút tiền,
Affiliate / HỆ THỐNG: Tài khoản, Cảnh báo, Báo cáo, Nhật ký.

Content: "Tổng quan hệ thống". Top: 5 KPI cards with mono numbers and tiny
sparklines (GMV, đơn hôm nay, khiếu nại mở, seller chờ duyệt, quỹ affiliate).
Middle: orders volume chart + system health board — provider list with
status dots, latency in mono ms, uptime %. Bottom: latest alerts feed with
severity badges and dismiss buttons. Dense but disciplined — a control room.
```

### 12 — Admin data-table template (dùng cho Orders, Disputes, Resources, Accounts, Withdrawals…)

```
[MASTER STYLE BLOCK] CONSOLE SHELL, admin sidebar.

Design the reusable admin LIST page template, using "Khiếu nại" (disputes)
as the example. Page header: title + count badge in mono. Toolbar: search
input, filter pills (Đang mở, Đã hoàn tiền, Đã từ chối), date range.

Dense data table: 48px rows, mono for IDs/amounts/dates, status badges,
sortable headers, sticky header, checkbox column, pagination footer showing
"1–20 / 142" in mono. Row click opens the same 480px right slide-over used
in seller console, here showing dispute detail: order summary, buyer reason,
seller response, evidence, and two resolution buttons "Hoàn tiền cho buyer"
(primary) / "Từ chối khiếu nại" (destructive outline) with a confirm dialog.

This exact table + slide-over pattern is the template for ALL admin list pages.
```

---

## Quy tắc đồng nhất layout (tóm tắt cho mọi công cụ)

| Shell | Dùng cho | Cấu trúc |
|---|---|---|
| **Public Shell** | `/`, `/categories`, `/products/*`, `/orders`, `/wallet`, `/affiliate`, `/solutions` | Top nav 56px + content max-w 1200px + footer dark ink |
| **Console Shell** | `/seller/*`, `/admin/*` | Sidebar 240px dark ink + page header (title + actions) + content max-w 1200px |
| **Auth** | `/login`, `/register` | Split 45/55: dark panel + form card |

Pattern chuẩn dùng chung: **escrow pipeline** (mọi bề mặt đơn hàng) · **credential block** (nền ink, mono, nút copy) · **data table 48px + slide-over 480px** (mọi trang list của seller/admin) · **stat card** (label xám nhỏ + số mono lớn) · **status badge** (màu theo bảng status).

---

## Design tokens — để Claude Code implement đồng nhất

> Khi code lại UI, mọi session Claude Code phải tham chiếu bảng này (trỏ từ CLAUDE.md
> sang file này). Không tự chế màu/font/radius mới.

```css
:root {
  /* Màu */
  --bg: #F6F7F9;            /* nền trang */
  --surface: #FFFFFF;        /* card, panel */
  --border: #E4E7EC;
  --fg: #101828;             /* text chính */
  --muted: #667085;          /* text phụ */
  --brand: #0E7A5F;          /* escrow green: button, link, active */
  --brand-hover: #0B6A52;
  --ink: #0B1B17;            /* sidebar, footer, hero, credential block */
  --status-pending: #B45309; /* amber: pending / held */
  --status-danger: #B42318;  /* dispute / error / suspended */
  --status-success: #067647; /* completed / credit */
  --status-neutral: #475467;

  /* Chữ — Google Fonts, hỗ trợ tiếng Việt */
  --font-display: "Sora";        /* heading, weight 600–700 */
  --font-body: "Inter";          /* UI, body */
  --font-mono: "IBM Plex Mono";  /* MỌI số, giá ₫, ID, ngày trong bảng, credential */

  /* Hình khối */
  --radius-card: 10px;
  --radius-control: 8px;
  /* border 1px, không shadow trừ dropdown/modal; spacing theo lưới 8px */
}
```

**Quy tắc bắt buộc khi code:**
1. Mọi giá tiền, số lượng, ID, timestamp trong bảng → `--font-mono`, format VND có dấu chấm ngăn cách.
2. Trạng thái chỉ dùng 4 màu status ở trên, render qua một component `StatusBadge` duy nhất (map từ `status-config`).
3. Seller và Admin dùng CHUNG một Console Shell component (sidebar dark + page header), chỉ khác nav items.
4. Trang list của console luôn là: toolbar (search + filter pills) → table 48px/row → pagination; edit/detail luôn là slide-over 480px, không mở trang mới trừ trang detail phức tạp.
5. Hợp nhất `components/ui/` và `components/admin/` thành một design system duy nhất theo tokens này.
6. Focus ring màu brand, hỗ trợ keyboard; tôn trọng `prefers-reduced-motion`.
```
