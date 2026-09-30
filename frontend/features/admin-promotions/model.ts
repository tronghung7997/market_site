/** Admin promo campaigns: list URL state, state badges, the plain-language
 *  summary an admin reads instead of raw fields, and audit wording. Pure.
 *  Form state/validation lives in ./form.ts. */

import type {
  AdminPromotion, AuditEntityEvent, PromotionAttentionReason, PromotionInput, PromotionListState, PromotionSort, PromotionState,
} from "../../lib/types.ts";
import { formatVn } from "./time.ts";

export type Money = (amountVnd: number) => string;

/** TanStack Query key root of everything promotions (list pages, one campaign, its tabs). */
export const PROMOTIONS_KEY = ["admin", "promotions"] as const;
export const promotionKey = (id: number) => [...PROMOTIONS_KEY, "one", id] as const;

export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

type Tone = "good" | "warn" | "neutral" | "iris" | "bad";

export const STATE_META: Record<PromotionState | "archived", { label: string; tone: Tone }> = {
  running: { label: "Đang chạy", tone: "good" },
  scheduled: { label: "Sắp chạy", tone: "iris" },
  paused: { label: "Tạm dừng", tone: "neutral" },
  exhausted: { label: "Hết lượt / ngân sách", tone: "warn" },
  ended: { label: "Đã kết thúc", tone: "neutral" },
  archived: { label: "Đã lưu trữ", tone: "neutral" },
};

// ── List URL state ─────────────────────────────────────────────────────────

/** Chip key → API `state` param. "all" sends none; "done" is ended + exhausted (server maps it). */
export const LIST_CHIPS = [
  { key: "all", label: "Tất cả" },
  { key: "running", label: "Đang chạy" },
  { key: "scheduled", label: "Sắp chạy" },
  { key: "paused", label: "Tạm dừng" },
  { key: "attention", label: "Cần chú ý" },
  { key: "done", label: "Đã kết thúc" },
  { key: "archived", label: "Lưu trữ" },
] as const;
export type ListChip = (typeof LIST_CHIPS)[number]["key"];

export const SORTS: { key: PromotionSort; label: string }[] = [
  { key: "updated", label: "Mới cập nhật" },
  { key: "uses", label: "Nhiều lượt dùng" },
  { key: "ends_soon", label: "Sắp hết hạn" },
];

export const PER_PAGE = 20;

export interface PromoListFilters {
  q: string;
  chip: ListChip;
  sort: PromotionSort;
  page: number;
}

export const DEFAULT_LIST: PromoListFilters = { q: "", chip: "all", sort: "updated", page: 1 };

const CHIP_KEYS = new Set<string>(LIST_CHIPS.map((c) => c.key));
const SORT_KEYS = new Set<string>(SORTS.map((s) => s.key));

export function parsePromoListUrl(params: URLSearchParams): PromoListFilters {
  const chip = params.get("state") ?? "";
  const sort = params.get("sort") ?? "";
  const page = Number(params.get("page"));
  return {
    q: params.get("q") ?? "",
    chip: CHIP_KEYS.has(chip) ? (chip as ListChip) : "all",
    sort: SORT_KEYS.has(sort) ? (sort as PromotionSort) : "updated",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function promoListSearch(f: PromoListFilters, current: URLSearchParams = new URLSearchParams()): string {
  const next = new URLSearchParams(current.toString());
  const put = (key: string, value: string, fallback: string) => { if (value && value !== fallback) next.set(key, value); else next.delete(key); };
  put("q", f.q.trim(), "");
  put("state", f.chip, "all");
  put("sort", f.sort, "updated");
  put("page", String(f.page), "1");
  return next.toString();
}

/** Query params for GET /admin/promotions. `done` is sent as-is: the backend counts it as ended|exhausted. */
export function promoListQuery(f: PromoListFilters) {
  return {
    q: f.q.trim() || undefined,
    state: f.chip === "all" ? undefined : (f.chip as PromotionListState),
    sort: f.sort,
    page: f.page,
    per_page: PER_PAGE,
  };
}

// ── Row wording ────────────────────────────────────────────────────────────

const DAY = 86_400_000;

export function attentionLabel(reason: PromotionAttentionReason | null, etaDays: number | null): string | null {
  switch (reason) {
    case "budget": return etaDays != null ? `Hết ngân sách ~${Math.max(1, Math.round(etaDays))} ngày` : "Sắp hết ngân sách";
    case "uses": return "Sắp hết lượt";
    case "ending": return "Sắp hết hạn";
    case "expired_active": return "Đã hết hạn nhưng vẫn bật";
    default: return null;
  }
}

/** Small line under the window: "còn 31 ngày" / "bắt đầu sau 58 ngày" / "đã hết hạn". */
export function windowHint(p: Pick<AdminPromotion, "starts_at" | "ends_at" | "is_active">, now: number = Date.now()): string | null {
  const starts = p.starts_at ? Date.parse(p.starts_at) : null;
  const ends = p.ends_at ? Date.parse(p.ends_at) : null;
  const days = (ms: number) => Math.max(1, Math.ceil(ms / DAY));
  if (starts != null && starts > now) return `bắt đầu sau ${days(starts - now)} ngày`;
  if (ends != null && ends <= now) return p.is_active ? "đã hết hạn nhưng vẫn bật" : "đã hết hạn";
  if (ends != null) {
    const left = ends - now;
    return left < DAY ? `còn ${Math.max(1, Math.ceil(left / 3_600_000))} giờ` : `còn ${days(left)} ngày`;
  }
  return starts != null ? "không hết hạn" : null;
}

/** "9,1tr" / "850k" / "1,2 tỷ": compact VND for tight table cells. */
export function compactVnd(n: number): string {
  const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString("vi-VN");
  if (n >= 1_000_000_000) return `${fmt(n / 1_000_000_000)} tỷ`;
  if (n >= 1_000_000) return `${fmt(n / 1_000_000)}tr`;
  if (n >= 1_000) return `${fmt(n / 1_000)}k`;
  return n.toLocaleString("vi-VN");
}

/** Share of a ceiling used, 0–1, or null when there is no ceiling. */
export function usageRatio(used: number, limit: number | null): number | null {
  if (limit == null || limit <= 0) return null;
  return Math.min(1, used / limit);
}

/** Row ⋯ menu entries a campaign allows. Delete only while nobody used it. */
export function rowActions(p: Pick<AdminPromotion, "uses" | "archived_at">) {
  return {
    edit: true,
    duplicate: true,
    copy: true,
    exportCsv: p.uses > 0,
    archive: p.archived_at == null,
    unarchive: p.archived_at != null,
    remove: p.uses === 0,
  };
}

// ── Plain-language summaries ───────────────────────────────────────────────

type OfferFields = Pick<PromotionInput, "discount_type" | "discount_value" | "max_discount_amount">;

/** "Giảm 10%, tối đa 50.000 ₫" / "Giảm 20.000 ₫". */
export function describeOffer(p: OfferFields, money: Money): string {
  if (p.discount_type === "percent") {
    return p.max_discount_amount ? `Giảm ${p.discount_value}%, tối đa ${money(p.max_discount_amount)}` : `Giảm ${p.discount_value}%`;
  }
  return `Giảm ${money(p.discount_value)}`;
}

type RuleFields = Pick<PromotionInput, "min_order_amount" | "category_ids" | "new_buyers_only" | "per_buyer_limit">;

/** Short conditions for the list row; empty = anyone, any order. */
export function conditionChips(p: RuleFields, money: Money, categoryName: (id: number) => string | undefined): string[] {
  const chips: string[] = [];
  if (p.min_order_amount > 0) chips.push(`Đơn từ ${money(p.min_order_amount)}`);
  if (p.category_ids.length === 1) chips.push(categoryName(p.category_ids[0]) ?? "1 danh mục");
  else if (p.category_ids.length > 1) chips.push(`${p.category_ids.length} danh mục`);
  if (p.new_buyers_only) chips.push("Chỉ đơn đầu tiên");
  chips.push(p.per_buyer_limit == null ? "Không giới hạn lượt/khách" : `${p.per_buyer_limit} lần/khách`);
  return chips;
}

/** "01/10 00:00 → 31/10 23:59" (GMT+7) / "Không thời hạn". */
export function describeWindow(p: Pick<PromotionInput, "starts_at" | "ends_at">): string {
  if (p.starts_at && p.ends_at) return `${formatVn(p.starts_at)} → ${formatVn(p.ends_at)}`;
  if (p.starts_at) return `Từ ${formatVn(p.starts_at)}`;
  if (p.ends_at) return `Đến ${formatVn(p.ends_at)}`;
  return "Không thời hạn";
}

/** Discount a campaign gives on an order of `subtotal` (mirrors checkout: fixed never exceeds the order). */
export function discountFor(p: OfferFields, subtotal: number): number {
  if (p.discount_type === "fixed") return Math.min(p.discount_value, subtotal);
  const raw = Math.floor((subtotal * p.discount_value) / 100);
  return p.max_discount_amount ? Math.min(raw, p.max_discount_amount) : raw;
}

/** A round example order that qualifies: above the minimum, big enough to show the cap. */
export function exampleSubtotal(p: Pick<PromotionInput, "discount_type" | "discount_value" | "max_discount_amount" | "min_order_amount">): number {
  const base = Math.max(p.min_order_amount, 100_000);
  let subtotal = Math.ceil((base * 1.5) / 50_000) * 50_000;
  if (p.discount_type === "fixed") subtotal = Math.max(subtotal, Math.ceil((p.discount_value * 3) / 50_000) * 50_000);
  return subtotal;
}

/** What the buyer is told: "Giảm 10% (tối đa 50.000 ₫) cho đơn Proxy từ 200.000 ₫. Mỗi khách 1 lần. Hết hạn 31/10 23:59." */
export function customerSees(p: PromotionInput, money: Money, categoryName: (id: number) => string | undefined): string {
  const offer = p.discount_type === "percent"
    ? `Giảm ${p.discount_value}%${p.max_discount_amount ? ` (tối đa ${money(p.max_discount_amount)})` : ""}`
    : `Giảm ${money(p.discount_value)}`;
  const names = p.category_ids.map((id) => categoryName(id) ?? `#${id}`);
  const scope = names.length === 0 ? "" : names.length > 3 ? ` thuộc ${names.length} danh mục` : ` ${names.join(", ")}`;
  const min = p.min_order_amount > 0 ? ` từ ${money(p.min_order_amount)}` : "";
  const target = p.new_buyers_only ? "đơn đầu tiên" : "đơn";
  const parts = [`${offer} cho ${target}${scope}${min}.`];
  parts.push(p.per_buyer_limit == null ? "Không giới hạn số lần mỗi khách." : `Mỗi khách ${p.per_buyer_limit} lần.`);
  if (p.ends_at) parts.push(`Hết hạn ${formatVn(p.ends_at)}.`);
  return parts.join(" ");
}

/** The whole campaign as one sentence (list tooltip / summaries). */
export function describeCampaign(p: PromotionInput, money: Money, categoryName: (id: number) => string | undefined): string {
  const parts = [`Khách nhập ${p.code || "…"} được ${describeOffer(p, money).toLowerCase()}`];
  if (p.min_order_amount > 0) parts.push(`cho đơn từ ${money(p.min_order_amount)}`);
  if (p.category_ids.length) {
    const names = p.category_ids.map((id) => categoryName(id) ?? `#${id}`);
    parts.push(`trong ${names.length > 3 ? `${names.length} danh mục` : names.join(", ")}`);
  }
  if (p.new_buyers_only) parts.push("chỉ cho đơn đầu tiên của khách");
  parts.push(p.per_buyer_limit == null ? "không giới hạn số lần mỗi khách" : `mỗi khách ${p.per_buyer_limit} lần`);
  const caps: string[] = [];
  if (p.usage_limit != null) caps.push(`${p.usage_limit} lượt`);
  if (p.budget_amount != null) caps.push(`ngân sách ${money(p.budget_amount)}`);
  const window = describeWindow(p);
  return `${parts.join(", ")}. ${caps.length ? `Dừng khi hết ${caps.join(" hoặc ")}. ` : ""}Thời gian: ${window.charAt(0).toLowerCase()}${window.slice(1)}.`;
}

// ── Audit history ──────────────────────────────────────────────────────────

const FIELD_LABEL: Record<string, string> = {
  code: "Mã", name: "Tên", note: "Ghi chú", discount_type: "Kiểu giảm", discount_value: "Mức giảm",
  max_discount_amount: "Giảm tối đa", min_order_amount: "Đơn tối thiểu", starts_at: "Bắt đầu", ends_at: "Kết thúc",
  usage_limit: "Tổng lượt", per_buyer_limit: "Mỗi khách", budget_amount: "Ngân sách", category_ids: "Danh mục",
  new_buyers_only: "Chỉ đơn đầu tiên", is_active: "Bật",
};

const EVENT_TITLE: Record<string, string> = {
  promotion_created: "Tạo chiến dịch",
  promotion_updated: "Sửa chiến dịch",
  promotion_deleted: "Xoá chiến dịch",
  promotion_duplicated: "Nhân bản",
  promotion_archived: "Lưu trữ",
  promotion_unarchived: "Bỏ lưu trữ",
  promotion_codes_created: "Tạo mã dùng 1 lần",
};

function auditValue(v: unknown): string {
  if (v == null || v === "") return "trống";
  if (typeof v === "boolean") return v ? "có" : "không";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "trống";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatVn(v);
  return String(v);
}

export function describeAudit(e: Pick<AuditEntityEvent, "event" | "details">): { title: string; detail: string | null } {
  const event = e.event ?? "";
  const changes = (e.details?.changes ?? null) as Record<string, { old: unknown; new: unknown }> | null;
  if (event === "promotion_updated" && changes) {
    const keys = Object.keys(changes);
    if (keys.length === 1 && keys[0] === "is_active") {
      return { title: changes.is_active.new ? "Bật lại chiến dịch" : "Tạm dừng chiến dịch", detail: null };
    }
    return {
      title: EVENT_TITLE[event],
      detail: keys.map((k) => `${FIELD_LABEL[k] ?? k}: ${auditValue(changes[k].old)} → ${auditValue(changes[k].new)}`).join(" · "),
    };
  }
  const count = e.details?.count;
  const source = e.details?.source_code;
  if (event === "promotion_duplicated" && typeof source === "string") return { title: EVENT_TITLE[event], detail: `Từ ${source}` };
  return {
    title: EVENT_TITLE[event] ?? (event || "Thao tác"),
    detail: typeof count === "number" ? `${count.toLocaleString("vi-VN")} mã` : null,
  };
}
