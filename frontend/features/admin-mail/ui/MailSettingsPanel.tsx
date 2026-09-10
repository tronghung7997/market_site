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
import { Button, Input, Select, Spinner, Tag } from "@/components/ui";

const OUTBOX_PAGE_SIZE = 25;
import { MailTemplateEditor } from "./MailTemplateEditor";

function secretTone(ok: boolean): "good" | "warn" {
  return ok ? "good" : "warn";
}

export function MailSettingsPanel() {
  const t = useTranslations("adminMail");
  const apiErrorMessage = useApiErrorMessage();
  const locale = useLocale();
  const [cfg, setCfg] = useState<MailConfigAdmin | null>(null);
  const [provider, setProvider] = useState<MailProvider>("log");
  const [mailFrom, setMailFrom] = useState("");
  const [mailFromName, setMailFromName] = useState("Proxora");
  const [workerEnabled, setWorkerEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [testTo, setTestTo] = useState("");
  const [rows, setRows] = useState<MailOutboxRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
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

  const loadList = useCallback(async (status: string, nextOffset: number, quiet = false) => {
    setListErr("");
    if (!quiet) setRefreshing(true);
    try {
      const data = await api.adminMailOutbox({
        status: status || undefined,
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
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await api.adminMailConfig();
      apply(data);
    } catch (e) {
      setErr(apiErrorMessage(e, t("loadFail")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadList(statusFilter, offset);
  }, [loadList, statusFilter, offset]);

  useEffect(() => {
    if (!rows.some((row) => row.status === "pending" || row.status === "sending")) return;
    const timer = window.setInterval(() => {
      void loadList(statusFilter, offset, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadList, offset, rows, statusFilter]);

  const dirty = useMemo(() => {
    if (!cfg) return false;
    return (
      provider !== cfg.provider
      || mailFrom !== cfg.mail_from
      || mailFromName !== cfg.mail_from_name
      || workerEnabled !== cfg.worker_enabled
    );
  }, [cfg, provider, mailFrom, mailFromName, workerEnabled]);

  const selectedReady = Boolean(
    mailFrom.trim()
    && (
      provider === "log"
      || (provider === "resend" && cfg?.resend_api_key_configured)
      || (provider === "smtp" && cfg?.smtp_host_configured)
    )
  );

  const save = async () => {
    if (!cfg) return;
    const body: MailConfigUpdate = {};
    if (provider !== cfg.provider) body.provider = provider;
    if (mailFrom !== cfg.mail_from) body.mail_from = mailFrom;
    if (mailFromName !== cfg.mail_from_name) body.mail_from_name = mailFromName;
    if (workerEnabled !== cfg.worker_enabled) body.worker_enabled = workerEnabled;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const next = await api.adminUpdateMailConfig(body);
      apply(next);
      setMsg(t("saved"));
    } catch (e) {
      setErr(apiErrorMessage(e, t("saveFail")));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm(t("resetConfirm"))) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const next = await api.adminResetMailConfigToEnv();
      apply(next);
      setMsg(t("resetDone"));
    } catch (e) {
      setErr(apiErrorMessage(e, t("resetFail")));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setMsg("");
    setErr("");
    try {
      const loc = locale === "en" ? "en" : "vi";
      const result = await api.adminSendTestMail(testTo.trim(), loc);
      setMsg(
        result.logged_only
          ? t("testLogged", { status: result.status })
          : t("testSent", { status: result.status }),
      );
      await loadList(statusFilter, offset);
    } catch (e) {
      setErr(apiErrorMessage(e, t("testFail")));
      await loadList(statusFilter, offset);
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
      await loadList(statusFilter, offset);
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

  const mode = cfg?.effective_mode ?? "unconfigured";
  const modeTone = mode === "unconfigured" ? "warn" : "neutral";
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + rows.length, total);
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  });
  const formatTime = (value: string | null) => value ? timeFormatter.format(new Date(value)) : "—";

  return (
    <div className="space-y-3.5">
      <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="grid gap-0 lg:grid-cols-2">
          <div className="min-w-0 border-b border-line p-4 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("title")}</h2>
              <Tag tone={modeTone}>{t(`mode.${mode}`)}</Tag>
            </div>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">{t("hint")}</p>

            <fieldset className="mt-3">
              <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t("provider")}
              </legend>
              <div className="mt-1.5 inline-flex flex-wrap gap-1" role="group">
                {(["log", "smtp", "resend"] as const).map((code) => (
                  <Button
                    key={code}
                    type="button"
                    size="sm"
                    variant={provider === code ? "primary" : "ghost"}
                    aria-pressed={provider === code}
                    onClick={() => setProvider(code)}
                  >
                    {t(`providers.${code}`)}
                  </Button>
                ))}
              </div>
            </fieldset>

            <label className="mt-3 block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t("fromName")}
              </span>
              <Input
                id="mail-from-name"
                name="mail_from_name"
                value={mailFromName}
                onChange={(e) => setMailFromName(e.target.value)}
                className="mt-1 h-9"
              />
            </label>
            <label className="mt-2.5 block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t("fromEmail")}
              </span>
              <Input
                id="mail-from-email"
                name="mail_from"
                type="email"
                value={mailFrom}
                onChange={(e) => setMailFrom(e.target.value)}
                placeholder="noreply@mail.example.com"
                className="mt-1 h-9 font-mono"
              />
            </label>

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-fg">{t("worker")}</div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">{t("workerHint")}</p>
              </div>
              <Input
                id="mail-worker-enabled"
                name="worker_enabled"
                type="checkbox"
                checked={workerEnabled}
                disabled={saving}
                aria-label={t("worker")}
                onChange={(e) => setWorkerEnabled(e.target.checked)}
                className="h-4 w-4 accent-iris"
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col p-4">
            <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("secretsTitle")}</h2>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">{t("secretsHint")}</p>
            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">{t("resendKey")}</dt>
                <dd>
                  <Tag tone={secretTone(Boolean(cfg?.resend_api_key_configured))}>
                    {cfg?.resend_api_key_configured ? t("configured") : t("missing")}
                  </Tag>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">{t("smtpHost")}</dt>
                <dd className="font-mono text-[12px] text-fg">
                  {cfg?.smtp_host ? `${cfg.smtp_host}:${cfg.smtp_port}` : t("missing")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">{t("smtpAuth")}</dt>
                <dd>
                  <Tag tone={secretTone(Boolean(cfg?.smtp_credentials_configured))}>
                    {cfg?.smtp_credentials_configured ? t("configured") : t("missing")}
                  </Tag>
                </dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-muted">{t("frontendBase")}</dt>
                <dd className="max-w-[60%] break-all text-right font-mono text-[12px] text-fg">
                  {cfg?.frontend_base_url}
                </dd>
              </div>
            </dl>

            <div className="mt-4 border-t border-line pt-3">
              <h3 className="text-[13px] font-medium text-fg">{t("testTitle")}</h3>
              <p className="mt-0.5 text-[11px] leading-snug text-muted">{t("testHint")}</p>
              {dirty && (
                <p className="mt-1 text-[11px] text-warn" role="status">{t("saveBeforeTest")}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Input
                  id="mail-test-to"
                  name="test_to"
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder={t("testPlaceholder")}
                  className="h-9 min-w-0 flex-1"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void sendTest()}
                  disabled={testing || dirty || !testTo.trim() || !selectedReady}
                >
                  {testing ? t("sending") : t("sendTest")}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {(msg || err) && (
          <div className="space-y-1 border-t border-line px-4 py-2.5">
            {msg && (
              <p className="rounded-md border border-good/25 bg-good-soft px-2.5 py-1.5 text-[12px] text-good" role="status">
                {msg}
              </p>
            )}
            {err && (
              <p className="rounded-md border border-bad/25 bg-bad-soft px-2.5 py-1.5 text-[12px] text-bad" role="alert">
                {err}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-2.5">
          <Button size="sm" variant="secondary" onClick={() => void reset()} disabled={saving}>
            {t("reset")}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </section>

      <MailTemplateEditor />

      <section className="rounded-card border border-line bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("outboxTitle")}</h2>
            <p className="mt-0.5 text-[12px] text-muted">{t("outboxHint", { total })}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-muted">
              {t("statusFilter")}
              <Select
                id="mail-status-filter"
                name="status"
                value={statusFilter}
                onChange={(e) => {
                  setOffset(0);
                  setStatusFilter(e.target.value);
                }}
                className="mt-1 h-9 w-auto min-w-[8rem]"
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
              onClick={() => void loadList(statusFilter, offset)}
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
                    <td className="py-2 pr-3 font-mono text-[12px]">{row.template}</td>
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
                    <p className="mt-0.5 break-words font-mono text-[12px] font-medium text-fg">{row.template}</p>
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
