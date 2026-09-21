"use client";

import { useTranslations } from "next-intl";
import { vnd } from "@/lib/api";
import type { SellerTierName, SellerTierRule, SellerTierRulePatch } from "@/lib/types";
import { Input } from "@/components/ui";
import { SettingsSection } from "@/features/admin-site-settings";

const TIERS: SellerTierName[] = ["new", "verified", "trusted", "enterprise"];
type Field = "max_active_products" | "withdraw_limit_per_request" | "fee_discount_pp" | "escrow_reduction_days";
const FIELDS: Field[] = ["max_active_products", "withdraw_limit_per_request", "fee_discount_pp", "escrow_reduction_days"];
// Blank is allowed (= unlimited) only for the two caps.
const NULLABLE: Record<Field, boolean> = { max_active_products: true, withdraw_limit_per_request: true, fee_discount_pp: false, escrow_reduction_days: false };
const MAX: Record<Field, number> = { max_active_products: 1_000_000_000, withdraw_limit_per_request: 1_000_000_000, fee_discount_pp: 100, escrow_reduction_days: 90 };

export type TierForm = Record<SellerTierName, Record<Field, string>>;

export const toTierForm = (rules: SellerTierRule[]): TierForm => {
  const out = {} as TierForm;
  for (const tier of TIERS) {
    const r = rules.find((x) => x.tier === tier);
    out[tier] = {
      max_active_products: r?.max_active_products == null ? "" : String(r.max_active_products),
      withdraw_limit_per_request: r?.withdraw_limit_per_request == null ? "" : String(r.withdraw_limit_per_request),
      fee_discount_pp: String(r?.fee_discount_pp ?? 0),
      escrow_reduction_days: String(r?.escrow_reduction_days ?? 0),
    };
  }
  return out;
};

const cellOk = (field: Field, v: string) => {
  if (v.trim() === "") return NULLABLE[field];
  const n = Number(v);
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
      diff[f] = v === "" ? null : Number(v);
    }
    if (Object.keys(diff).length) patch[tier] = diff;
  }
  return patch;
}

/** Admin › Settings › Sellers › Tiers: what each seller tier is allowed. Owned by SellerConfigPanel (one save bar). */
export function SellerTierTable({ form, onChange }: { form: TierForm; onChange: (next: TierForm) => void }) {
  const t = useTranslations("adminSellerConfig");
  const set = (tier: SellerTierName, field: Field, v: string) =>
    onChange({ ...form, [tier]: { ...form[tier], [field]: v.replace(/\D/g, "") } });
  const preview = (tier: SellerTierName) => {
    const w = form[tier].withdraw_limit_per_request.trim();
    return w === "" ? t("unlimited") : vnd(Number(w));
  };

  return (
    <SettingsSection title={t("tiersTitle")} description={t("tiersHint")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="bg-raised/40 text-left text-[12px] text-muted">
            <tr>
              <th className="px-5 py-2.5 font-medium">{t("colTier")}</th>
              <th className="px-3 py-2.5 font-medium">{t("colMaxProducts")}</th>
              <th className="px-3 py-2.5 font-medium">{t("colWithdrawLimit")}</th>
              <th className="px-3 py-2.5 font-medium">{t("colFeeDiscount")}</th>
              <th className="px-5 py-2.5 font-medium">{t("colEscrowReduction")}</th>
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
                    <Input inputMode="numeric" value={form[tier].fee_discount_pp} onChange={(e) => set(tier, "fee_discount_pp", e.target.value)} aria-invalid={!cellOk("fee_discount_pp", form[tier].fee_discount_pp)} className="h-9 w-[70px] text-right font-mono tabular-nums" />
                    <span className="text-[12px] text-muted">{t("points")}</span>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1.5">
                    <Input inputMode="numeric" value={form[tier].escrow_reduction_days} onChange={(e) => set(tier, "escrow_reduction_days", e.target.value)} aria-invalid={!cellOk("escrow_reduction_days", form[tier].escrow_reduction_days)} className="h-9 w-[70px] text-right font-mono tabular-nums" />
                    <span className="text-[12px] text-muted">{t("daysUnit")}</span>
                  </div>
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
