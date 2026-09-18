"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { SiteStatusAdmin, SiteStatusUpdate } from "@/lib/types";
import { Button, Input, Tag, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { SettingsFooter, SettingsLoadError, SettingsLoading, SettingsRow } from "./SettingsRow";

type Form = {
  maintenance: boolean; msgVi: string; msgEn: string; until: string;
  withdrawals: boolean; deposits: boolean; orders: boolean; reason: string;
  annOn: boolean; annLevel: "info" | "warn" | "danger"; annVi: string; annEn: string; annLink: string; annFrom: string; annTo: string;
};

/** ISO → value for <input type="datetime-local"> in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toForm(s: SiteStatusAdmin): Form {
  return {
    maintenance: s.maintenance_enabled, msgVi: s.maintenance_message_vi, msgEn: s.maintenance_message_en, until: toLocalInput(s.maintenance_until),
    withdrawals: s.withdrawals_frozen, deposits: s.deposits_frozen, orders: s.orders_frozen, reason: s.freeze_reason,
    annOn: s.announcement_enabled, annLevel: s.announcement_level, annVi: s.announcement_text_vi, annEn: s.announcement_text_en,
    annLink: s.announcement_link_url, annFrom: toLocalInput(s.announcement_starts_at), annTo: toLocalInput(s.announcement_ends_at),
  };
}

const checkbox = "h-3.5 w-3.5 rounded border-line-2 text-iris";

/** Admin › Settings › System: maintenance mode, money kill-switches, announcement bar. */
export function SystemPanel() {
  const t = useTranslations("adminSystem");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.adminSiteStatus(), queryFn: api.adminSiteStatus });
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => { if (query.data) setForm(toForm(query.data)); }, [query.data]);

  const save = useMutation({
    mutationFn: (body: SiteStatusUpdate) => api.updateAdminSiteStatus(body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.adminSiteStatus(), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.siteStatus() });
      setMsg({ tone: "good", text: t("saved") });
    },
    onError: (err) => setMsg({ tone: "bad", text: apiErrorMessage(err, t("saveFailed")) }),
  });

  if (query.isPending || !form) return <SettingsLoading />;
  if (query.isError) return <SettingsLoadError message={apiErrorMessage(query.error, t("loadFailed"))} onRetry={() => void query.refetch()} />;

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(query.data));
  const update = (patch: Partial<Form>) => { setForm((f) => (f ? { ...f, ...patch } : f)); setMsg(null); };
  const anyFrozen = form.withdrawals && form.deposits && form.orders;
  const live = query.data;
  const activeFlags = [
    live.maintenance_enabled && t("flagMaintenance"),
    live.withdrawals_frozen && t("flagWithdrawals"),
    live.deposits_frozen && t("flagDeposits"),
    live.orders_frozen && t("flagOrders"),
  ].filter(Boolean) as string[];

  const onSave = () => save.mutate({
    maintenance_enabled: form.maintenance,
    maintenance_message_vi: form.msgVi,
    maintenance_message_en: form.msgEn,
    ...(form.until ? { maintenance_until: fromLocalInput(form.until) ?? undefined } : { clear_maintenance_until: true }),
    withdrawals_frozen: form.withdrawals,
    deposits_frozen: form.deposits,
    orders_frozen: form.orders,
    freeze_reason: form.reason,
    announcement_enabled: form.annOn,
    announcement_level: form.annLevel,
    announcement_text_vi: form.annVi,
    announcement_text_en: form.annEn,
    announcement_link_url: form.annLink,
    ...(form.annFrom || form.annTo
      ? { announcement_starts_at: fromLocalInput(form.annFrom) ?? undefined, announcement_ends_at: fromLocalInput(form.annTo) ?? undefined }
      : { clear_announcement_window: true }),
  });

  return (
    <div className="space-y-4">
      {activeFlags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-bad/25 bg-bad-soft px-4 py-3 text-[13px] text-bad" role="status">
          <span className="font-semibold">{t("activeNow")}</span>
          {activeFlags.map((f) => <Tag key={f} tone="bad">{f}</Tag>)}
        </div>
      )}

      <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line bg-raised/40 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-muted">{t("freezeSection")}</div>
        <SettingsRow title={t("freezeAllTitle")} hint={t("freezeAllHint")}>
          <Button size="sm" variant={anyFrozen ? "secondary" : "danger"} onClick={() => update({ withdrawals: !anyFrozen, deposits: !anyFrozen, orders: !anyFrozen })}>
            {anyFrozen ? t("unfreezeAll") : t("freezeAll")}
          </Button>
        </SettingsRow>
        {([
          ["withdrawals", t("freezeWithdrawalsTitle"), t("freezeWithdrawalsHint"), t("freezeWithdrawalsLabel")],
          ["deposits", t("freezeDepositsTitle"), t("freezeDepositsHint"), t("freezeDepositsLabel")],
          ["orders", t("freezeOrdersTitle"), t("freezeOrdersHint"), t("freezeOrdersLabel")],
        ] as const).map(([key, title, hint, label]) => (
          <SettingsRow key={key} title={title} hint={hint}>
            <span className="mt-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
              <input type="checkbox" checked={form[key]} onChange={(e) => update({ [key]: e.target.checked } as Partial<Form>)} className={checkbox} />
              {label}
            </span>
          </SettingsRow>
        ))}
        <SettingsRow title={t("freezeReasonTitle")} hint={t("freezeReasonHint")} label={t("freezeReasonLabel")}>
          <Input value={form.reason} onChange={(e) => update({ reason: e.target.value })} maxLength={500} className="mt-1 h-9 w-full text-[12.5px]" placeholder={t("freezeReasonPlaceholder")} />
        </SettingsRow>
      </section>

      <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line bg-raised/40 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-muted">{t("maintenanceSection")}</div>
        <SettingsRow title={t("maintenanceTitle")} hint={t("maintenanceHint")}>
          <span className={cn("mt-1 flex cursor-pointer items-center gap-2 text-[12.5px]", form.maintenance ? "font-semibold text-bad" : "text-fg")}>
            <input type="checkbox" checked={form.maintenance} onChange={(e) => update({ maintenance: e.target.checked })} className={checkbox} />
            {t("maintenanceLabel")}
          </span>
        </SettingsRow>
        <SettingsRow title={t("maintenanceMessageTitle")} hint={t("maintenanceMessageHint")}>
          <div className="mt-1 space-y-2">
            <Textarea value={form.msgVi} onChange={(e) => update({ msgVi: e.target.value })} rows={2} maxLength={2000} className="w-full text-[12.5px]" placeholder={t("maintenanceMessagePhVi")} />
            <Textarea value={form.msgEn} onChange={(e) => update({ msgEn: e.target.value })} rows={2} maxLength={2000} className="w-full text-[12.5px]" placeholder={t("maintenanceMessagePhEn")} />
          </div>
        </SettingsRow>
        <SettingsRow title={t("maintenanceUntilTitle")} hint={t("maintenanceUntilHint")} label={t("localTime")}>
          <Input type="datetime-local" value={form.until} onChange={(e) => update({ until: e.target.value })} className="mt-1 h-9 w-full text-[12.5px]" />
        </SettingsRow>
      </section>

      <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line bg-raised/40 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-muted">{t("announcementSection")}</div>
        <SettingsRow title={t("annTitle")} hint={t("annHint")}>
          <span className="mt-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
            <input type="checkbox" checked={form.annOn} onChange={(e) => update({ annOn: e.target.checked })} className={checkbox} />
            {t("annLabel")}
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(["info", "warn", "danger"] as const).map((lvl) => (
              <button key={lvl} type="button" onClick={() => update({ annLevel: lvl })}
                className={cn("rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                  form.annLevel === lvl
                    ? lvl === "info" ? "border-iris/40 bg-iris-soft text-iris-hi" : lvl === "warn" ? "border-warn/40 bg-warn-soft text-warn" : "border-bad/40 bg-bad-soft text-bad"
                    : "border-line text-muted hover:text-fg")}>
                {t(`level_${lvl}`)}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow title={t("annTextTitle")} hint={t("annTextHint")}>
          <div className="mt-1 space-y-2">
            <Input value={form.annVi} onChange={(e) => update({ annVi: e.target.value })} maxLength={300} className="h-9 w-full text-[12.5px]" placeholder={t("annTextPhVi")} />
            <Input value={form.annEn} onChange={(e) => update({ annEn: e.target.value })} maxLength={300} className="h-9 w-full text-[12.5px]" placeholder={t("annTextPhEn")} />
            <Input value={form.annLink} onChange={(e) => update({ annLink: e.target.value })} maxLength={500} className="h-9 w-full font-mono text-[12px]" placeholder={t("annLinkPh")} />
          </div>
        </SettingsRow>
        <SettingsRow title={t("annWindowTitle")} hint={t("annWindowHint")} label={t("localTime")}>
          <div className="mt-1 grid gap-2">
            <Input type="datetime-local" value={form.annFrom} onChange={(e) => update({ annFrom: e.target.value })} className="h-9 w-full text-[12.5px]" aria-label={t("annFrom")} />
            <Input type="datetime-local" value={form.annTo} onChange={(e) => update({ annTo: e.target.value })} className="h-9 w-full text-[12.5px]" aria-label={t("annTo")} />
          </div>
        </SettingsRow>
        <SettingsFooter
          updatedAt={live.updated_at}
          message={msg}
          dirty={dirty}
          valid={!form.maintenance || Boolean(form.msgVi || form.msgEn) || true}
          saving={save.isPending}
          onReset={() => { setForm(toForm(live)); setMsg(null); }}
          onSave={onSave}
        />
      </section>
      <p className="text-[11.5px] text-faint">{t("timezoneNote", { zone: Intl.DateTimeFormat(locale).resolvedOptions().timeZone })}</p>
    </div>
  );
}
