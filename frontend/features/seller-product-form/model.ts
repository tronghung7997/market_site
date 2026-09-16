import type { Category, ProductDetail, ProductLocale, Variant } from "../../lib/types.ts";
import type { ChecklistItem, SellableEvaluation } from "../seller-workbench/logic.ts";

/** How the buyer receives the goods. `api`/`task` sit behind "advanced" —
 *  they need an approved provider and only Trusted sellers get there. */
export type ReceiveMode = "instant" | "sla" | "api" | "task";
export type FormSection = "basics" | "variants" | "content" | "advanced";
export const FORM_SECTIONS: readonly FormSection[] = ["basics", "variants", "content", "advanced"];

export const SERVICE_TYPES = ["account", "proxy", "token", "endpoint", "cloud", "payment", "takedown", "other"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/** Buyer-protection (escrow) presets in days; the current value is kept even
 *  when it is not one of these. */
export const PROTECTION_PRESETS = [1, 3, 7, 14, 30, 60, 90] as const;

export function protectionOptions(current: number): number[] {
  const set = new Set<number>(PROTECTION_PRESETS);
  if (current > 0) set.add(current);
  return [...set].sort((a, b) => a - b);
}

export function receiveModeFor(mode: ReceiveMode): { archetype: "A" | "B"; deliveryMode: "instant" | "manual"; workModel: "B2" | "B3" } {
  return {
    archetype: mode === "api" || mode === "task" ? "B" : "A",
    deliveryMode: mode === "sla" ? "manual" : "instant",
    workModel: mode === "task" ? "B3" : "B2",
  };
}

/* ---------- categories ---------- */

export interface CategoryOption {
  id: number;
  name: string;
  /** "Parent › Child" — what the select shows so siblings stay distinguishable. */
  label: string;
  depth: number;
}

export function categoryOptions(categories: Category[]): CategoryOption[] {
  const out: CategoryOption[] = [];
  const walk = (items: Category[], trail: string[]) => {
    for (const category of items) {
      const path = [...trail, category.name];
      out.push({ id: category.id, name: category.name, label: path.join(" › "), depth: trail.length });
      walk(category.children ?? [], path);
    }
  };
  walk(categories, []);
  return out;
}

export function categoryLabel(options: CategoryOption[], id: number): string {
  return options.find((option) => option.id === id)?.label ?? "";
}

/* ---------- markdown toolbar ---------- */

export type MarkdownAction =
  | "bold" | "italic" | "h2" | "h3" | "ul" | "ol" | "quote" | "link" | "code" | "codeblock" | "table" | "hr";

export interface TextSelection { value: string; start: number; end: number }

function wrap(sel: TextSelection, before: string, after: string, placeholder: string): TextSelection {
  const selected = sel.value.slice(sel.start, sel.end) || placeholder;
  const value = sel.value.slice(0, sel.start) + before + selected + after + sel.value.slice(sel.end);
  return { value, start: sel.start + before.length, end: sel.start + before.length + selected.length };
}

function prefixLines(sel: TextSelection, prefix: (index: number) => string): TextSelection {
  const lineStart = sel.value.lastIndexOf("\n", sel.start - 1) + 1;
  const lineEndIdx = sel.value.indexOf("\n", sel.end);
  const lineEnd = lineEndIdx === -1 ? sel.value.length : lineEndIdx;
  const block = sel.value.slice(lineStart, lineEnd);
  const next = block.split("\n").map((line, index) => prefix(index) + line).join("\n");
  const value = sel.value.slice(0, lineStart) + next + sel.value.slice(lineEnd);
  return { value, start: lineStart, end: lineStart + next.length };
}

function insertBlock(sel: TextSelection, block: string): TextSelection {
  const before = sel.value.slice(0, sel.start);
  const after = sel.value.slice(sel.end);
  const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after.length === 0 || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = lead + block + tail;
  const value = before + inserted + after;
  return { value, start: before.length + lead.length, end: before.length + lead.length + block.length };
}

export const TABLE_SNIPPET: Record<ProductLocale, string> = {
  vi: "| Cột 1 | Cột 2 | Cột 3 |\n| --- | --- | --- |\n| Giá trị | Giá trị | Giá trị |\n| Giá trị | Giá trị | Giá trị |",
  en: "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Value | Value | Value |\n| Value | Value | Value |",
};

export function applyMarkdownAction(sel: TextSelection, action: MarkdownAction, locale: ProductLocale): TextSelection {
  const vi = locale === "vi";
  switch (action) {
    case "bold": return wrap(sel, "**", "**", vi ? "chữ đậm" : "bold text");
    case "italic": return wrap(sel, "_", "_", vi ? "chữ nghiêng" : "italic text");
    case "code": return wrap(sel, "`", "`", "code");
    case "link": return wrap(sel, "[", "](https://)", vi ? "tên liên kết" : "link text");
    case "h2": return prefixLines(sel, () => "## ");
    case "h3": return prefixLines(sel, () => "### ");
    case "ul": return prefixLines(sel, () => "- ");
    case "ol": return prefixLines(sel, (index) => `${index + 1}. `);
    case "quote": return prefixLines(sel, () => "> ");
    case "codeblock": {
      const selected = sel.value.slice(sel.start, sel.end) || (vi ? "dán code hoặc ví dụ ở đây" : "paste code or an example here");
      return insertBlock(sel, "```\n" + selected + "\n```");
    }
    case "table": return insertBlock(sel, TABLE_SNIPPET[locale]);
    case "hr": return insertBlock(sel, "---");
  }
}

/* ---------- description templates ---------- */

export interface DescriptionTemplate { key: "api" | "account" | "service"; body: string }

export const DESCRIPTION_TEMPLATES: Record<ProductLocale, DescriptionTemplate[]> = {
  vi: [
    {
      key: "account",
      body: `## Bạn nhận được gì
- Tài khoản định dạng \`user|pass|2fa\`
- Giao tự động ngay sau khi thanh toán

## Lưu ý trước khi dùng
1. Đổi mật khẩu ngay sau khi nhận.
2. Không đăng nhập nhiều thiết bị cùng lúc trong 24 giờ đầu.

## Bảo hành
Hỗ trợ đổi tài khoản lỗi đăng nhập trong thời gian bảo vệ người mua.`,
    },
    {
      key: "api",
      body: `## Giới thiệu
Mô tả ngắn dịch vụ API của bạn và ai nên dùng.

## Quy trình mua
1. Thanh toán và nhận API key ngay.
2. Gọi endpoint với header \`Authorization: Bearer <key>\`.
3. Mỗi lượt gọi trừ 1 credit trong gói.

## Endpoint
| Endpoint | Phương thức | Mô tả |
| --- | --- | --- |
| \`/v1/lookup\` | GET | Tra cứu theo id |
| \`/v1/check\` | POST | Kiểm tra trạng thái |

## Ví dụ
\`\`\`
curl -H "Authorization: Bearer <key>" https://api.example.com/v1/lookup?id=123
\`\`\`

## Lưu ý
- Giới hạn 60 lượt/phút.
- Credit không hoàn lại sau khi đã dùng.`,
    },
    {
      key: "service",
      body: `## Dịch vụ gồm những gì
Mô tả rõ phạm vi công việc bạn sẽ làm.

## Bạn cần cung cấp
- Thông tin 1
- Thông tin 2

## Thời gian bàn giao
Hoàn thành trong vòng 24 giờ kể từ khi nhận đủ thông tin.

## Không bao gồm
- Các trường hợp không hỗ trợ`,
    },
  ],
  en: [
    {
      key: "account",
      body: `## What you get
- Account in \`user|pass|2fa\` format
- Delivered automatically right after payment

## Before you start
1. Change the password as soon as you receive it.
2. Avoid logging in from several devices during the first 24 hours.

## Warranty
Login failures are replaced within the buyer-protection window.`,
    },
    {
      key: "api",
      body: `## Overview
A short description of your API and who it is for.

## How it works
1. Pay and receive your API key instantly.
2. Call the endpoints with \`Authorization: Bearer <key>\`.
3. Each request consumes one credit from your package.

## Endpoints
| Endpoint | Method | Description |
| --- | --- | --- |
| \`/v1/lookup\` | GET | Look up by id |
| \`/v1/check\` | POST | Check status |

## Example
\`\`\`
curl -H "Authorization: Bearer <key>" https://api.example.com/v1/lookup?id=123
\`\`\`

## Notes
- Rate limit: 60 requests per minute.
- Used credits are non-refundable.`,
    },
    {
      key: "service",
      body: `## What is included
Describe exactly what you will do.

## What we need from you
- Item 1
- Item 2

## Turnaround
Completed within 24 hours after all details are received.

## Not included
- Cases that are out of scope`,
    },
  ],
};

/* ---------- readiness ---------- */

export interface ChecklistJump { section: FormSection; field?: string }

/** Where a failing check should send the seller. `titleMissing` decides
 *  whether the "info" check points at the name (section 1) or the
 *  description (section 3). */
export function checklistJump(item: ChecklistItem, titleMissing: boolean): ChecklistJump {
  switch (item.key) {
    case "info": return titleMissing ? { section: "basics", field: "product-title" } : { section: "content", field: "product-description" };
    case "translations": return { section: "advanced", field: "product-languages" };
    case "variant":
    case "stock_sla":
    case "pricing":
    case "backend": return { section: "variants" };
    case "escrow": return { section: "basics", field: "product-protection" };
    default: return { section: "basics" };
  }
}

export function missingCount(evaluation: SellableEvaluation): number {
  return evaluation.totalCount - evaluation.passCount;
}

/* ---------- preview product ---------- */

export interface PreviewProductInput {
  id: number;
  title: string;
  categoryId: number;
  categoryName: string;
  serviceType: string;
  coverId: string | null;
  escrowDays: number;
  highlightText: string;
  description: string;
  features: string[];
  specs: Record<string, string>;
  warrantyText: string;
  variants: Variant[];
  status: string;
  pricingStrategy?: string | null;
  sellerName?: string | null;
  soldCount?: number;
  ratingAvg?: number | null;
  ratingCount?: number;
  locale: ProductLocale;
}

/** Storefront sections take a `ProductDetail`; build one from unsaved form
 *  state so the preview renders through the very same components buyers see. */
export function buildPreviewProduct(input: PreviewProductInput): ProductDetail {
  const cleanSpecs = Object.fromEntries(Object.entries(input.specs).filter(([key, value]) => key.trim() && value.trim()));
  return {
    id: input.id,
    // Preview only — no public key yet, so links fall back to the id.
    slug: "",
    public_key: "",
    seller_id: 0,
    category_id: input.categoryId,
    category_name: input.categoryName || null,
    title: input.title.trim(),
    images: null,
    cover_id: input.coverId,
    escrow_days: input.escrowDays,
    status: input.status,
    service_type: input.serviceType,
    highlight_text: input.highlightText.trim() || null,
    sold_count: input.soldCount ?? 0,
    rating_avg: input.ratingAvg ?? null,
    rating_count: input.ratingCount ?? 0,
    pricing_strategy: input.pricingStrategy ?? "fixed",
    pricing_params: null,
    locale: input.locale,
    available_locales: [input.locale],
    created_at: new Date().toISOString(),
    description: input.description.trim() || null,
    features: input.features.filter((line) => line.trim()),
    specs: Object.keys(cleanSpecs).length ? cleanSpecs : null,
    warranty_text: input.warrantyText.trim() || null,
    variants: input.variants,
    seller_name: input.sellerName ?? null,
    primary_locale: input.locale,
  };
}

/* ---------- variants ---------- */

export function moveVariant<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Sort orders after a reorder — only entries whose position changed need a
 *  PATCH. */
export function sortOrderPatches(ids: number[], current: Record<number, number>): { id: number; sort_order: number }[] {
  return ids
    .map((id, index) => ({ id, sort_order: index }))
    .filter(({ id, sort_order }) => current[id] !== sort_order);
}

/** Snapshot of everything the explicit "Save" button persists — the header
 *  compares snapshots to show "unsaved changes". */
export function formSnapshot(state: unknown): string {
  return JSON.stringify(state);
}
