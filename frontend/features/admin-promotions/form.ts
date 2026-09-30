/** Campaign editor state. Inputs are strings so a field can be emptied while
 *  typing; rules mirror PromotionInput in marketplace-svc/src/promotions so
 *  problems show next to the field instead of after saving. Pure. */

import type { AdminPromotion, PromotionCodesCreate, PromotionInput } from "../../lib/types.ts";
import { CODE_RE } from "./model.ts";
import { fromVnInput, toVnInput } from "./time.ts";

export interface PromotionDraft {
  code: string;
  name: string;
  note: string;
  discount_type: "percent" | "fixed";
  discount_value: string;
  max_discount_amount: string;
  min_order_amount: string;
  /** `datetime-local` values in GMT+7; "" = open-ended. */
  starts_at: string;
  ends_at: string;
  usage_limit: string;
  per_buyer_limit: string;
  budget_amount: string;
  category_ids: number[];
  new_buyers_only: boolean;
  is_active: boolean;
}

export type DraftErrors = Partial<Record<keyof PromotionDraft, string>>;

export function emptyDraft(): PromotionDraft {
  return {
    code: "", name: "", note: "", discount_type: "percent", discount_value: "10", max_discount_amount: "",
    min_order_amount: "", starts_at: "", ends_at: "", usage_limit: "", per_buyer_limit: "1", budget_amount: "",
    category_ids: [], new_buyers_only: false, is_active: true,
  };
}

const str = (n: number | null) => (n == null ? "" : String(n));

export function draftFromPromotion(p: Pick<AdminPromotion, keyof PromotionInput>): PromotionDraft {
  return {
    code: p.code, name: p.name, note: p.note ?? "", discount_type: p.discount_type,
    discount_value: String(p.discount_value), max_discount_amount: str(p.max_discount_amount),
    min_order_amount: p.min_order_amount ? String(p.min_order_amount) : "",
    starts_at: toVnInput(p.starts_at), ends_at: toVnInput(p.ends_at),
    usage_limit: str(p.usage_limit), per_buyer_limit: str(p.per_buyer_limit), budget_amount: str(p.budget_amount),
    category_ids: [...p.category_ids].sort((a, b) => a - b), new_buyers_only: p.new_buyers_only, is_active: p.is_active,
  };
}

/** Digits only: money and counts are whole numbers. */
export function digits(value: string): string {
  return value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

const optionalInt = (v: string): number | null => (v.trim() === "" ? null : Number(v));

/** The input to save, or the field errors that block it. */
export function validateDraft(d: PromotionDraft): { input: PromotionInput | null; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const code = d.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) errors.code = "3–32 ký tự: chữ in hoa, số, - hoặc _, bắt đầu bằng chữ hoặc số.";
  if (!d.name.trim()) errors.name = "Đặt tên để phân biệt chiến dịch.";
  const value = Number(d.discount_value);
  const min = Number(d.min_order_amount || 0);
  if (!d.discount_value || !Number.isInteger(value) || value <= 0) {
    errors.discount_value = d.discount_type === "percent" ? "Nhập từ 1 đến 100." : "Nhập số tiền giảm.";
  } else if (d.discount_type === "percent" && value > 100) {
    errors.discount_value = "Nhập từ 1 đến 100.";
  } else if (d.discount_type === "fixed" && min > 0 && value >= min) {
    errors.discount_value = "Số tiền giảm phải nhỏ hơn đơn tối thiểu.";
  }
  // A cap only means something for a percent discount; never send one with a fixed amount.
  const cap = d.discount_type === "percent" ? optionalInt(d.max_discount_amount) : null;
  if (cap !== null && cap <= 0) errors.max_discount_amount = "Để trống nếu không giới hạn.";
  const starts = fromVnInput(d.starts_at);
  const ends = fromVnInput(d.ends_at);
  if (d.starts_at && !starts) errors.starts_at = "Ngày giờ không hợp lệ.";
  if (d.ends_at && !ends) errors.ends_at = "Ngày giờ không hợp lệ.";
  else if (starts && ends && ends <= starts) errors.ends_at = "Kết thúc phải sau bắt đầu.";
  for (const field of ["usage_limit", "per_buyer_limit", "budget_amount"] as const) {
    const n = optionalInt(d[field]);
    if (n !== null && n <= 0) errors[field] = "Để trống nếu không giới hạn.";
  }
  if (Object.keys(errors).length) return { input: null, errors };
  return {
    errors,
    input: {
      code, name: d.name.trim(), note: d.note.trim() || null, discount_type: d.discount_type, discount_value: value,
      max_discount_amount: cap, min_order_amount: min, starts_at: starts, ends_at: ends,
      usage_limit: optionalInt(d.usage_limit), per_buyer_limit: optionalInt(d.per_buyer_limit),
      budget_amount: optionalInt(d.budget_amount), category_ids: [...d.category_ids].sort((a, b) => a - b),
      new_buyers_only: d.new_buyers_only, is_active: d.is_active,
    },
  };
}

/** Non-blocking notes shown next to a field. A past start is allowed: it means "start now". */
export function draftWarnings(d: PromotionDraft, savedStartsAt: string | null, now: number = Date.now()): DraftErrors {
  const w: DraftErrors = {};
  const starts = fromVnInput(d.starts_at);
  // The form holds minutes; the saved value has seconds and another ISO shape.
  const minute = (iso: string) => Math.floor(Date.parse(iso) / 60_000);
  const unchanged = !!savedStartsAt && !!starts && minute(starts) === minute(savedStartsAt);
  if (starts && Date.parse(starts) < now && !unchanged) w.starts_at = "Giờ bắt đầu đã qua — mã sẽ chạy ngay khi lưu.";
  const ends = fromVnInput(d.ends_at);
  if (ends && Date.parse(ends) < now) w.ends_at = "Giờ kết thúc đã qua — mã sẽ không dùng được.";
  return w;
}

/** Comparable form of a field (so "0100" and "100", or reordered categories, are not changes). */
function norm(d: PromotionDraft, k: keyof PromotionDraft): string {
  const v = d[k];
  if (Array.isArray(v)) return [...v].sort((a, b) => a - b).join(",");
  if (typeof v === "boolean") return String(v);
  if (k === "code") return v.trim().toUpperCase();
  if (k === "max_discount_amount" && d.discount_type === "fixed") return "";
  return v.trim();
}

/** Fields that differ from the saved draft (the sticky save bar counts them). */
export function changedFields(draft: PromotionDraft, saved: PromotionDraft): (keyof PromotionDraft)[] {
  return (Object.keys(saved) as (keyof PromotionDraft)[]).filter((k) => norm(draft, k) !== norm(saved, k));
}

/** Only what changed, for PATCH (the server re-validates the merged whole). */
export function patchFrom(input: PromotionInput, fields: (keyof PromotionDraft)[]): Partial<PromotionInput> {
  const patch: Partial<PromotionInput> = {};
  const keys = new Set<keyof PromotionInput>(fields as (keyof PromotionInput)[]);
  // Switching to fixed must also clear the cap, or the server rejects it.
  if (keys.has("discount_type")) keys.add("max_discount_amount");
  for (const k of keys) (patch as Record<string, unknown>)[k] = input[k];
  return patch;
}

/** Field messages of a 422 `{detail:{code:"validation", fields}}` (ApiError puts `fields` in params). */
export function serverFieldErrors(err: unknown): DraftErrors | null {
  const params = (err as { params?: { fields?: unknown } } | null)?.params;
  const fields = params?.fields;
  if (!fields || typeof fields !== "object") return null;
  const out: DraftErrors = {};
  const known = new Set(Object.keys(emptyDraft()));
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof v !== "string") continue;
    const key = (known.has(k) ? k : "code") as keyof PromotionDraft;
    out[key] = out[key] ? `${out[key]} ${v}` : v;
  }
  return Object.keys(out).length ? out : null;
}

// ── Bulk single-use codes ──────────────────────────────────────────────────

export interface BulkCodesForm { promotionId: string; prefix: string; count: string; length: string }
export type BulkCodesErrors = Partial<Record<keyof BulkCodesForm, string>>;

export const BULK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function validateBulkCodes(f: BulkCodesForm): { body: PromotionCodesCreate | null; promotionId: number | null; errors: BulkCodesErrors } {
  const errors: BulkCodesErrors = {};
  const id = Number(f.promotionId);
  if (!f.promotionId || !Number.isInteger(id) || id <= 0) errors.promotionId = "Chọn chiến dịch.";
  const prefix = f.prefix.trim().toUpperCase();
  if (!/^[A-Z0-9-]{0,12}$/.test(prefix)) errors.prefix = "Tối đa 12 ký tự: chữ in hoa, số hoặc -.";
  const count = Number(f.count);
  if (!Number.isInteger(count) || count < 1 || count > 5000) errors.count = "Từ 1 đến 5.000 mã.";
  const length = Number(f.length || 8);
  if (!Number.isInteger(length) || length < 6 || length > 12) errors.length = "Từ 6 đến 12 ký tự.";
  if (Object.keys(errors).length) return { body: null, promotionId: null, errors };
  return { body: { count, prefix, length }, promotionId: id, errors };
}

/** What one generated code looks like: "KOL-7QF2MX2A". `random` injectable for tests. */
export function sampleCode(prefix: string, length: number, random: () => number = Math.random): string {
  let out = prefix.trim().toUpperCase();
  for (let i = 0; i < length; i++) out += BULK_ALPHABET[Math.floor(random() * BULK_ALPHABET.length)];
  return out;
}

/** Random, unambiguous parent code (no 0/O, 1/I). */
export function randomCode(prefix = "", length = 8, random: () => number = Math.random): string {
  return sampleCode(prefix, length, random).slice(0, 32);
}

/** Saved values changed underneath the form (header pause, another tab):
 *  take the new value wherever the admin had not edited the field. */
export function rebaseDraft(draft: PromotionDraft, oldSaved: PromotionDraft, newSaved: PromotionDraft): PromotionDraft {
  const out = { ...draft } as Record<keyof PromotionDraft, unknown>;
  for (const k of Object.keys(newSaved) as (keyof PromotionDraft)[]) {
    if (norm(draft, k) === norm(oldSaved, k)) out[k] = newSaved[k];
  }
  return out as unknown as PromotionDraft;
}
