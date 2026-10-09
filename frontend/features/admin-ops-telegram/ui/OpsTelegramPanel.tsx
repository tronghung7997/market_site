"use client";

/** Admin › Settings › Ops bot: the marketplace's own Telegram bot. Operators'
 *  group gets withdrawals, disputes, deposits, kill-switches, system alerts and
 *  seller applications; an optional public channel gets newly listed products.
 *  The token is write-only: the API only ever returns "…ab12". */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { OpsTelegramConfig, OpsTelegramTestOutcome } from "@/lib/types";
import { Banner, Button, InlineNotice, Input, Tag } from "@/components/ui";
import { AlertTriangle, Check, Info } from "@/components/Icons";
import { useToast } from "@/components/toast";
import { formatDateTime } from "@/lib/utils";
import { SettingsAuditHistory } from "@/features/admin-logs";
import {
  SettingsFooter, SettingsLoadError, SettingsLoading, SettingsRow, SettingsSection, SettingsToggle,
} from "@/features/admin-site-settings";
import {
  botState, INTERVAL_RANGE, isDirty, looksLikeToken, OPS_EVENTS, problems, toForm, toUpdate, validChat, type OpsForm,
} from "../model";

const BOTFATHER_URL = "https://t.me/BotFather";
const chatInput = "h-9 w-full max-w-[320px] font-mono text-[13px]";

export function OpsTelegramPanel() {
  const t = useTranslations("adminOpsTelegram");
  const apiErrorMessage = useApiErrorMessage();
  const query = useQuery({ queryKey: queryKeys.adminOpsTelegram(), queryFn: api.adminOpsTelegram });

  if (query.isPending) return <SettingsLoading />;
  if (query.isError || !query.data) {
    return <SettingsLoadError message={apiErrorMessage(query.error, t("loadFailed"))} onRetry={() => void query.refetch()} />;
  }
  return <OpsTelegramForm cfg={query.data} />;
}

function OpsTelegramForm({ cfg }: { cfg: OpsTelegramConfig }) {
  const t = useTranslations("adminOpsTelegram");
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<OpsForm>(() => toForm(cfg));
  const [checked, setChecked] = useState<{ username: string; name: string } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ops: OpsTelegramTestOutcome; channel: OpsTelegramTestOutcome } | null>(null);

  useEffect(() => { setForm(toForm(cfg)); }, [cfg]);
  const update = (patch: Partial<OpsForm>) => setForm((f) => ({ ...f, ...patch }));
  const store = (data: OpsTelegramConfig) => {
    queryClient.setQueryData(queryKeys.adminOpsTelegram(), data);
    void queryClient.invalidateQueries({ queryKey: ["admin", "logs"] });
  };

  const save = useMutation({
    mutationFn: () => api.updateAdminOpsTelegram(toUpdate(form, cfg)),
    onSuccess: (data) => { store(data); setChecked(null); toast.success(t("saved")); },
    onError: (err) => toast.error(apiErrorMessage(err, t("saveFailed"))),
  });
  const resume = useMutation({
    mutationFn: () => api.updateAdminOpsTelegram({ resume: true }),
    onSuccess: (data) => { store(data); toast.success(t("resumed")); },
    onError: (err) => toast.error(apiErrorMessage(err, t("saveFailed"))),
  });
  const check = useMutation({
    mutationFn: () => api.checkAdminOpsTelegram(form.token.trim() || undefined),
    onMutate: () => { setChecked(null); setCheckError(null); },
    onSuccess: (bot) => setChecked(bot),
    onError: (err) => setCheckError(apiErrorMessage(err, t("checkFailed"))),
  });
  const test = useMutation({
    mutationFn: api.testAdminOpsTelegram,
    onMutate: () => setTestResult(null),
    onSuccess: (result) => setTestResult(result),
    onError: (err) => toast.error(apiErrorMessage(err, t("testFailed"))),
  });

  const issues = problems(form, cfg);
  const dirty = isDirty(form, cfg);
  const tokenTyped = form.token.trim().length > 0;
  const canCheck = tokenTyped ? looksLikeToken(form.token) : cfg.token_set && !form.clearToken;

  return (
    <div className="space-y-4">
      <StatusStrip cfg={cfg} />

      {cfg.status === "paused" && (
        <Banner
          tone="bad"
          icon={<AlertTriangle size={16} />}
          title={t("pausedTitle")}
          action={(
            <Button size="sm" variant="secondary" loading={resume.isPending} disabled={resume.isPending || dirty} onClick={() => resume.mutate()}>
              {t("resume")}
            </Button>
          )}
        >
          {t(`pausedReason.${cfg.paused_reason ?? "token_rejected"}`)} {dirty ? t("pausedSaveFirst") : t("pausedHint")}
        </Banner>
      )}

      <SettingsSection title={t("botSection")} description={t("botSectionHint")}>
        <SettingsRow title={t("enabledTitle")} hint={t("enabledHint")}>
          <SettingsToggle checked={form.enabled} onChange={(v) => update({ enabled: v })} label={form.enabled ? t("enabledOn") : t("enabledOff")} />
        </SettingsRow>
        <SettingsRow title={t("tokenTitle")} hint={t("tokenHint")} label={t("tokenLabel")}>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={form.token}
              onChange={(e) => { update({ token: e.target.value, clearToken: false }); setChecked(null); setCheckError(null); }}
              placeholder={cfg.token_set && !form.clearToken ? t("tokenStored", { hint: cfg.token_hint ?? "" }) : "123456789:AA…"}
              aria-invalid={issues.includes("token")}
              aria-label={t("tokenTitle")}
              className="h-9 min-w-0 flex-1 basis-[240px] font-mono text-[13px]"
            />
            <Button size="sm" variant="secondary" disabled={!canCheck || check.isPending} loading={check.isPending} onClick={() => check.mutate()}>
              {t("check")}
            </Button>
          </div>
          <div className="mt-1.5 space-y-1">
            {issues.includes("token") && <InlineNotice tone="bad">{t("tokenInvalid")}</InlineNotice>}
            {checked && (
              <InlineNotice tone="good" icon={<Check size={14} className="mt-px shrink-0" />}>
                {t("checkOk", { username: checked.username, name: checked.name })}
              </InlineNotice>
            )}
            {checkError && <InlineNotice tone="bad">{checkError}</InlineNotice>}
            {cfg.token_set && !tokenTyped && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                {form.clearToken ? (
                  <span className="text-bad">{t("tokenWillClear")}</span>
                ) : (
                  <span>{t("tokenCurrent", { hint: cfg.token_hint ?? "", username: cfg.bot_username ?? "—" })}</span>
                )}
                <button type="button" onClick={() => update({ clearToken: !form.clearToken })} className="font-medium text-iris-hi underline-offset-2 hover:underline focus-visible:underline">
                  {form.clearToken ? t("tokenKeep") : t("tokenClear")}
                </button>
              </p>
            )}
            <p className="text-[12px] text-faint">
              {t.rich("tokenHelp", { link: (chunks) => <a href={BOTFATHER_URL} target="_blank" rel="noreferrer" className="font-medium text-iris-hi hover:underline">{chunks}</a> })}
            </p>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("targetsSection")} description={t("targetsSectionHint")}>
        <SettingsRow title={t("opsChatTitle")} hint={t("opsChatHint")} label={t("chatIdLabel")}>
          <Input value={form.opsChat} onChange={(e) => update({ opsChat: e.target.value })} placeholder="-1001234567890" aria-invalid={!validChat(form.opsChat)} aria-label={t("opsChatTitle")} className={chatInput} />
          {issues.includes("opsChat") ? <InlineNotice tone="bad" className="mt-1.5">{t("chatInvalid")}</InlineNotice>
            : <span className="mt-1 block text-[12px] text-faint">{t("opsChatHelp")}</span>}
        </SettingsRow>
        <SettingsRow title={t("channelTitle")} hint={t("channelHint")}>
          <SettingsToggle checked={form.channelEnabled} onChange={(v) => update({ channelEnabled: v })} label={form.channelEnabled ? t("channelOn") : t("channelOff")} />
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t("channelIdLabel")}</span>
              <Input value={form.channelChat} onChange={(e) => update({ channelChat: e.target.value })} placeholder="@tenkenh" aria-invalid={!validChat(form.channelChat)} className={chatInput} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t("intervalLabel")}</span>
              <Input inputMode="numeric" value={form.interval} onChange={(e) => update({ interval: e.target.value.replace(/\D/g, "") })} aria-invalid={issues.includes("interval")} className="h-9 w-full text-right font-mono text-[13px] tabular-nums" />
            </label>
          </div>
          {issues.includes("channelChat") && <InlineNotice tone="bad" className="mt-1.5">{t("chatInvalid")}</InlineNotice>}
          <span className="mt-1 block text-[12px] text-faint">
            {issues.includes("interval") ? t("intervalRange", INTERVAL_RANGE) : t("channelHelp", { minutes: form.interval || "—" })}
          </span>
        </SettingsRow>
        <SettingsRow title={t("testTitle")} hint={t("testHint")}>
          <Button size="sm" variant="secondary" disabled={!cfg.token_set || dirty || test.isPending} loading={test.isPending} onClick={() => test.mutate()}>
            {t("test")}
          </Button>
          {dirty && cfg.token_set && <span className="mt-1 block text-[12px] text-faint">{t("testSaveFirst")}</span>}
          {testResult && (
            <ul className="mt-2 space-y-1">
              {(["ops", "channel"] as const).map((target) => (
                <li key={target}>
                  <InlineNotice tone={testResult[target] === "ok" ? "good" : testResult[target] === "not_set" ? "neutral" : "bad"}>
                    {t(`testTarget.${target}`)}: {t(`testOutcome.${testResult[target]}`)}
                  </InlineNotice>
                </li>
              ))}
            </ul>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("eventsSection")} description={t("eventsSectionHint")}>
        {OPS_EVENTS.map((key) => (
          <SettingsRow key={key} title={t(`event.${key}.title`)} hint={t(`event.${key}.hint`)}>
            <SettingsToggle
              checked={form.events[key]}
              onChange={(v) => update({ events: { ...form.events, [key]: v } })}
              label={form.events[key] ? t("eventOn") : t("eventOff")}
            />
          </SettingsRow>
        ))}
        <SettingsRow title={t("quietTitle")} hint={t("quietHint")}>
          <SettingsToggle checked={form.quiet} onChange={(v) => update({ quiet: v })} label={form.quiet ? t("quietOn") : t("quietOff")} />
        </SettingsRow>
      </SettingsSection>

      <SettingsFooter
        updatedAt={cfg.updated_at}
        dirty={dirty}
        valid={issues.length === 0}
        problems={issues.includes("incomplete") ? [t("incomplete")] : []}
        saving={save.isPending}
        onReset={() => { setForm(toForm(cfg)); setChecked(null); setCheckError(null); }}
        onSave={() => save.mutate()}
      />
      <SettingsAuditHistory events={["ops_telegram_config_changed"]} />
    </div>
  );
}

/** Where the bot stands right now: state, identity and the outbox. */
function StatusStrip({ cfg }: { cfg: OpsTelegramConfig }) {
  const t = useTranslations("adminOpsTelegram");
  const locale = useLocale();
  const state = botState(cfg);
  const tone = state === "running" ? "good" : state === "paused" ? "bad" : state === "noToken" ? "warn" : "neutral";
  return (
    <section aria-label={t("statusLabel")} className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-line bg-card px-5 py-3 shadow-card">
      <div className="flex min-w-0 items-center gap-2.5">
        <Tag tone={tone}>{t(`state.${state}`)}</Tag>
        <span className="truncate text-[13px] text-fg">
          {cfg.bot_username ? <span className="font-medium">@{cfg.bot_username}</span> : <span className="text-muted">{t("noBot")}</span>}
        </span>
      </div>
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">{t("pending")}</dt>
          <dd className="font-semibold tabular-nums text-fg">{cfg.outbox.pending}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">{t("failed24h")}</dt>
          <dd className={cfg.outbox.failed_24h ? "font-semibold tabular-nums text-bad" : "font-semibold tabular-nums text-fg"}>{cfg.outbox.failed_24h}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">{t("lastSent")}</dt>
          <dd className="tabular-nums text-fg">{cfg.outbox.last_sent_at ? formatDateTime(cfg.outbox.last_sent_at, locale) : t("never")}</dd>
        </div>
      </dl>
      {state === "noToken" && (
        <p className="flex basis-full items-start gap-1.5 text-[12px] text-muted">
          <Info size={13} className="mt-0.5 shrink-0" /> {t("noTokenHint")}
        </p>
      )}
    </section>
  );
}
