"use client";

import { useTranslations } from "next-intl";
import { vnd } from "@/lib/api";
import type { SellerTierName, SellerTierRule, SellerTierRulePatch } from "@/lib/types";
import { Input } from "@/components/ui";
import { ImageUploader, type UploaderImage } from "@/components/media/ImageUploader";
import { SettingsSection } from "@/features/admin-site-settings";
import { useHoldLabel } from "@/lib/hold";

const TIERS: SellerTierName[] = ["new", "verified", "trusted", "enterprise"];
type Field = "max_active_products" | "withdraw_limit_per_request" | "fee_percent" | "escrow_reduction_hours";
const FIELDS: Field[] = ["max_active_products", "withdraw_limit_per_request", "fee_percent", "escrow_reduction_hours"];
// Blank: unlimited for the two caps, the platform default for the fee.
const NULLABLE: Record<Field, boolean> = { max_active_products: true, withdraw_limit_per_request: true, fee_percent: true, escrow_reduction_hours: false };
const MAX: Record<Field, number> = { max_active_products: 1_000_000_000, withdraw_limit_per_request: 1_000_000_000, fee_percent: 100, escrow_reduction_hours: 2160 };
/** Client ladder for the tier fee (enterprise is negotiated), shown as a hint. */
const SUGGESTED_FEE: Record<SellerTierName, string> = { new: "10", verified: "6", trusted: "3", enterprise: "" };
const num = (v: string) => Number(v.trim().replace(",", "."));

export type TierForm = Record<SellerTierName, Record<Field, string> & { badge: UploaderImage[] }>;

export const toTierForm = (rules: SellerTierRule[]): TierForm => {
  const out = {} as TierForm;
  for (const tier of TIERS) {
    const r = rules.find((x) => x.tier === tier);
    out[tier] = {
      max_active_products: r?.max_active_products == null ? "" : String(r.max_active_products),
      withdraw_limit_per_request: r?.withdraw_limit_per_request == null ? "" : String(r.withdraw_limit_per_request),
      fee_percent: r?.fee_percent == null ? "" : String(r.fee_percent),
      escrow_reduction_hours: String(r?.escrow_reduction_hours ?? 0),
      badge: r?.badge ? [r.badge] : [],
    };
  }
  return out;
};

const cellOk = (field: Field, v: string) => {
  if (v.trim() === "") return NULLABLE[field];
  const n = num(v);
  if (field === "fee_percent") return Number.isFinite(n) && n >= 0 && n <= MAX[field] && Math.round(n * 100) === n * 100;
  return Number.isInteger(n) && n >= 0 && n <= MAX[field];
};

export const tierFormValid = (form: TierForm) => TIERS.every((tier) => FIELDS.every((f) => cellOk(f, form[tier][f])));

/** Only the cells that differ from the saved copy; blank cap → null (unlimited). */
export function tierPatch(form: TierForm, saved: TierForm): Partial<Record<SellerTierName, SellerTierRulePatch>> {
  const patch: Partial<Record<SellerTierName, SellerTierRulePatch>> = {};
  for (const tier of TIERS) {
    const diff: SellerTierRulePatch = {};
    for (const f of FIELDS) {
      if (form[tier][f] === saved[tier][f]) continue;
      const v = form[tier][f].trim();
      diff[f] = v === "" ? null : num(v);
    }
    if (form[tier].badge[0]?.id !== saved[tier].badge[0]?.id) diff.badge_image_id = form[tier].badge[0]?.id ?? null;
    if (Object.keys(diff).length) patch[tier] = diff;
  }
  return patch;
}

/** Admin › Settings › Sellers › Tiers: what each seller tier is allowed. Owned by SellerConfigPanel (one save bar). */
export function SellerTierTable({ form, onChange }: { form: TierForm; onChange: (next: TierForm) => void }) {
  const t = useTranslations("adminSellerConfig");
  const holdLabel = useHoldLabel();
  const set = (tier: SellerTierName, field: Field, v: string) =>
    onChange({ ...form, [tier]: { ...form[tier], [field]: field === "fee_percent" ? v.replace(/[^\d.,]/g, "") : v.replace(/\D/g, "") } });
  const preview = (tier: SellerTierName) => {
    const w = form[tier].withdraw_limit_per_request.trim();
    return w === "" ? t("unlimited") : vnd(Number(w));
  };

  return (
    <SettingsSection title={t("tiersTitle")} description={t("tiersHint")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead className="bg-raised/40 text-left text-[12px] text-muted">
            <tr>
              <th className="px-5 py-2.5 font-medium">{t("colTier")}</th>
              <th className="px-3 py-2.5 font-medium">{t("colMaxProducts")}</th>
              <th className="px-3 py-2.5 font-medium">{t("colWithdrawLimit")}</th>
              <th className="px-3 py-2.5 font-medium">{t("colFeePercent")}</th>
              <th className="px-3 py-2.5 font-medium">{t("colEscrowReduction")}</th>
              <th className="px-5 py-2.5 font-medium">{t("colBadge")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {TIERS.map((tier) => (
              <tr key={tier} className="align-top">
                <td className="px-5 py-3">
                  <div className="font-semibold text-fg">{t(`tier_${tier}`)}</div>
                  <div className="text-[11.5px] text-faint">{t(`tierHint_${tier}`)}</div>
                </td>
                <td className="px-3 py-3">
                  <Input inputMode="numeric" value={form[tier].max_active_products} placeholder={t("unlimited")} onChange={(e) => set(tier, "max_active_products", e.target.value)} aria-invalid={!cellOk("max_active_products", form[tier].max_active_products)} className="h-9 w-[140px] text-right font-mono tabular-nums" />
                </td>
                <td className="px-3 py-3">
                  <Input inputMode="numeric" value={form[tier].withdraw_limit_per_request} placeholder={t("unlimited")} onChange={(e) => set(tier, "withdraw_limit_per_request", e.target.value)} aria-invalid={!cellOk("withdraw_limit_per_request", form[tier].withdraw_limit_per_request)} className="h-9 w-[160px] text-right font-mono tabular-nums" />
                  <div className="mt-1 text-[11.5px] text-faint">{preview(tier)}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <Input inputMode="decimal" value={form[tier].fee_percent} placeholder={t("feeDefault")} onChange={(e) => set(tier, "fee_percent", e.target.value)} aria-invalid={!cellOk("fee_percent", form[tier].fee_percent)} aria-label={`${t("colFeePercent")} · ${t(`tier_${tier}`)}`} className="h-9 w-[92px] text-right font-mono tabular-nums placeholder:font-sans placeholder:text-[11.5px]" />
                    <span className="text-[12px] text-muted">%</span>
                  </div>
                  {SUGGESTED_FEE[tier] && form[tier].fee_percent.trim() === "" && (
                    <div className="mt-1 text-[11.5px] text-faint">{t("feeSuggested", { value: SUGGESTED_FEE[tier] })}</div>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <Input inputMode="numeric" value={form[tier].escrow_reduction_hours} onChange={(e) => set(tier, "escrow_reduction_hours", e.target.value)} aria-invalid={!cellOk("escrow_reduction_hours", form[tier].escrow_reduction_hours)} className="h-9 w-[70px] text-right font-mono tabular-nums" />
                    <span className="text-[12px] text-muted">{t("hoursUnit")}</span>
                  </div>
                  {cellOk("escrow_reduction_hours", form[tier].escrow_reduction_hours) && Number(form[tier].escrow_reduction_hours) > 0 && (
                    <div className="mt-1 text-[11.5px] text-faint">{holdLabel(Number(form[tier].escrow_reduction_hours))}</div>
                  )}
                </td>
                <td className="px-5 py-3">
                  <ImageUploader
                    purpose="tier_badge"
                    layout="badge"
                    compact
                    value={form[tier].badge}
                    onChange={(badge) => onChange({ ...form, [tier]: { ...form[tier], badge } })}
                    label={`${t("colBadge")} · ${t(`tier_${tier}`)}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-2.5 text-[12px] text-faint">{t("tiersNote")}</p>
    </SettingsSection>
  );
}
