"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AuthSessionRow, LoginEvent } from "@/lib/types";
import { Button, Spinner, Tag } from "@/components/ui";
import { useToast } from "@/components/toast";
import { AuthNotice, ChangeEmailSection, ChangePasswordSection, TwoFactorSection } from "@/features/auth";
import { describeDevice, Panel, relativeTime } from "./shared";

/** Ordered by how often people come here: password first, then 2FA (which
 *  jumps to the top when they were sent to set it up), email, then the
 *  review-only blocks — devices with "sign out everywhere" next to the list,
 *  and sign-in history last. */
export function SecurityTab({ autoStart2fa }: { autoStart2fa: boolean }) {
  const t = useTranslations("security");
  const { account, refresh } = useAuth();
  if (!account) return null;
  const twoFactorFirst = account.mfa_available && (autoStart2fa || Boolean(account.mfa_setup_required));
  const twoFactor = account.mfa_available ? (
    <TwoFactorSection enabled={Boolean(account.totp_enabled)} autoStart={autoStart2fa || Boolean(account.mfa_setup_required)} onChanged={refresh} />
  ) : null;
  return (
    <div className="space-y-5">
      {account.mfa_setup_required && <AuthNotice tone="info">{t("adminMustEnable")}</AuthNotice>}
      {twoFactorFirst && twoFactor}
      <ChangePasswordSection />
      {!twoFactorFirst && twoFactor}
      <ChangeEmailSection currentEmail={account.email} />
      <DevicesPanel />
      <LoginHistoryPanel />
    </div>
  );
}

function SignOutEverywhere() {
  const t = useTranslations("security");
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const { logout } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try { await api.logoutAll(); logout(); }
    catch (err) { toast.error(apiErrorMessage(err, t("sessionsFailed"))); setBusy(false); }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
      <Button variant="secondary" size="sm" disabled={busy} onClick={run}>{busy ? t("saving") : t("sessionsSignOutAll")}</Button>
      <span className="text-[12px] text-faint">{t("sessionsHint")}</span>
    </div>
  );
}

function DevicesPanel() {
  const t = useTranslations("account");
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["me", "sessions"], queryFn: api.mySessions });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: () => { toast.success(t("deviceSignedOut")); void queryClient.invalidateQueries({ queryKey: ["me", "sessions"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, t("deviceSignOutFailed"))),
  });
  const rows = sessions.data ?? [];
  return (
    <Panel title={t("devicesTitle")} hint={t("devicesHint")} aside={rows.length > 0 ? <span className="text-[12px] text-faint">{t("devicesCount", { count: rows.length })}</span> : undefined}>
      {sessions.isPending ? (
        <div className="grid place-items-center py-6"><Spinner /></div>
      ) : sessions.isError ? (
        <p className="text-[12.5px] text-bad">{t("loadFailed")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((s: AuthSessionRow) => (
            <li key={s.id} className={cn("flex flex-wrap items-center gap-3 py-2.5", s.is_current && "-mx-3 rounded-lg bg-iris-soft/40 px-3")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-fg">
                  {describeDevice(s.user_agent, t("unknownDevice"))}
                  {s.is_current && <Tag tone="iris">{t("thisDevice")}</Tag>}
                </div>
                <div className="mt-0.5 text-[12px] text-faint">
                  {s.ip ? `IP ${s.ip} · ` : ""}{t("lastActive", { when: relativeTime(s.last_used_at ?? s.created_at, locale, "—") })}
                </div>
              </div>
              {!s.is_current && (
                <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>{t("signOutDevice")}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <SignOutEverywhere />
    </Panel>
  );
}

const OUTCOME_TONE: Record<string, "good" | "bad" | "warn" | "neutral"> = { success: "good", invalid_credentials: "bad", inactive: "warn" };

function LoginHistoryPanel() {
  const t = useTranslations("account");
  const locale = useLocale();
  const events = useQuery({ queryKey: ["me", "login-events"], queryFn: () => api.myLoginEvents(30) });
  const rows = events.data ?? [];
  const outcomeLabel = (o: string) => ({ success: t("outcomeSuccess"), invalid_credentials: t("outcomeInvalid"), inactive: t("outcomeInactive") }[o] ?? o);
  const kindLabel = (k: string) => ({ login: t("kindLogin"), admin_login: t("kindAdminLogin"), locked: t("kindLocked"), unlocked: t("kindUnlocked") }[k] ?? k);
  return (
    <Panel title={t("historyTitle")} hint={t("historyHint")}>
      {events.isPending ? (
        <div className="grid place-items-center py-6"><Spinner /></div>
      ) : rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t("historyEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[12px] text-muted">
              <tr>
                <th className="py-1.5 pr-3 font-medium">{t("colWhen")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("colEvent")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("colDevice")}</th>
                <th className="py-1.5 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((e: LoginEvent) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap py-2 pr-3 text-muted">{formatDateTime(e.created_at, locale)}</td>
                  <td className="py-2 pr-3"><span className="mr-1.5">{kindLabel(e.kind)}</span><Tag tone={OUTCOME_TONE[e.outcome] ?? "neutral"}>{outcomeLabel(e.outcome)}</Tag></td>
                  <td className="py-2 pr-3 text-muted">{describeDevice(e.user_agent, t("unknownDevice"))}</td>
                  <td className="py-2 font-mono text-[12px] text-faint">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
