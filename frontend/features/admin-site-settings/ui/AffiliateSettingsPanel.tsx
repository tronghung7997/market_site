"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AffiliateRuntimeConfig } from "@/lib/types";
import { Input } from "@/components/ui";
import { SettingsFooter, SettingsLoadError, SettingsLoading, SettingsRow } from "./SettingsRow";

const PERCENT_RANGE = { min: 0, max: 100 };
const ATTRIBUTION_RANGE = { min: 1, max: 365 };
const EARNING_RANGE = { min: 0, max: 3650 };
const PER_DAY_RANGE = { min: 1, max: 10_000 };

type Form = {
  enabled: boolean;
  percent: string;
  attribution: string;
  earning: string;
  perDay: string;
};

function toForm(cfg: AffiliateRuntimeConfig): Form {
  return {
    enabled: cfg.enabled,
    percent: String(cfg.commission_percent_of_fee),
    attribution: String(cfg.attribution_days),
    earning: String(cfg.earning_days),
    perDay: String(cfg.max_commissions_per_day),
  };
}

function inRange(raw: string, range: { min: number; max: number }, integer = true): boolean {
  if (raw.trim() === "") return false;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  if (integer && !Number.isInteger(n)) return false;
  return n >= range.min && n <= range.max;
}

const numericClass = "mt-1 h-9 w-full text-right font-mono text-[13px] tabular-nums";

/** Admin › Settings › Affiliate: commission as a share of the platform fee, attribution and earning windows. */
export function AffiliateSettingsPanel() {
  const t = useTranslations("adminAffiliateConfig");
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.adminAffiliateConfig(), queryFn: api.adminAffiliateConfig });
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (query.data) setForm(toForm(query.data));
  }, [query.data]);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.updateAdminAffiliateConfig>[0]) => api.updateAdminAffiliateConfig(body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.adminAffiliateConfig(), data);
      setMsg({ tone: "good", text: t("saved") });
    },
    onError: (err) => setMsg({ tone: "bad", text: apiErrorMessage(err, t("saveFailed")) }),
  });

  if (query.isPending || !form) return <SettingsLoading />;
  if (query.isError) return <SettingsLoadError message={apiErrorMessage(query.error, t("loadFailed"))} onRetry={() => void query.refetch()} />;

  const percentOk = inRange(form.percent, PERCENT_RANGE, false);
  const attributionOk = inRange(form.attribution, ATTRIBUTION_RANGE);
  const earningOk = inRange(form.earning, EARNING_RANGE);
  const perDayOk = inRange(form.perDay, PER_DAY_RANGE);
  const valid = percentOk && attributionOk && earningOk && perDayOk;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(query.data));
  const update = (patch: Partial<Form>) => { setForm((f) => (f ? { ...f, ...patch } : f)); setMsg(null); };
  const digits = (v: string) => v.replace(/\D/g, "");

  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      <SettingsRow title={t("enabledTitle")} hint={t("enabledHint")}>
        <span className="mt-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
          <input type="checkbox" checked={form.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
          {t("enabledLabel")}
        </span>
      </SettingsRow>
      <SettingsRow title={t("percentTitle")} hint={t("percentHint")} label={t("percentLabel")}>
        <div className="mt-1 flex items-center gap-2">
          <Input inputMode="decimal" value={form.percent} onChange={(e) => update({ percent: e.target.value.replace(/[^\d.]/g, "") })} aria-invalid={!percentOk} className="h-9 w-full text-right font-mono text-[13px] tabular-nums" />
          <span className="shrink-0 text-[12px] text-muted">%</span>
        </div>
        <span className="mt-1 block text-[11px] text-faint">{t("percentExample")}</span>
      </SettingsRow>
      <SettingsRow title={t("attributionTitle")} hint={t("attributionHint")} label={t("daysLabel")}>
        <Input inputMode="numeric" value={form.attribution} onChange={(e) => update({ attribution: digits(e.target.value) })} aria-invalid={!attributionOk} className={numericClass} />
        <span className="mt-1 block text-[11px] text-faint">{t("range", { min: ATTRIBUTION_RANGE.min, max: ATTRIBUTION_RANGE.max })}</span>
      </SettingsRow>
      <SettingsRow title={t("earningTitle")} hint={t("earningHint")} label={t("daysLabel")}>
        <Input inputMode="numeric" value={form.earning} onChange={(e) => update({ earning: digits(e.target.value) })} aria-invalid={!earningOk} className={numericClass} />
        <span className="mt-1 block text-[11px] text-faint">{t("earningRange", { max: EARNING_RANGE.max })}</span>
      </SettingsRow>
      <SettingsRow title={t("perDayTitle")} hint={t("perDayHint")} label={t("perDayLabel")}>
        <Input inputMode="numeric" value={form.perDay} onChange={(e) => update({ perDay: digits(e.target.value) })} aria-invalid={!perDayOk} className={numericClass} />
        <span className="mt-1 block text-[11px] text-faint">{t("range", { min: PER_DAY_RANGE.min, max: PER_DAY_RANGE.max })}</span>
      </SettingsRow>
      <SettingsFooter
        updatedAt={query.data.updated_at}
        message={msg}
        dirty={dirty}
        valid={valid}
        saving={save.isPending}
        onReset={() => { setForm(toForm(query.data)); setMsg(null); }}
        onSave={() => save.mutate({
          enabled: form.enabled,
          commission_percent_of_fee: Number(form.percent),
          attribution_days: Number(form.attribution),
          earning_days: Number(form.earning),
          max_commissions_per_day: Number(form.perDay),
        })}
      />
    </section>
  );
}
