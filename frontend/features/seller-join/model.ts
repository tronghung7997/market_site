/** Seller application wizard: steps, validation, request payload and the
 *  local draft. Limits mirror the backend's SellerApplyRequest. */

import type { SellerExperience, SellerReferralSource, SellerType } from "../../lib/types.ts";

export const APPLY_STEPS = ["shop", "contact", "review"] as const;
export type ApplyStep = (typeof APPLY_STEPS)[number];

export const SELLER_TYPES: SellerType[] = ["individual", "business"];
export const SELLER_EXPERIENCE: SellerExperience[] = ["none", "under_1y", "1_3y", "over_3y"];
export const REFERRAL_SOURCES: SellerReferralSource[] = ["search", "social", "friend", "community", "ads", "other"];

export const NAME_MAX = 255;
export const DESCRIPTION_MAX = 1000;
export const CONTACT_MAX = 255;
export const WARRANTY_MAX = 1000;
export const CATEGORIES_MAX = 12;
const PHONE_RE = /^\+?[0-9 .()-]{6,32}$/;

export interface ApplyDraft {
  businessName: string;
  sellerType: SellerType;
  categoryIds: number[];
  experience: SellerExperience | "";
  description: string;
  contact: string;
  phone: string;
  warrantyPolicy: string;
  referralSource: SellerReferralSource | "";
  acceptRules: boolean;
}

export const EMPTY_DRAFT: ApplyDraft = {
  businessName: "",
  sellerType: "individual",
  categoryIds: [],
  experience: "",
  description: "",
  contact: "",
  phone: "",
  warrantyPolicy: "",
  referralSource: "",
  acceptRules: false,
};

/** Message keys (under `seller.apply.errors`) of what blocks a step. */
export type ApplyError = "nameRequired" | "nameTooLong" | "categoryRequired" | "tooManyCategories" | "descriptionTooLong"
  | "phoneInvalid" | "contactTooLong" | "warrantyTooLong" | "rulesRequired";

export function stepErrors(step: ApplyStep, d: ApplyDraft): ApplyError[] {
  const errors: ApplyError[] = [];
  if (step === "shop") {
    const name = d.businessName.trim();
    if (!name) errors.push("nameRequired");
    if (name.length > NAME_MAX) errors.push("nameTooLong");
    if (d.categoryIds.length === 0) errors.push("categoryRequired");
    if (d.categoryIds.length > CATEGORIES_MAX) errors.push("tooManyCategories");
    if (d.description.trim().length > DESCRIPTION_MAX) errors.push("descriptionTooLong");
  }
  if (step === "contact") {
    if (d.phone.trim() && !PHONE_RE.test(d.phone.trim())) errors.push("phoneInvalid");
    if (d.contact.trim().length > CONTACT_MAX) errors.push("contactTooLong");
    if (d.warrantyPolicy.trim().length > WARRANTY_MAX) errors.push("warrantyTooLong");
    if (!d.acceptRules) errors.push("rulesRequired");
  }
  return errors;
}

export function canSubmit(d: ApplyDraft): boolean {
  return stepErrors("shop", d).length === 0 && stepErrors("contact", d).length === 0;
}

/** Body of POST /seller/apply; empty optional answers are left out. */
export function applyPayload(d: ApplyDraft) {
  const trim = (v: string) => v.trim() || undefined;
  return {
    business_name: d.businessName.trim(),
    description: trim(d.description),
    contact: trim(d.contact),
    seller_type: d.sellerType,
    category_ids: d.categoryIds.length ? d.categoryIds : undefined,
    experience: d.experience || undefined,
    phone: trim(d.phone),
    warranty_policy: trim(d.warrantyPolicy),
    referral_source: d.referralSource || undefined,
    accept_rules: d.acceptRules,
  };
}

/** Restore a saved draft, keeping only known fields of the right type. */
export function parseDraft(raw: string | null): ApplyDraft | null {
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  const v = data as Record<string, unknown>;
  const str = (key: string) => (typeof v[key] === "string" ? (v[key] as string) : "");
  return {
    businessName: str("businessName").slice(0, NAME_MAX),
    sellerType: SELLER_TYPES.includes(v.sellerType as SellerType) ? (v.sellerType as SellerType) : "individual",
    categoryIds: Array.isArray(v.categoryIds)
      ? (v.categoryIds as unknown[]).filter((id): id is number => Number.isInteger(id)).slice(0, CATEGORIES_MAX)
      : [],
    experience: SELLER_EXPERIENCE.includes(v.experience as SellerExperience) ? (v.experience as SellerExperience) : "",
    description: str("description").slice(0, DESCRIPTION_MAX),
    contact: str("contact").slice(0, CONTACT_MAX),
    phone: str("phone").slice(0, 32),
    warrantyPolicy: str("warrantyPolicy").slice(0, WARRANTY_MAX),
    referralSource: REFERRAL_SOURCES.includes(v.referralSource as SellerReferralSource) ? (v.referralSource as SellerReferralSource) : "",
    // The rules must be accepted again each time; never restored.
    acceptRules: false,
  };
}

export function draftKey(accountId: number): string {
  return `gmmo:seller-apply:${accountId}`;
}
