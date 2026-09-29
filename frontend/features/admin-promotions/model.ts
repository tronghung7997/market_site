/** Admin promo campaigns: form draft ↔ API input, the plain-language summary
 *  an admin reads instead of raw fields, and the state badge. Pure. */

import type { Promotion, PromotionInput, PromotionState } from "../../lib/types.ts";

export type Money = (amountVnd: number) => string;

/** TanStack Query key of the campaign list (and, under it, each campaign's redemptions). */
export const PROMOTIONS_KEY = ["admin", "promotions"] as const;

export interface PromotionDraft {
  code: string;
  name: string;
  note: string;
  discount_type: "percent" | "fixed";
  discount_value: string;
  max_discount_amount: string;
  min_order_amount: string;
  /** `datetime-local` values in the admin's own timezone; "" = open-ended. */
  starts_at: string;
  ends_at: string;
  usage_limit: string;
  per_buyer_limit: string;
  budget_amount: string;
  category_ids: number[];
  new_buyers_only: boolean;
  is_active: boolean;
}

export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export const STATE_META: Record<PromotionState, { label: string; tone: "good" | "warn" | "neutral" | "iris" | "bad" }> = {
  running: { label: "Đang chạy", tone: "good" },
  scheduled: { label: "Sắp chạy", tone: "iris" },
  paused: { label: "Tạm dừng", tone: "neutral" },
  exhausted: { label: "Hết lượt / ngân sách", tone: "warn" },
  ended: { label: "Đã kết thúc", tone: "neutral" },
};

export const STATE_FILTERS = [
  { key: "all", label: "Tất cả" },
  { key: "running", label: "Đang chạy" },
  { key: "scheduled", label: "Sắp chạy" },
  { key: "paused", label: "Tạm dừng" },
  { key: "done", label: "Đã kết thúc" },
] as const;
export type StateFilter = (typeof STATE_FILTERS)[number]["key"];

export function matchesFilter(p: Pick<Promotion, "state">, filter: StateFilter): boolean {
  if (filter === "all") return true;
  if (filter === "done") return p.state === "ended" || p.state === "exhausted";
  return p.state === filter;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant → `datetime-local` value in the browser's timezone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value → ISO instant (the browser's timezone applies). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function emptyDraft(): PromotionDraft {
  return {
    code: "", name: "", note: "", discount_type: "percent", discount_value: "10", max_discount_amount: "",
    min_order_amount: "", starts_at: "", ends_at: "", usage_limit: "", per_buyer_limit: "1", budget_amount: "",
    category_ids: [], new_buyers_only: false, is_active: true,
  };
}

const str = (n: number | null) => (n == null ? "" : String(n));

export function draftFromPromotion(p: Promotion): PromotionDraft {
  return {
    code: p.code, name: p.name, note: p.note ?? "", discount_type: p.discount_type,
    discount_value: String(p.discount_value), max_discount_amount: str(p.max_discount_amount),
    min_order_amount: p.min_order_amount ? String(p.min_order_amount) : "",
    starts_at: toLocalInput(p.starts_at), ends_at: toLocalInput(p.ends_at),
    usage_limit: str(p.usage_limit), per_buyer_limit: str(p.per_buyer_limit), budget_amount: str(p.budget_amount),
    category_ids: [...p.category_ids], new_buyers_only: p.new_buyers_only, is_active: p.is_active,
  };
}

/** Digits only: money and counts are whole numbers. */
export function digits(value: string): string {
  return value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

const optionalInt = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export type DraftErrors = Partial<Record<keyof PromotionDraft, string>>;

/** Same rules the API enforces, with messages next to the field. */
export function validateDraft(d: PromotionDraft): { input: PromotionInput | null; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const code = d.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) errors.code = "3–32 ký tự: chữ, số, - hoặc _, bắt đầu bằng chữ hoặc số.";
  if (!d.name.trim()) errors.name = "Đặt tên để phân biệt chiến dịch.";
  const value = Number(d.discount_value);
  if (!d.discount_value || !Number.isInteger(value) || value <= 0) {
    errors.discount_value = d.discount_type === "percent" ? "Nhập từ 1 đến 100." : "Nhập số tiền giảm.";
  } else if (d.discount_type === "percent" && value > 100) {
    errors.discount_value = "Nhập từ 1 đến 100.";
  }
  const cap = d.discount_type === "percent" ? optionalInt(d.max_discount_amount) : null;
  if (cap !== null && cap <= 0) errors.max_discount_amount = "Để trống nếu không giới hạn.";
  const starts = fromLocalInput(d.starts_at);
  const ends = fromLocalInput(d.ends_at);
  if (starts && ends && ends <= starts) errors.ends_at = "Phải sau thời điểm bắt đầu.";
  for (const field of ["usage_limit", "per_buyer_limit", "budget_amount"] as const) {
    const n = optionalInt(d[field]);
    if (n !== null && n <= 0) errors[field] = "Để trống nếu không giới hạn.";
  }
  if (Object.keys(errors).length) return { input: null, errors };
  return {
    errors,
    input: {
      code, name: d.name.trim(), note: d.note.trim() || null, discount_type: d.discount_type, discount_value: value,
      max_discount_amount: cap, min_order_amount: Number(d.min_order_amount || 0), starts_at: starts, ends_at: ends,
      usage_limit: optionalInt(d.usage_limit), per_buyer_limit: optionalInt(d.per_buyer_limit),
      budget_amount: optionalInt(d.budget_amount), category_ids: [...d.category_ids].sort((a, b) => a - b),
      new_buyers_only: d.new_buyers_only, is_active: d.is_active,
    },
  };
}

type OfferFields = Pick<PromotionInput, "discount_type" | "discount_value" | "max_discount_amount">;

/** "Giảm 10%, tối đa 50.000 ₫" / "Giảm 20.000 ₫". */
export function describeOffer(p: OfferFields, money: Money): string {
  if (p.discount_type === "percent") {
    return p.max_discount_amount ? `Giảm ${p.discount_value}%, tối đa ${money(p.max_discount_amount)}` : `Giảm ${p.discount_value}%`;
  }
  return `Giảm ${money(p.discount_value)}`;
}

type RuleFields = Pick<PromotionInput, "min_order_amount" | "category_ids" | "new_buyers_only" | "per_buyer_limit" | "usage_limit" | "budget_amount">;

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

const dateFmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function formatWhen(iso: string | null): string {
  return iso ? dateFmt.format(new Date(iso)) : "";
}

/** "Từ 10/10/2026 00:00 đến 12/10/2026 23:59" / "Không thời hạn". */
export function describeWindow(p: Pick<PromotionInput, "starts_at" | "ends_at">): string {
  if (p.starts_at && p.ends_at) return `${formatWhen(p.starts_at)} → ${formatWhen(p.ends_at)}`;
  if (p.starts_at) return `Từ ${formatWhen(p.starts_at)}`;
  if (p.ends_at) return `Đến ${formatWhen(p.ends_at)}`;
  return "Không thời hạn";
}

/** The whole campaign as one sentence, shown live while the admin edits. */
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

/** Share of a ceiling used, 0–1, or null when there is no ceiling. */
export function usageRatio(used: number, limit: number | null): number | null {
  if (limit == null || limit <= 0) return null;
  return Math.min(1, used / limit);
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Random, unambiguous code (no 0/O, 1/I). `random` is injectable for tests. */
export function randomCode(prefix = "", length = 8, random: () => number = Math.random): string {
  let out = prefix.toUpperCase();
  while (out.length < prefix.length + length) out += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return out.slice(0, 32);
}
