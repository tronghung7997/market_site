"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type {
  MailConfigAdmin,
  MailConfigUpdate,
  MailOutboxRow,
  MailProvider,
} from "@/lib/types";
import { Button, Field, InlineNotice, Input, Select, Spinner, Tag } from "@/components/ui";
import { useToast } from "@/components/toast";
import { SettingsFooter, SettingsToggle } from "@/features/admin-site-settings";
import { AlertCircle, CheckCircle2, Info } from "@/components/Icons";
import { cn } from "@/lib/cn";

import { MailTemplateEditor } from "./MailTemplateEditor";

const OUTBOX_PAGE_SIZE = 25;
// Must match KNOWN_TEMPLATES in marketplace-svc/src/mail/templates.py.
const MAIL_TEMPLATE_IDS = [
  "password_reset",
  "password_changed",
  "seller_application_approved",
  "seller_application_rejected",
  "provider_approved",
  "provider_rejected",
  "withdrawal_approved",
  "withdrawal_rejected",
  "dispute_opened",
  "dispute_resolved",
  "admin_test",
] as const;

const PROVIDER_ORDER: readonly MailProvider[] = ["smtp", "resend", "log"];

type Notice = { tone: "good" | "bad"; text: string } | null;

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const Icon = notice.tone === "good" ? CheckCircle2 : AlertCircle;
  return (
    <InlineNotice tone={notice.tone} icon={<Icon className="h-3.5 w-3.5" />}>{notice.text}</InlineNotice>
  );
}

export function MailSettingsPanel() {
  const t = useTranslations("adminMail");
  const apiErrorMessage = useApiErrorMessage();
  const locale = useLocale();
  const [cfg, setCfg] = useState<MailConfigAdmin | null>(null);
  const [provider, setProvider] = useState<MailProvider>("log");
  const [mailFrom, setMailFrom] = useState("");
  const [mailFromName, setMailFromName] = useState("");
  const [workerEnabled, setWorkerEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [testing, setTesting] = useState(false);
  const [testNotice, setTestNotice] = useState<Notice>(null);
  const [testTo, setTestTo] = useState("");
  const [rows, setRows] = useState<MailOutboxRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [listErr, setListErr] = useState("");
  const [listMsg, setListMsg] = useState("");
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const apply = (data: MailConfigAdmin) => {
    setCfg(data);
    setProvider(data.provider);
    setMailFrom(data.mail_from);
    setMailFromName(data.mail_from_name);
    setWorkerEnabled(data.worker_enabled);
  };

  const loadList = useCallback(async (nextOffset: number, quiet = false) => {
    setListErr("");
    if (!quiet) setRefreshing(true);
    try {
      const data = await api.adminMailOutbox({
        status: statusFilter || undefined,
        template: templateFilter || undefined,
        to_email: toQuery || undefined,
        limit: OUTBOX_PAGE_SIZE,
        offset: nextOffset,
      });
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setListErr(apiErrorMessage(e, t("listFail")));
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, [apiErrorMessage, statusFilter, t, templateFilter, toQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr("");
    try {
      const data = await api.adminMailConfig();
      apply(data);
    } catch (e) {
      setLoadErr(apiErrorMessage(e, t("loadFail")));
    } finally {
      setLoading(false);
    }
  }, [apiErrorMessage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadList(offset);
  }, [loadList, offset]);

  // Debounce the recipient search so each keystroke does not hit the API.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setToQuery(toFilter.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [toFilter]);

  // Only poll while something can actually change soon: a row mid-send, or a
  // pending row whose schedule is due within the next poll window. Rows parked
  // on a long backoff should not keep the tab polling for half an hour.
  const active = useMemo(() => {
    const horizon = Date.now() + 10_000;
    return rows.some((row) => (
      row.status === "sending"
      || (row.status === "pending" && new Date(row.scheduled_at).getTime() <= horizon)
    ));
  }, [rows]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      void loadList(offset, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active, loadList, offset]);

  const dirty = useMemo(() => {
    if (!cfg) return false;
    return (
      provider !== cfg.provider
      || mailFrom !== cfg.mail_from
      || mailFromName !== cfg.mail_from_name
      || workerEnabled !== cfg.worker_enabled
    );
  }, [cfg, provider, mailFrom, mailFromName, workerEnabled]);

  const serverHas = (code: MailProvider) => (
    code === "log"
    || (code === "smtp" && Boolean(cfg?.smtp_host_configured))
    || (code === "resend" && Boolean(cfg?.resend_api_key_configured))
  );

  const save = async () => {
    if (!cfg) return;
    const body: MailConfigUpdate = {};
    if (provider !== cfg.provider) body.provider = provider;
    if (mailFrom !== cfg.mail_from) body.mail_from = mailFrom;
    if (mailFromName !== cfg.mail_from_name) body.mail_from_name = mailFromName;
    if (workerEnabled !== cfg.worker_enabled) body.worker_enabled = workerEnabled;
    setSaving(true);
    try {
      const next = await api.adminUpdateMailConfig(body);
      apply(next);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("saveFail")));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (cfg) apply(cfg);
  };

  const reset = async () => {
    if (!window.confirm(t("resetConfirm"))) return;
    setSaving(true);
    try {
      const next = await api.adminResetMailConfigToEnv();
      apply(next);
      toast.success(t("resetDone"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("resetFail")));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestNotice(null);
    try {
      const loc = locale === "en" ? "en" : "vi";
      const result = await api.adminSendTestMail(testTo.trim(), loc);
      setTestNotice({
        tone: "good",
        text: result.logged_only ? t("testLogged") : t("testSent", { to: testTo.trim() }),
      });
      await loadList(offset);
    } catch (e) {
      setTestNotice({ tone: "bad", text: apiErrorMessage(e, t("testFail")) });
      await loadList(offset);
    } finally {
      setTesting(false);
    }
  };

  const retry = async (id: number) => {
    setListErr("");
    setListMsg("");
    setRetryingId(id);
    try {
      await api.adminRetryMailOutbox(id);
      setListMsg(t("retryDone", { id }));
      await loadList(offset);
    } catch (e) {
      setListErr(apiErrorMessage(e, t("retryFail")));
    } finally {
      setRetryingId(null);
    }
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className="rounded-card border border-bad/25 bg-bad-soft px-4 py-3 text-[13px] text-bad" role="alert">
        <p>{loadErr || t("loadFail")}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>
          {t("refresh")}
        </Button>
      </div>
    );
  }

  const savedMode = cfg.effective_mode;
  const savedReady = cfg.effective_ready;
  const statusTone: "good" | "warn" | "neutral" = !savedReady
    ? "warn"
    : savedMode === "log" ? "neutral" : "good";
  const statusTitle = !savedReady
    ? t("status.notReady")
    : savedMode === "log"
      ? t("status.logOnly")
      : t("status.sendingVia", { channel: t(`providers.${savedMode}`) });
  const statusDetail = !savedReady
    ? (cfg.provider === "log"
      ? t("status.reasonNone")
      : !cfg.mail_from.trim()
        ? t("status.reasonFrom")
        : cfg.provider === "smtp" ? t("status.reasonSmtpHost") : t("status.reasonResendKey"))
    : savedMode === "log"
      ? t("status.logOnlyDetail")
      : `${cfg.mail_from_name} <${cfg.mail_from}>`;

  const testBlockedReason = dirty
    ? t("testBlockedDirty")
    : !savedReady
      ? t("testBlockedNotReady")
      : "";

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + rows.length, total);
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  });
  const formatTime = (value: string | null) => value ? timeFormatter.format(new Date(value)) : "—";

  return (
    <div className="space-y-4">
      {/* Status + test send: answers "is mail working right now?" before anything else. */}
      <section className="rounded-card border border-line bg-card shadow-card">
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={statusTone}>{statusTitle}</Tag>
              {!cfg.worker_enabled && <Tag tone="warn">{t("status.workerOff")}</Tag>}
              {dirty && <Tag tone="iris">{t("status.unsaved")}</Tag>}
            </div>
            <p className="mt-2 text-[15px] font-medium leading-snug text-fg">{statusDetail}</p>
            {savedReady && savedMode === "smtp" && cfg.smtp_host && (
              <p className="mt-1 break-all font-mono text-[12px] text-muted">{cfg.smtp_host}:{cfg.smtp_port}</p>
            )}
          </div>

          <div className="min-w-0 lg:border-l lg:border-line lg:pl-6">
            <h2 className="text-[13px] font-semibold text-fg">{t("testTitle")}</h2>
            
            <div className="mt-2 flex gap-2">
              <Input
                id="mail-test-to"
                name="test_to"
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder={t("testPlaceholder")}
                aria-label={t("testTitle")}
                className="h-9 min-w-0 flex-1"
                disabled={Boolean(testBlockedReason)}
              />
              <Button
                size="md"
                className="h-9"
                onClick={() => void sendTest()}
                disabled={testing || Boolean(testBlockedReason) || !testTo.trim()}
              >
                {testing ? t("sending") : t("sendTest")}
              </Button>
            </div>
            <div className="mt-2 min-h-[1.25rem]">
              {testBlockedReason ? (
                <p className="flex items-start gap-1.5 text-[12px] leading-snug text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{testBlockedReason}</span>
                </p>
              ) : (
                <NoticeLine notice={testNotice} />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Setup: three real steps, in the order a new admin has to do them. The save bar sticks only while this block is on screen. */}
      <div className="space-y-4">
      <section className="rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line bg-raised/40 px-5 py-3">
          <h2 className="text-[13.5px] font-semibold text-fg">{t("setupTitle")}</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-muted">{t("setupHint")}</p>
        </div>

        <ol className="divide-y divide-line">
          <li className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-x-10">
            <div>
              <h3 className="text-[13px] font-semibold text-fg">
                <span className="mr-2 font-mono text-[12px] text-faint">1</span>
                {t("step.channel")}
              </h3>
              
            </div>
            <div role="radiogroup" aria-label={t("step.channel")} className="overflow-hidden rounded-lg border border-line">
              {PROVIDER_ORDER.map((code) => {
                const selected = provider === code;
                const available = serverHas(code);
                const inputId = `mail-provider-${code}`;
                return (
                  <label
                    key={code}
                    htmlFor={inputId}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 border-b border-line px-3 py-3 transition-colors last:border-b-0",
                      selected ? "bg-iris-soft" : "bg-surface hover:bg-raised",
                    )}
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name="mail_provider"
                      value={code}
                      checked={selected}
                      onChange={() => setProvider(code)}
                      className="mt-1 h-4 w-4 shrink-0 accent-iris"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={cn("text-[13px] font-medium", selected ? "text-iris-hi" : "text-fg")}>
                          {t(`providers.${code}`)}
                        </span>
                        {code !== "log" && (
                          <Tag tone={available ? "good" : "warn"}>
                            {available ? t("channel.serverReady") : t("channel.serverMissing")}
                          </Tag>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                        {t(`channel.${code}`)}
                      </span>
                      {code === "smtp" && cfg.smtp_host && (
                        <span className="mt-1 block break-all font-mono text-[11.5px] text-muted">
                          {cfg.smtp_host}:{cfg.smtp_port}
                          {" · "}
                          {cfg.smtp_credentials_configured ? t("channel.smtpAuthSet") : t("channel.smtpAuthNone")}
                        </span>
                      )}
                      {code !== "log" && !available && (
                        <span className="mt-1 block text-[12px] leading-snug text-warn">
                          {t(`channel.${code}Fix`)}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </li>

          <li className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-x-10">
            <div>
              <h3 className="text-[13px] font-semibold text-fg">
                <span className="mr-2 font-mono text-[12px] text-faint">2</span>
                {t("step.sender")}
              </h3>
              <p className="mt-1 text-[12px] leading-snug text-muted">{t("step.senderHint")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <Field label={t("fromName")}>
                <Input
                  id="mail-from-name"
                  name="mail_from_name"
                  value={mailFromName}
                  onChange={(e) => setMailFromName(e.target.value)}
                  placeholder="GMMO"
                  className="h-9"
                />
              </Field>
              <Field
                label={t("fromEmail")}
                hint={t("fromEmailHint")}
                error={provider !== "log" && !mailFrom.trim() ? t("fromEmailRequired") : undefined}
              >
                <Input
                  id="mail-from-email"
                  name="mail_from"
                  type="email"
                  value={mailFrom}
                  onChange={(e) => setMailFrom(e.target.value)}
                  placeholder="noreply@gmmo.info"
                  className="h-9 font-mono"
                  aria-invalid={provider !== "log" && !mailFrom.trim()}
                />
              </Field>
            </div>
          </li>

          <li className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-x-10">
            <div>
              <h3 className="text-[13px] font-semibold text-fg">
                <span className="mr-2 font-mono text-[12px] text-faint">3</span>
                {t("step.worker")}
              </h3>
            </div>
            <div>
              <SettingsToggle checked={workerEnabled} onChange={setWorkerEnabled} disabled={saving} label={t("worker")} />
              <p className="mt-1.5 text-[12px] leading-snug text-muted">{t("workerHint")}</p>
            </div>
          </li>
        </ol>

      </section>
      <SettingsFooter
        dirty={dirty}
        valid={provider === "log" || Boolean(mailFrom.trim())}
        saving={saving}
        onReset={discard}
        onSave={() => void save()}
        extra={(
          <button type="button" onClick={() => void reset()} disabled={saving} className="text-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50">
            {t("reset")}
          </button>
        )}
      />
      </div>

      <MailTemplateEditor />

      <section className="rounded-card border border-line bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("outboxTitle")}</h2>
            <p className="mt-0.5 text-[12px] text-muted">{t("outboxHint", { total })}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex basis-full flex-col text-[12px] text-muted sm:basis-[13rem]">
              {t("toFilter")}
              <Input
                id="mail-to-filter"
                name="to_email"
                type="search"
                value={toFilter}
                onChange={(e) => setToFilter(e.target.value)}
                placeholder={t("toFilterPlaceholder")}
                className="mt-1 h-9 w-full"
              />
            </label>
            <label className="flex min-w-[8rem] flex-1 flex-col text-[12px] text-muted sm:flex-none sm:basis-[11rem]">
              {t("templateFilter")}
              <Select
                id="mail-template-filter"
                name="template"
                value={templateFilter}
                onChange={(e) => {
                  setOffset(0);
                  setTemplateFilter(e.target.value);
                }}
                className="mt-1 h-9 w-full"
              >
                <option value="">{t("templateAll")}</option>
                {MAIL_TEMPLATE_IDS.map((name) => (
                  <option key={name} value={name}>{t(`tplNames.${name}`)}</option>
                ))}
              </Select>
            </label>
            <label className="flex min-w-[7rem] flex-1 flex-col text-[12px] text-muted sm:flex-none sm:basis-[8rem]">
              {t("statusFilter")}
              <Select
                id="mail-status-filter"
                name="status"
                value={statusFilter}
                onChange={(e) => {
                  setOffset(0);
                  setStatusFilter(e.target.value);
                }}
                className="mt-1 h-9 w-full"
              >
                <option value="">{t("statusAll")}</option>
                <option value="pending">{t("status.pending")}</option>
                <option value="sending">{t("status.sending")}</option>
                <option value="sent">{t("status.sent")}</option>
                <option value="failed">{t("status.failed")}</option>
              </Select>
            </label>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void loadList(offset)}
              disabled={refreshing}
            >
              {refreshing ? t("refreshing") : t("refresh")}
            </Button>
          </div>
        </div>

        {listErr && (
          <p className="mt-2 rounded-md border border-bad/25 bg-bad-soft px-2.5 py-1.5 text-[12px] text-bad" role="alert">
            {listErr}
          </p>
        )}
        {listMsg && (
          <p className="mt-2 rounded-md border border-good/25 bg-good-soft px-2.5 py-1.5 text-[12px] text-good" role="status">
            {listMsg}
          </p>
        )}

        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                <th className="py-2 pr-3">{t("colId")}</th>
                <th className="py-2 pr-3">{t("colTemplate")}</th>
                <th className="py-2 pr-3">{t("colTo")}</th>
                <th className="py-2 pr-3">{t("colStatus")}</th>
                <th className="py-2 pr-3">{t("colAttempts")}</th>
                <th className="py-2 pr-3">{t("colTime")}</th>
                <th className="py-2 pr-3">{t("colError")}</th>
                <th className="py-2">{t("colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted">{t("empty")}</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 font-mono tabular-nums">{row.id}</td>
                    <td className="py-2 pr-3 text-[12px]">{t(`tplNames.${row.template}`)}</td>
                    <td className="py-2 pr-3">{row.to_email}</td>
                    <td className="py-2 pr-3">
                      <Tag
                        tone={
                          row.status === "sent"
                            ? "good"
                            : row.status === "failed"
                              ? "bad"
                              : "neutral"
                        }
                      >
                        {t(`status.${row.status}`)}
                      </Tag>
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{row.attempts}</td>
                    <td
                      className="whitespace-nowrap py-2 pr-3 font-mono text-[11px] tabular-nums text-muted"
                      title={t("timeTitle", {
                        created: formatTime(row.created_at),
                        scheduled: formatTime(row.scheduled_at),
                        sent: formatTime(row.sent_at),
                      })}
                    >
                      {formatTime(row.sent_at ?? row.scheduled_at)}
                    </td>
                    <td className="max-w-[14rem] truncate py-2 pr-3 text-[12px] text-muted" title={row.last_error ?? ""}>
                      {row.last_error ?? "—"}
                    </td>
                    <td className="py-2">
                      {(row.status === "failed" || row.status === "pending") && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void retry(row.id)}
                          disabled={retryingId === row.id}
                        >
                          {retryingId === row.id ? t("retrying") : t("retry")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 divide-y divide-line border-y border-line md:hidden">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted">{t("empty")}</p>
          ) : (
            rows.map((row) => (
              <article key={row.id} className="space-y-3 py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] tabular-nums text-muted">#{row.id}</p>
                    <p className="mt-0.5 break-words text-[13px] font-medium text-fg">{t(`tplNames.${row.template}`)}</p>
                  </div>
                  <Tag
                    tone={
                      row.status === "sent"
                        ? "good"
                        : row.status === "failed"
                          ? "bad"
                          : "neutral"
                    }
                  >
                    {t(`status.${row.status}`)}
                  </Tag>
                </div>
                <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
                  <dt className="text-muted">{t("colTo")}</dt>
                  <dd className="min-w-0 break-all text-fg">{row.to_email}</dd>
                  <dt className="text-muted">{t("colAttempts")}</dt>
                  <dd className="font-mono tabular-nums text-fg">{row.attempts}</dd>
                  <dt className="text-muted">{t("colTime")}</dt>
                  <dd className="font-mono text-[11px] tabular-nums text-fg">
                    {formatTime(row.sent_at ?? row.scheduled_at)}
                  </dd>
                  <dt className="text-muted">{t("colError")}</dt>
                  <dd className="min-w-0 break-words text-fg">{row.last_error ?? "—"}</dd>
                </dl>
                {(row.status === "failed" || row.status === "pending") && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void retry(row.id)}
                      disabled={retryingId === row.id}
                    >
                      {retryingId === row.id ? t("retrying") : t("retry")}
                    </Button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
        {total > OUTBOX_PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-[12px] text-muted">{t("pageRange", { start: pageStart, end: pageEnd, total })}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={offset === 0 || refreshing}
                onClick={() => setOffset((value) => Math.max(0, value - OUTBOX_PAGE_SIZE))}
              >
                {t("previous")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={offset + OUTBOX_PAGE_SIZE >= total || refreshing}
                onClick={() => setOffset((value) => value + OUTBOX_PAGE_SIZE)}
              >
                {t("next")}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
