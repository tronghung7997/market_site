"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AuthRuntimeConfig } from "@/lib/types";
import { Input } from "@/components/ui";
import { SettingsFooter, SettingsLoadError, SettingsLoading, SettingsRow } from "./SettingsRow";

const HOURS_RANGE = { min: 1, max: 168 };

type Form = { require: boolean; hours: string; adminMfa: boolean; withdrawMfa: boolean; turnstile: string };
const toForm = (cfg: AuthRuntimeConfig): Form => ({
  require: cfg.require_email_verification,
  hours: String(cfg.verification_link_hours),
  adminMfa: cfg.require_admin_2fa,
  withdrawMfa: cfg.require_2fa_for_withdrawal,
  turnstile: cfg.turnstile_site_key,
});

/** Admin › Settings › Accounts: sign-up policy. */
export function AuthSettingsPanel() {
  const t = useTranslations("adminAuthConfig");
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.adminAuthConfig(), queryFn: api.adminAuthConfig });
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => { if (query.data) setForm(toForm(query.data)); }, [query.data]);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.updateAdminAuthConfig>[0]) => api.updateAdminAuthConfig(body),
    onSuccess: (data) => { queryClient.setQueryData(queryKeys.adminAuthConfig(), data); setMsg({ tone: "good", text: t("saved") }); },
    onError: (err) => setMsg({ tone: "bad", text: apiErrorMessage(err, t("saveFailed")) }),
  });

  if (query.isPending || !form) return <SettingsLoading />;
  if (query.isError) return <SettingsLoadError message={apiErrorMessage(query.error, t("loadFailed"))} onRetry={() => void query.refetch()} />;

  const hoursNum = Number(form.hours);
  const hoursOk = Number.isInteger(hoursNum) && hoursNum >= HOURS_RANGE.min && hoursNum <= HOURS_RANGE.max;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(query.data));
  const update = (patch: Partial<Form>) => { setForm((f) => (f ? { ...f, ...patch } : f)); setMsg(null); };

  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      <SettingsRow title={t("verifyTitle")} hint={t("verifyHint")}>
        <span className="mt-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
          <input type="checkbox" checked={form.require} onChange={(e) => update({ require: e.target.checked })} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
          {t("verifyLabel")}
        </span>
      </SettingsRow>
      <SettingsRow title={t("hoursTitle")} hint={t("hoursHint")} label={t("hoursLabel")}>
        <Input inputMode="numeric" value={form.hours} onChange={(e) => update({ hours: e.target.value.replace(/\D/g, "") })} aria-invalid={!hoursOk} className="mt-1 h-9 w-full text-right font-mono text-[13px] tabular-nums" />
        <span className="mt-1 block text-[11px] text-faint">{t("range", { min: HOURS_RANGE.min, max: HOURS_RANGE.max })}</span>
      </SettingsRow>
      <SettingsRow title={t("adminMfaTitle")} hint={t("adminMfaHint")}>
        <span className="mt-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
          <input type="checkbox" checked={form.adminMfa} onChange={(e) => update({ adminMfa: e.target.checked })} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
          {t("adminMfaLabel")}
        </span>
      </SettingsRow>
      <SettingsRow title={t("withdrawMfaTitle")} hint={t("withdrawMfaHint")}>
        <span className="mt-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
          <input type="checkbox" checked={form.withdrawMfa} onChange={(e) => update({ withdrawMfa: e.target.checked })} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
          {t("withdrawMfaLabel")}
        </span>
      </SettingsRow>
      <SettingsRow title={t("turnstileTitle")} hint={t("turnstileHint")} label={t("turnstileLabel")}>
        <Input value={form.turnstile} onChange={(e) => update({ turnstile: e.target.value.trim() })} placeholder="0x4AAAAAAA…" className="mt-1 h-9 w-full font-mono text-[12.5px]" />
        <span className="mt-1 block text-[11px] text-faint">
          {query.data.turnstile_secret_configured ? t("turnstileSecretOk") : t("turnstileSecretMissing")}
        </span>
      </SettingsRow>
      <SettingsFooter
        updatedAt={query.data.updated_at}
        message={msg}
        dirty={dirty}
        valid={hoursOk}
        saving={save.isPending}
        onReset={() => { setForm(toForm(query.data)); setMsg(null); }}
        onSave={() => save.mutate({
          require_email_verification: form.require,
          verification_link_hours: hoursNum,
          require_admin_2fa: form.adminMfa,
          require_2fa_for_withdrawal: form.withdrawMfa,
          turnstile_site_key: form.turnstile,
        })}
      />
    </section>
  );
}
