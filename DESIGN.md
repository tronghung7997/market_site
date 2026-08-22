# Proxora Design System

> **Status:** locked target · migration in progress
> **Scope:** public marketplace, buyer, seller, and admin web surfaces
> **Executable token source:** [`frontend/app/globals.css`](frontend/app/globals.css)
> **Current primitive entry point:** [`frontend/components/ui.tsx`](frontend/components/ui.tsx)
> **Rule:** new and touched UI must comply; legacy UI is not precedent.

This file is the durable visual and interaction contract for Proxora. It is intentionally more conservative than a page-generation skill: skills may improve composition, but they may not invent a second design system.

---

## 1. Authority

Resolve visual decisions in this order:

1. Explicit user requirement for the current task.
2. This `DESIGN.md` contract.
3. Canonical tokens, primitives, and shared patterns.
4. The task's surrounding implementation.
5. External design-skill heuristics.

If a task intentionally changes a system-level rule, update this file and the canonical implementation in the same change. A page-local override is not a design-system change.

### Agent preflight

Before visual implementation, state one line internally or in the work report:

```text
Surface: PUBLIC | BUYER | SELLER | ADMIN · density: 1–10 · design lead: <skill or none> · reused primitives: <list>
```

Then inspect the affected page, its nearest equivalent on another role surface, and the canonical primitives before writing code.

---

## 2. Product character

Proxora is a trust-first marketplace for digital goods and provider-backed services.

- **Clear before decorative.** Status, price, ownership, next action, and risk must be understood first.
- **Premium through restraint.** Typography, rhythm, alignment, and material quality carry the brand; gradients and effects do not.
- **Operational without feeling hostile.** Dense tools remain calm, legible, and predictable.
- **Commerce needs evidence.** Product, seller, payment, escrow, and delivery context stay close to the relevant action.
- **One product, multiple densities.** Buyer, seller, and admin differ in information density, not in brand identity.

### Naming note

The repository/product is called **Proxora**, while the current UI wordmark is **Marketplace**. This naming decision is unresolved. Preserve the surrounding surface's current product name; do not introduce a third name or perform a global rename without an explicit brand decision.

---

## 3. Visual signature

### Locked foundation

- Cool off-white application canvas.
- Crisp white surfaces with quiet hairlines.
- Refined indigo (`iris`) as the single brand action accent.
- Ink-like near-black for trust and hierarchy.
- Green, amber, and red appear only as semantic state colours.
- Editorial display type paired with highly readable Vietnamese-capable UI type.
- Sparse, functional motion.

### Surface-specific expression

| Surface | Expression | Density | Allowed signature |
|---|---|---:|---|
| Public marketing | Editorial commerce | 4 | Split composition, one restrained aura/texture, one memorable type moment |
| Buyer product UI | Trust-first commerce | 5 | Product context, price, escrow, delivery and next action are visually dominant |
| Seller workbench | Operational workspace | 7 | Compact actions, inventory/order state, clear throughput and exceptions |
| Admin console | Control room | 8 | Dense data, strong scanning, flat surfaces, restrained dark navigation shell |

A role may change shell, information order, and density. It may not change the core palette, font roles, control language, status semantics, or shape system.

---

## 4. Token architecture

The implementation follows three conceptual layers:

```text
Primitive values (raw colour/size values; globals only)
    ↓
Semantic tokens (`base`, `surface`, `fg`, `iris`, `good`, …)
    ↓
Component variants (`Button.primary`, `Tag.warn`, `DataDialog`, …)
```

Page components consume semantic utilities or canonical component variants. They do not consume raw colour values.

### Semantic colour contract

| Role | Canonical token/utilities | Usage |
|---|---|---|
| App canvas | `base` | Main background |
| Primary surface | `surface`, `panel`, `card` | Navigation, dialogs, cards, tables |
| Subtle surface | `raised` | Secondary controls, hover and grouped content |
| Dark contrast surface | `ink-panel` | Rare marketing band or scoped control-room chrome |
| Primary text | `fg` | Headings, values, important labels |
| Secondary text | `muted` | Supporting copy that still matters |
| Tertiary text | `faint` | Metadata only; must still pass contrast |
| Border | `line`, `line-2` | Quiet and strong hairlines |
| Brand action | `iris`, `iris-hi`, `iris-soft` | Primary action, focus, selected/informational state |
| Positive | `good`, `good-soft` | Paid, healthy, available, completed |
| Attention | `warn`, `warn-soft` | Pending, review, expiring, degraded |
| Destructive | `bad`, `bad-soft` | Failed, blocked, invalid, destructive action |

Rules:

- Raw hex, `rgb()`, `hsl()`, `oklch()`, and Tailwind palettes such as `slate-*`, `indigo-*`, `emerald-*`, `amber-*`, or `red-*` are forbidden in page/component TSX.
- Raw values belong in `frontend/app/globals.css` only.
- Exceptions: external-provider brand marks and chart series may use centralized, documented values inside one shared component/configuration; never inline them per page.
- The dark admin sidebar is a scoped token set in `globals.css`, not permission to create page-specific dark themes.
- Do not generate a parallel `tokens.css`; this Tailwind v4 project already uses `globals.css @theme` as the executable source.

---

## 5. Typography

| Role | Family | Use |
|---|---|---|
| Display | Newsreader | Wordmark, marketing H1/H2, major app page titles |
| UI/body | Be Vietnam Pro | Navigation, controls, forms, tables, descriptions |
| Data | JetBrains Mono | Money, IDs, timestamps, rates, compact metrics |

### Type rules

- Wordmark and app page headings use Newsreader semibold, roman.
- Product/admin/seller headings are never italic.
- **Marketing-only exception:** one phrase or line in a marketing H1 may use Newsreader italic from the same family. It must be intentional, remain readable on mobile, and never become a reusable app-heading pattern.
- Body and control text use Be Vietnam Pro; do not introduce another sans family.
- Mono is for structured data, not ordinary paragraphs or every uppercase label.
- Use tabular numerals for aligned money, quantities, and timestamps.
- Sentence case is the default. Uppercase tracking is reserved for compact table/group metadata and used sparingly.

### Working scale

| Role | Target range |
|---|---|
| Marketing display | `36–64px`, responsive, 1.0–1.1 line height |
| App page H1 | `24–32px` |
| Section H2 | `18–24px` |
| UI body | `14px` default |
| Supporting UI | `12–13px` |
| Micro metadata | `11px` minimum; never primary information |

Long Vietnamese or English labels must wrap naturally in content. Clickable labels and table actions remain on one line.

---

## 6. Spacing, layout, and density

Use a 4px base rhythm:

```text
4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96
```

Avoid arbitrary gaps unless a measured composition requires one and the value is promoted into the system.

### Containers and gutters

| Context | Contract |
|---|---|
| Mobile page gutter | `16px` minimum |
| Desktop app gutter | `24px` default |
| Public/buyer/seller content | `1200px` maximum by default |
| Reading/form measure | `640–760px` |
| Admin canvas | Fluid; data surfaces may use full available width |
| Marketing prose | `45–70ch` |

### Page anatomy

```text
Page shell
└─ Page header
   ├─ Title + concise context
   └─ Primary/secondary actions
└─ Optional toolbar
   ├─ Search
   ├─ Filters
   └─ View/bulk controls
└─ Primary data/content surface
└─ Loading | empty | error | permission state
```

Do not create a unique container width, header rhythm, or toolbar composition for every route.

---

## 7. Shape and elevation

| Element | Radius contract |
|---|---|
| Inputs, buttons, icon controls | `8px` |
| Cards, tables, dialogs, panels | `12px` (`radius-card`) |
| Tags and compact status badges | `6px` |
| Avatar, presence, binary status indicator | Full circle/pill only when semantics require it |

- Use `shadow-card` for ordinary elevation and `shadow-card-lg` for dialogs/floating surfaces.
- Borders and spacing are preferred over shadows in dense admin/seller surfaces.
- Do not nest cards merely to group content. A nested surface needs a real elevation or interaction boundary.
- Do not mix sharp, soft, and pill controls on the same toolbar without a component rule.

---

## 8. Icons and imagery

- The canonical icon family/API is [`frontend/components/Icons.tsx`](frontend/components/Icons.tsx), with `currentColor` and a `1.75` stroke baseline.
- Add missing interface icons to that wrapper rather than importing a second icon family in a feature page.
- Provider/brand marks may use purpose-built marks in a centralized component.
- Emoji are not interface icons.
- Decorative SVG/CSS art is allowed on public marketing surfaces only when it supports the product narrative and is hidden or labelled accessibly.
- Buyer, seller, and admin workbenches prefer semantic icons over decorative illustration.

---

## 9. Canonical component policy

### Current migration boundary

The codebase currently has overlapping primitive systems:

- `frontend/components/ui.tsx`: token-based primitives and the current preferred import `@/components/ui`.
- `frontend/components/ui/*`: a newer split directory, but several files still hard-code Slate/Indigo/White values.

Until consolidation is complete:

- Prefer `@/components/ui` for Button, Card, Tag, Field, Input, Textarea, Select, Banner, Pagination, and Spinner.
- Direct imports from `@/components/ui/dialog` and `@/components/ui/tooltip` are allowed for Radix behavior.
- Do not use split-directory Button/Card/Input/Select/Textarea/Badge as visual precedent until they consume semantic Proxora tokens.
- Do not add a third primitive implementation.
- Repeated specialized controls must be promoted into the canonical system rather than copied.

### Button

Variants: `primary`, `secondary`, `ghost`, `danger`.

- One primary action per action group.
- Default target height: `40px`; compact desktop-only controls: `32px`; prominent action: `44px`.
- Adjacent input and button heights align.
- Required states: default, hover, focus-visible, active, disabled, loading.
- Button labels describe the result: “Save changes”, not “Submit”.

### Field and input

- Label above, helper/error below.
- Placeholder is an example, never the only label.
- Error state uses text/icon plus colour and `aria-invalid`.
- Focus does not change border width or layout geometry.
- Mobile controls target at least `44px`; compact `32px` controls are desktop data-tooling exceptions.

### Status and tags

| Tone | Meaning |
|---|---|
| `good` | Successful, healthy, available, paid, completed |
| `warn` | Pending, review needed, degraded, expiring |
| `bad` | Failed, blocked, disputed, expired payment, destructive |
| `iris` | Active processing, informational, selected, assigned |
| `neutral` | Draft, cancelled, inactive, unknown |

Status meaning is global. Do not remap green/amber/red by role. Labels and icons must carry meaning without colour. Admin mappings currently live in `frontend/components/admin/status-config.ts` and should converge with shared domain status helpers over time.

### Cards and data surfaces

- A card represents one coherent object, decision, or elevated region.
- A table/list surface represents a collection; do not render every table row as a floating card on desktop.
- Interactive cards show hover, focus, and click affordance; static cards do not float on hover.

### Dialogs

| Size | Use |
|---|---|
| Small (`~384px`) | Confirmation |
| Medium (`~512px`) | Standard form/details |
| Large (`640–768px`) | Complex form or comparison |
| Data dialog (`≤1220px`, `≤90dvh`) | Contextual inspection with summary, toolbar, and data rows |

A frequent, primary workflow belongs on a route, not inside a modal. Data dialogs require a sticky header/toolbar where useful, an obvious `40×40px` close target, focus trap, Escape support, and a mobile full-screen/collapsed composition.

---

## 10. Data-heavy interface contract

The supplied admin deposit-ledger direction is approved as an **admin density reference**, with these required corrections:

- Use one segmented summary surface instead of four decorative metric cards.
- On desktop, use a single column header and aligned rows; do not repeat `PROVIDER`, `STATUS`, and `RESULT` labels inside every row.
- On mobile, rows may collapse into labelled stacked records.
- Text columns align left; numeric columns align right with tabular numerals; status aligns consistently; actions sit at the trailing edge.
- Rows that open details need hover, focus-visible, and a clear action/chevron. Static rows must not pretend to be clickable.
- “No transaction” and similar business information must remain readable; tertiary styling cannot reduce it below accessible contrast.
- Summary copy states its scope: “current filter” or “25 displayed records”, not an ambiguous “page summary”.

### Desktop data anatomy

```text
Dialog/page header                                  Close/action
Summary: bank · crypto · credited · needs attention
Provider filters                         Search · page controls
─────────────────────────────────────────────────────────────
Order/account | Provider | Received | Status | Result | Action
Row
Row
```

---

## 11. Required UX states

Every data-bearing view supports the states relevant to it:

- Loading: skeleton/layout-shaped placeholder; avoid a spinner as the only full-page structure.
- Empty: explain what is empty and provide the next valid action.
- Error: identify what failed and how to retry or recover.
- Permission denied: do not masquerade as an empty list.
- Partial/stale data: preserve existing data and show refresh/retry context.
- Disabled/loading action: prevent duplicate mutation and announce progress.
- Success: prefer visible state change; use a toast only when success is otherwise invisible.

Do not ship a success-only static composition.

---

## 12. Motion

- Motion communicates hierarchy, feedback, or state transition; it is not ambient decoration in product UI.
- Default UI duration: `150–220ms`; larger dialog/page transitions may reach `300ms`.
- Animate `transform` and `opacity`, not layout dimensions or position properties.
- Focus rings appear instantly.
- Respect `prefers-reduced-motion`; spatial transitions degrade to instant state or a short opacity change.
- Admin tables and large result lists do not use staggered entrance animation.
- Public marketing may use one motivated reveal system; do not scatter unrelated effects.

---

## 13. Accessibility and responsive behavior

- WCAG AA: body text `4.5:1`; large text, icons, controls, and focus indicators `3:1` minimum.
- Tertiary text is metadata only and still meets contrast.
- Keyboard order follows visual order.
- Every interactive element has visible `focus-visible`, semantic name, and disabled/loading behavior where relevant.
- Do not rely on colour alone for status.
- No horizontal page scroll from `320px` to desktop; intentionally scrollable tab/table regions are labelled and contained.
- Clickable labels do not wrap into accidental two-line controls.
- Multi-column layouts declare an explicit mobile collapse.
- Dialogs remain usable at `320`, `390`, and `768px` widths.
- Dense desktop tables become cards, disclosure rows, or controlled horizontal regions on mobile; they do not simply shrink text.

---

## 14. Copy, locale, and content integrity

- Write from the user's side of the screen with plain, action-led language.
- Keep one action name through button, progress, success, and audit copy.
- Do not invent metrics, testimonials, inventory, uptime, guarantees, or provider claims.
- Financial copy names whether a value is ledger amount, display conversion, pending, held, credited, or refunded.
- Shared visible copy belongs in both `messages/en.json` and `messages/vi.json` and must pass `npm run check:i18n`.
- Admin may remain Vietnamese where intentionally required, but shared primitives must not hard-code a locale-specific label.
- Avoid decorative microcopy, fake version strings, and vague “something went wrong” messages.

---

## 15. Design-skill routing

Use at most **one implementation lead** and **one audit skill** per task.

| Task scope | Implementation lead | Audit |
|---|---|---|
| Visual bug preserving an existing pattern | None; use this contract and canonical primitives | Browser/runtime check |
| Buyer/seller/admin workflow or component | `frontend-design`, constrained by this file | Hallmark audit where useful |
| Public homepage/landing/solution | `design-taste-frontend`, constrained by this file | Hallmark audit |
| Existing product-surface redesign | Hallmark audit first, then `frontend-design` | Hallmark audit again |
| Existing marketing redesign | Hallmark audit first, then `design-taste-frontend` | Hallmark audit again |
| URL/screenshot reference | `hallmark study`; wait for DNA approval | Scope-specific runtime audit |

If the selected skill is unavailable, follow this contract directly; do not substitute a marketing skill for product UI or install a dependency without approval.

Overrides for external skills:

- Do not rotate palette, font stack, radius, icon family, or theme per page.
- Do not emit per-page `tokens.css`, DTCG exports, or Hallmark themes; this is already a system-managed project.
- `design-taste-frontend` is not used for admin dashboards, data tables, or multi-step product workflows.
- Hallmark diversification is inverted: pages share this system. Variety comes from information structure, not a new visual identity.

---

## 16. Forbidden patterns

- New page-local palette, font, radius scale, or shadow language.
- Raw colour values or framework palette classes in TSX.
- A third Button/Card/Input/Dialog implementation.
- Different status-colour meaning across buyer, seller, and admin.
- Decorative dashboard gradients, glow, fake browser chrome, or fake product screenshots.
- Cards inside cards without a real hierarchy boundary.
- Desktop data rows repeating mobile field labels.
- Tiny low-contrast business information.
- Multiple equal metric cards when one segmented summary communicates the set better.
- Full application workflows hidden in a modal without an explicit contextual reason.
- Raw `<button>`/`<input>` copied repeatedly instead of a shared primitive.
- UI that implements only loading or only successful data.
- Treating nearby legacy code as permission to increase known design debt.

---

## 17. Verification contract

### Golden routes

System-level UI changes must sample the relevant routes from this matrix:

| Surface | Golden routes |
|---|---|
| Public | `/en`, `/vi`, `/en/categories`, `/en/solutions` |
| Buyer | `/en/orders`, `/en/wallet`, `/en/transactions`, `/en/messages` |
| Seller | `/en/seller`, `/en/seller/orders`, `/en/seller/products` |
| Admin | `/en/admin`, `/en/admin/orders`, `/en/admin/deposits` |

### Viewports

- `1280×800`: small laptop/fold check.
- `1440×900`: primary desktop.
- `390×844`: primary mobile.
- `320px` width: minimum overflow/dialog check for changed shared components.

### Runtime acceptance

For affected routes, verify:

- visual hierarchy, spacing, alignment, radius, and semantic colours;
- loading, empty, error, permission, and mutation states where applicable;
- keyboard focus and dialog behavior;
- console errors/warnings;
- request/response status and payload in the network panel;
- no unintended horizontal overflow;
- English/Vietnamese layout and message parity.

Run the repository frontend gate after visual verification:

```bash
./scripts/verify-frontend.sh
```

A screenshot alone cannot prove token use, accessibility, runtime states, or cross-role consistency.

---

## 18. Migration ledger

Known debt exists and is not a reason to stop feature work. New work must not increase it; touched code should reduce it when safely in scope.

| Debt | Target |
|---|---|
| `components/ui.tsx` overlaps `components/ui/*` | One token-based `@/components/ui` barrel with split implementation files |
| Split primitives hard-code Slate/Indigo/White | Replace with semantic Proxora tokens |
| Admin components contain role-local palette values | Use global semantic status/surface tokens |
| Many feature files render raw controls | Promote repeated controls into canonical primitives |
| Page widths/radii vary locally | Adopt the container and shape contracts above |
| Desktop tables sometimes use repeated row labels | Desktop column header; labelled stacked rows only on mobile |
| No automated design-token lint | Add a baseline-aware design-system check after primitive consolidation |

Do not perform a repository-wide visual migration as collateral work in an unrelated feature. Prefer small, reviewable migrations with representative browser verification.

---

## 19. Change control

Amend this file when changing a global design decision. Every amendment should include:

1. The reason and affected surfaces.
2. The canonical token/component change.
3. Migration impact on existing UI.
4. Browser evidence from representative routes.
5. Any deliberate exception and its boundary.

If an exception repeats twice, it is a missing system variant and must be promoted or removed.
