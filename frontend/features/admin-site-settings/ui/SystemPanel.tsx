"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { SiteStatusAdmin, SiteStatusUpdate } from "@/lib/types";
import { Button, Input, Textarea } from "@/components/ui";
import { ChevronRight } from "@/components/Icons";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { SettingsFooter, SettingsLoadError, SettingsLoading, SettingsRow, SettingsSection, SettingsToggle } from "./SettingsRow";

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


/** Admin › Settings › System: maintenance mode, money kill-switches, announcement bar. */
export function SystemPanel() {
  const t = useTranslations("adminSystem");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.adminSiteStatus(), queryFn: api.adminSiteStatus });
  const [form, setForm] = useState<Form | null>(null);
  const toast = useToast();

  useEffect(() => { if (query.data) setForm(toForm(query.data)); }, [query.data]);

  const save = useMutation({
    mutationFn: (body: SiteStatusUpdate) => api.updateAdminSiteStatus(body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.adminSiteStatus(), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.siteStatus() });
      toast.success(t("saved"));
    },
    onError: (err) => toast.error(apiErrorMessage(err, t("saveFailed"))),
  });

  if (query.isPending || !form) return <SettingsLoading />;
  if (query.isError) return <SettingsLoadError message={apiErrorMessage(query.error, t("loadFailed"))} onRetry={() => void query.refetch()} />;

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(query.data));
  const update = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const anyFrozen = form.withdrawals && form.deposits && form.orders;
  const live = query.data;

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

  const previewText = (locale === "vi" ? form.annVi : form.annEn) || form.annVi || form.annEn;

  return (
    <div className="space-y-4">
      <SettingsSection title={t("freezeSection")} description={t("freezeSectionHint")}>
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
            <SettingsToggle checked={form[key]} onChange={(v) => update({ [key]: v } as Partial<Form>)} label={label} danger />
          </SettingsRow>
        ))}
        <SettingsRow title={t("freezeReasonTitle")} hint={t("freezeReasonHint")}>
          <Input value={form.reason} onChange={(e) => update({ reason: e.target.value })} maxLength={500} className="h-10 w-full text-[13px]" placeholder={t("freezeReasonPlaceholder")} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("maintenanceSection")}>
        <SettingsRow title={t("maintenanceTitle")} hint={t("maintenanceHint")}>
          <SettingsToggle checked={form.maintenance} onChange={(v) => update({ maintenance: v })} label={t("maintenanceLabel")} danger />
        </SettingsRow>
        <SettingsRow title={t("maintenanceMessageTitle")} hint={t("maintenanceMessageHint")} stacked>
          <div className="grid gap-3 md:grid-cols-2">
            <span className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t("langVi")}</span>
              <Textarea value={form.msgVi} onChange={(e) => update({ msgVi: e.target.value })} rows={3} maxLength={2000} className="w-full text-[13.5px] leading-relaxed" placeholder={t("maintenanceMessagePhVi")} />
            </span>
            <span className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t("langEn")}</span>
              <Textarea value={form.msgEn} onChange={(e) => update({ msgEn: e.target.value })} rows={3} maxLength={2000} className="w-full text-[13.5px] leading-relaxed" placeholder={t("maintenanceMessagePhEn")} />
            </span>
          </div>
        </SettingsRow>
        <SettingsRow title={t("maintenanceUntilTitle")} hint={t("maintenanceUntilHint")} label={t("localTime")}>
          <Input type="datetime-local" value={form.until} onChange={(e) => update({ until: e.target.value })} className="h-10 w-full max-w-[280px] text-[13px]" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("announcementSection")} description={t("annHint")}>
        <SettingsRow title={t("annTitle")} hint={t("annToggleHint")}>
          <SettingsToggle checked={form.annOn} onChange={(v) => update({ annOn: v })} label={t("annLabel")} />
        </SettingsRow>
        <SettingsRow title={t("annLevelTitle")} hint={t("annLevelHint")}>
          <div className="flex flex-wrap gap-2">
            {(["info", "warn", "danger"] as const).map((lvl) => (
              <button key={lvl} type="button" onClick={() => update({ annLevel: lvl })} aria-pressed={form.annLevel === lvl}
                className={cn("rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  form.annLevel === lvl
                    ? lvl === "info" ? "border-iris bg-iris text-surface" : lvl === "warn" ? "border-warn bg-warn text-surface" : "border-bad bg-bad text-surface"
                    : "border-line text-muted hover:text-fg")}>
                {t(`level_${lvl}`)}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow title={t("annTextTitle")} hint={t("annTextHint")} stacked>
          <div className="grid gap-3 md:grid-cols-2">
            <span className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t("langVi")}</span>
              <Textarea value={form.annVi} onChange={(e) => update({ annVi: e.target.value })} rows={2} maxLength={300} className="w-full text-[14px] leading-relaxed" placeholder={t("annTextPhVi")} />
            </span>
            <span className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t("langEn")}</span>
              <Textarea value={form.annEn} onChange={(e) => update({ annEn: e.target.value })} rows={2} maxLength={300} className="w-full text-[14px] leading-relaxed" placeholder={t("annTextPhEn")} />
            </span>
          </div>
          {previewText && (
            <div className="mt-3">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t("annPreview")}</span>
              <div className={cn("flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-[13.5px] font-medium text-surface",
                form.annLevel === "info" ? "bg-iris" : form.annLevel === "warn" ? "bg-warn" : "bg-bad")}>
                <span className="min-w-0 flex-1">{previewText}</span>
                {form.annLink && <span className="rounded-full bg-surface/15 px-2.5 py-0.5 text-[12.5px]">{t("annLinkPreview")}</span>}
              </div>
            </div>
          )}
        </SettingsRow>
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[13px] font-medium text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
            {t("annAdvanced")}
          </summary>
          <SettingsRow title={t("annLinkTitle")} hint={t("annLinkHint")}>
            <Input value={form.annLink} onChange={(e) => update({ annLink: e.target.value })} maxLength={500} className="h-10 w-full font-mono text-[12.5px]" placeholder={t("annLinkPh")} />
          </SettingsRow>
          <SettingsRow title={t("annWindowTitle")} hint={t("annWindowHint")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <span className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">{t("annFrom")}</span>
                <Input type="datetime-local" value={form.annFrom} onChange={(e) => update({ annFrom: e.target.value })} className="h-10 w-full text-[13px]" />
              </span>
              <span className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">{t("annTo")}</span>
                <Input type="datetime-local" value={form.annTo} onChange={(e) => update({ annTo: e.target.value })} className="h-10 w-full text-[13px]" />
              </span>
            </div>
          </SettingsRow>
        </details>
      </SettingsSection>

      <SettingsFooter
        updatedAt={live.updated_at}
        dirty={dirty}
        valid
        saving={save.isPending}
        onReset={() => setForm(toForm(live))}
        onSave={onSave}
      />
      <p className="text-[11.5px] text-faint">{t("timezoneNote", { zone: Intl.DateTimeFormat(locale).resolvedOptions().timeZone })}</p>
    </div>
  );
}
