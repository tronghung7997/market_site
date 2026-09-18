"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, vnd } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { Category, FeeConfigAdmin, FeeConfigUpdate } from "@/lib/types";
import { Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { SettingsFooter, SettingsLoadError, SettingsLoading, SettingsRow, SettingsSection } from "./SettingsRow";

const PERCENT = { min: 0, max: 100 };
const DAYS = { min: 0, max: 90 };
const HOURS = { min: 0, max: 720 };
const EXAMPLE_ORDER = 1_000_000;
const EXAMPLE_WITHDRAW = 2_000_000;

type Form = {
  feePercent: string;
  categoryFee: Record<string, string>;     // category id → "" (default) | percent
  escrowDefault: string;
  escrowMin: string;
  categoryEscrow: Record<string, string>;  // category id → "" (global floor) | days
  withdrawMin: string;
  withdrawFeeFixed: string;
  withdrawFeePercent: string;
  disputeSellerHours: string;
};

const toForm = (cfg: FeeConfigAdmin): Form => ({
  feePercent: String(cfg.platform_fee_percent),
  categoryFee: Object.fromEntries(Object.entries(cfg.category_fee_percent).map(([k, v]) => [k, String(v)])),
  escrowDefault: String(cfg.escrow_default_days),
  escrowMin: String(cfg.escrow_min_days),
  categoryEscrow: Object.fromEntries(Object.entries(cfg.category_escrow_min_days).map(([k, v]) => [k, String(v)])),
  withdrawMin: String(cfg.withdraw_min_amount),
  withdrawFeeFixed: String(cfg.withdraw_fee_fixed),
  withdrawFeePercent: String(cfg.withdraw_fee_percent),
  disputeSellerHours: String(cfg.dispute_seller_response_hours),
});

const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
const inRange = (v: string, range: { min: number; max: number }, integer = true) => {
  const n = num(v);
  return Number.isFinite(n) && (!integer || Number.isInteger(n)) && n >= range.min && n <= range.max;
};
const mapOk = (m: Record<string, string>, range: { min: number; max: number }, integer: boolean) =>
  Object.values(m).every((v) => v.trim() === "" || inRange(v, range, integer));
const compact = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)]));

const cell = "h-9 w-full max-w-[140px] text-right font-mono text-[13px] tabular-nums";

/** Admin › Settings › Fees & holds: platform fee, escrow hold floors and withdrawal rules. */
export function FeeSettingsPanel() {
  const t = useTranslations("adminFeeConfig");
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: queryKeys.adminFeeConfig(), queryFn: api.adminFeeConfig });
  const categories = useQuery({ queryKey: ["categories"], queryFn: api.categories, staleTime: 60_000 });
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => { if (query.data) setForm(toForm(query.data)); }, [query.data]);

  const save = useMutation({
    mutationFn: (body: FeeConfigUpdate) => api.updateAdminFeeConfig(body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.adminFeeConfig(), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.feeConfig() });
      toast.success(t("saved"));
    },
    onError: (err) => toast.error(apiErrorMessage(err, t("saveFailed"))),
  });

  if (query.isPending || !form) return <SettingsLoading />;
  if (query.isError) return <SettingsLoadError message={apiErrorMessage(query.error, t("loadFailed"))} onRetry={() => void query.refetch()} />;

  const update = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setCategoryFee = (id: number, v: string) => update({ categoryFee: { ...form.categoryFee, [id]: v } });
  const setCategoryEscrow = (id: number, v: string) => update({ categoryEscrow: { ...form.categoryEscrow, [id]: v } });
  const digits = (v: string) => v.replace(/\D/g, "");
  const decimal = (v: string) => v.replace(/[^\d.]/g, "");

  const feeOk = inRange(form.feePercent, PERCENT, false);
  const categoryFeeOk = mapOk(form.categoryFee, PERCENT, false);
  const escrowDefaultOk = inRange(form.escrowDefault, DAYS);
  const escrowMinOk = inRange(form.escrowMin, DAYS);
  const categoryEscrowOk = mapOk(form.categoryEscrow, DAYS, true);
  const withdrawMinOk = form.withdrawMin.trim() !== "" && Number.isInteger(num(form.withdrawMin)) && num(form.withdrawMin) >= 0;
  const withdrawFixedOk = form.withdrawFeeFixed.trim() !== "" && Number.isInteger(num(form.withdrawFeeFixed)) && num(form.withdrawFeeFixed) >= 0;
  const withdrawPercentOk = inRange(form.withdrawFeePercent, PERCENT, false);
  const disputeHoursOk = inRange(form.disputeSellerHours, HOURS);
  const valid = feeOk && categoryFeeOk && escrowDefaultOk && escrowMinOk && categoryEscrowOk && withdrawMinOk && withdrawFixedOk && withdrawPercentOk && disputeHoursOk;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(query.data));

  const exampleFee = feeOk ? Math.floor(EXAMPLE_ORDER * num(form.feePercent) / 100) : 0;
  const exampleWithdrawFee = withdrawFixedOk && withdrawPercentOk
    ? Math.min(EXAMPLE_WITHDRAW, num(form.withdrawFeeFixed) + Math.floor(EXAMPLE_WITHDRAW * num(form.withdrawFeePercent) / 100))
    : 0;
  const cats: Category[] = (categories.data ?? []).filter((c) => c.is_active);

  const onSave = () => save.mutate({
    platform_fee_percent: num(form.feePercent),
    category_fee_percent: compact(form.categoryFee),
    escrow_default_days: num(form.escrowDefault),
    escrow_min_days: num(form.escrowMin),
    category_escrow_min_days: compact(form.categoryEscrow),
    withdraw_min_amount: num(form.withdrawMin),
    withdraw_fee_fixed: num(form.withdrawFeeFixed),
    withdraw_fee_percent: num(form.withdrawFeePercent),
    dispute_seller_response_hours: num(form.disputeSellerHours),
  });

  const categoryTable = (
    values: Record<string, string>, onChange: (id: number, v: string) => void, ok: boolean, unit: string, placeholder: string, sanitize: (v: string) => string,
  ) => (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full text-[13px]">
        <tbody className="divide-y divide-line">
          {cats.length === 0 && <tr><td className="px-3 py-2 text-muted">{t("noCategories")}</td></tr>}
          {cats.map((c) => (
            <tr key={c.id} className="bg-surface">
              <td className="px-3 py-1.5 text-fg">{c.name}</td>
              <td className="px-3 py-1.5">
                <div className="flex items-center justify-end gap-2">
                  <Input inputMode="decimal" value={values[c.id] ?? ""} placeholder={placeholder} onChange={(e) => onChange(c.id, sanitize(e.target.value))} aria-invalid={!ok} className={cell} />
                  <span className="w-8 shrink-0 text-[12px] text-muted">{unit}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <SettingsSection title={t("feeSection")} description={t("feeSectionHint")}>
        <SettingsRow title={t("feeTitle")} hint={t("feeHint")} label={t("percentLabel")}>
          <div className="flex items-center gap-2">
            <Input inputMode="decimal" value={form.feePercent} onChange={(e) => update({ feePercent: decimal(e.target.value) })} aria-invalid={!feeOk} className={cell} />
            <span className="shrink-0 text-[12px] text-muted">%</span>
          </div>
          <span className="mt-1 block text-[12px] text-faint">{t("feeExample", { order: vnd(EXAMPLE_ORDER), fee: vnd(exampleFee), seller: vnd(EXAMPLE_ORDER - exampleFee) })}</span>
        </SettingsRow>
        <SettingsRow title={t("categoryFeeTitle")} hint={t("categoryFeeHint")} stacked>
          {categoryTable(form.categoryFee, setCategoryFee, categoryFeeOk, "%", t("useDefault"), decimal)}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("escrowSection")} description={t("escrowSectionHint")}>
        <SettingsRow title={t("escrowDefaultTitle")} hint={t("escrowDefaultHint")} label={t("daysLabel")}>
          <Input inputMode="numeric" value={form.escrowDefault} onChange={(e) => update({ escrowDefault: digits(e.target.value) })} aria-invalid={!escrowDefaultOk} className={cell} />
        </SettingsRow>
        <SettingsRow title={t("escrowMinTitle")} hint={t("escrowMinHint")} label={t("daysLabel")}>
          <Input inputMode="numeric" value={form.escrowMin} onChange={(e) => update({ escrowMin: digits(e.target.value) })} aria-invalid={!escrowMinOk} className={cell} />
          <span className="mt-1 block text-[12px] text-faint">{t("escrowMinNote")}</span>
        </SettingsRow>
        <SettingsRow title={t("categoryEscrowTitle")} hint={t("categoryEscrowHint")} stacked>
          {categoryTable(form.categoryEscrow, setCategoryEscrow, categoryEscrowOk, t("daysUnit"), t("useGlobalFloor"), digits)}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("withdrawSection")} description={t("withdrawSectionHint")}>
        <SettingsRow title={t("withdrawMinTitle")} hint={t("withdrawMinHint")} label="VND">
          <Input inputMode="numeric" value={form.withdrawMin} onChange={(e) => update({ withdrawMin: digits(e.target.value) })} aria-invalid={!withdrawMinOk} className="h-9 w-full max-w-[200px] text-right font-mono text-[13px] tabular-nums" />
          <span className="mt-1 block text-[12px] text-faint">{withdrawMinOk ? (num(form.withdrawMin) > 0 ? vnd(num(form.withdrawMin)) : t("noMinimum")) : ""}</span>
        </SettingsRow>
        <SettingsRow title={t("withdrawFeeTitle")} hint={t("withdrawFeeHint")}>
          <div className="flex flex-wrap items-center gap-2">
            <Input inputMode="numeric" value={form.withdrawFeeFixed} onChange={(e) => update({ withdrawFeeFixed: digits(e.target.value) })} aria-invalid={!withdrawFixedOk} className="h-9 w-full max-w-[160px] text-right font-mono text-[13px] tabular-nums" />
            <span className="text-[12px] text-muted">VND +</span>
            <Input inputMode="decimal" value={form.withdrawFeePercent} onChange={(e) => update({ withdrawFeePercent: decimal(e.target.value) })} aria-invalid={!withdrawPercentOk} className="h-9 w-full max-w-[100px] text-right font-mono text-[13px] tabular-nums" />
            <span className="text-[12px] text-muted">%</span>
          </div>
          <span className="mt-1 block text-[12px] text-faint">
            {t("withdrawFeeExample", { amount: vnd(EXAMPLE_WITHDRAW), fee: vnd(exampleWithdrawFee), net: vnd(EXAMPLE_WITHDRAW - exampleWithdrawFee) })}
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("disputeSection")} description={t("disputeSectionHint")}>
        <SettingsRow title={t("disputeSellerHoursTitle")} hint={t("disputeSellerHoursHint")} label={t("hoursLabel")}>
          <Input inputMode="numeric" value={form.disputeSellerHours} onChange={(e) => update({ disputeSellerHours: digits(e.target.value) })} aria-invalid={!disputeHoursOk} className={cell} />
          <span className="mt-1 block text-[12px] text-faint">{num(form.disputeSellerHours) === 0 ? t("disputeSellerHoursOff") : t("disputeSellerHoursNote")}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsFooter
        updatedAt={query.data.updated_at}
        dirty={dirty}
        valid={valid}
        saving={save.isPending}
        onReset={() => setForm(toForm(query.data))}
        onSave={onSave}
      />
      <p className="text-[11.5px] text-faint">{t("auditNote")}</p>
    </div>
  );
}
