"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { DepositRailConfigAdmin, DepositRailConfigUpdate } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Button, Field, InlineNotice, Input, Spinner, Switch, Tag } from "@/components/ui";
import { AlertCircle, CheckCircle2 } from "@/components/Icons";

type RailKey = "sepay" | "nowpayments";

function railState(enabled: boolean, secrets: boolean, effective: boolean): "live" | "missing" | "off" {
  if (effective) return "live";
  if (enabled && !secrets) return "missing";
  return "off";
}

const STATE_TONE = { live: "good", missing: "warn", off: "neutral" } as const;

function NumberInput({
  id, value, onChange, disabled, suffix, invalid,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  suffix: string;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        value={Number.isFinite(value) ? value.toLocaleString("en-US") : ""}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(digits ? parseInt(digits, 10) : 0);
        }}
        className={cn("h-9 pr-14 text-right font-mono text-[13px] tabular-nums", invalid && "border-bad")}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted">
        {suffix}
      </span>
    </div>
  );
}

function ServerCheck({ ok, label, fix }: { ok: boolean; label: string; fix: string }) {
  return (
    <div className="flex items-start gap-1.5 text-[12px]">
      {ok
        ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
        : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />}
      <span className={ok ? "text-muted" : "text-warn"}>
        {label}
        {!ok && <span className="block text-[11.5px] leading-snug">{fix}</span>}
      </span>
    </div>
  );
}

export function DepositRailsPanel() {
  const t = useTranslations("adminDeposits");
  const apiErrorMessage = useApiErrorMessage();
  const [rail, setRail] = useState<DepositRailConfigAdmin | null>(null);
  const [draft, setDraft] = useState<DepositRailConfigUpdate>({});
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr("");
    try {
      setRail(await api.adminDepositRailConfig());
      setDraft({});
    } catch (e) {
      setLoadErr(apiErrorMessage(e, t("loadFail")));
    } finally {
      setLoading(false);
    }
  }, [apiErrorMessage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = Object.keys(draft).length > 0;

  const v = <K extends keyof DepositRailConfigUpdate>(key: K): NonNullable<DepositRailConfigUpdate[K]> => {
    const d = draft[key];
    if (d !== undefined && d !== null) return d as NonNullable<DepositRailConfigUpdate[K]>;
    return rail![key] as NonNullable<DepositRailConfigUpdate[K]>;
  };

  const set = <K extends keyof DepositRailConfigUpdate>(key: K, value: DepositRailConfigUpdate[K]) => {
    setDraft((d) => {
      if (rail && rail[key] === value) {
        const rest = { ...d };
        delete rest[key];
        return rest;
      }
      return { ...d, [key]: value };
    });
  };

  const problems: string[] = [];
  if (rail) {
    if (v("deposit_min_amount") >= v("deposit_max_amount")) problems.push(t("errors.sepayRange"));
    if (v("deposit_usdt_min_vnd") >= v("deposit_usdt_max_vnd")) problems.push(t("errors.usdtRange"));
    if (v("sepay_enabled") && !String(v("sepay_bank_account_number")).trim()) problems.push(t("errors.sepayAccount"));
  }

  const save = async () => {
    if (!rail || !dirty || problems.length > 0) return;
    setSaving(true);
    setNotice(null);
    try {
      setRail(await api.updateDepositRailConfig(draft));
      setDraft({});
      setNotice({ tone: "good", text: t("saved") });
    } catch (e) {
      setNotice({ tone: "bad", text: apiErrorMessage(e, t("saveFail")) });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm(t("resetConfirm"))) return;
    setSaving(true);
    setNotice(null);
    try {
      setRail(await api.resetDepositRailConfig());
      setDraft({});
      setNotice({ tone: "good", text: t("resetDone") });
    } catch (e) {
      setNotice({ tone: "bad", text: apiErrorMessage(e, t("resetFail")) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!rail) {
    return (
      <div className="rounded-card border border-bad/25 bg-bad-soft px-4 py-3 text-[13px] text-bad" role="alert">
        <p>{loadErr || t("loadFail")}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  // Summary reflects saved state; the cards below reflect the draft.
  const saved: Record<RailKey, "live" | "missing" | "off"> = {
    sepay: railState(rail.sepay_enabled, rail.sepay_secrets_configured, rail.effective_sepay_enabled),
    nowpayments: railState(rail.nowpayments_enabled, rail.nowpayments_secrets_configured, rail.effective_nowpayments_enabled),
  };
  const liveCount = Object.values(saved).filter((s) => s === "live").length;

  const railCard = (key: RailKey) => {
    const enabledKey = key === "sepay" ? "sepay_enabled" : "nowpayments_enabled";
    const enabled = Boolean(v(enabledKey));
    const secrets = key === "sepay" ? rail.sepay_secrets_configured : rail.nowpayments_secrets_configured;
    const reconcile = key === "sepay" ? rail.sepay_reconciliation_configured : rail.nowpayments_reconciliation_configured;
    const draftState = railState(enabled, secrets, enabled && secrets);
    return (
      <article className="rounded-card border border-line bg-card shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-semibold text-fg">{t(`${key}.title`)}</h3>
              <Tag tone={STATE_TONE[draftState]}>{t(`state.${draftState}`)}</Tag>
            </div>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">{t(`${key}.hint`)}</p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-[12px] font-medium text-fg">
            <span>{enabled ? t("enabled") : t("disabled")}</span>
            <Switch checked={enabled} onChange={(x) => set(enabledKey, x)} disabled={saving} label={t(`${key}.title`)} />
          </label>
        </div>

        <div className="space-y-2 border-b border-line bg-surface px-4 py-3">
          <ServerCheck ok={secrets} label={t(`${key}.secrets`)} fix={t(`${key}.secretsFix`)} />
          <ServerCheck ok={reconcile} label={t(`${key}.reconcile`)} fix={t(`${key}.reconcileFix`)} />
        </div>

        <div className="space-y-4 px-4 py-4">
          {key === "sepay" && (
            <div>
              <h4 className="text-[12px] font-semibold text-fg">{t("sepay.bankSection")}</h4>
              <p className="mt-0.5 text-[12px] text-muted">{t("sepay.bankSectionHint")}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={t("sepay.bankCode")} hint={t("sepay.bankCodeHint")}>
                  <Input
                    id="sepay-bank-code"
                    value={String(v("sepay_bank_code"))}
                    onChange={(e) => set("sepay_bank_code", e.target.value)}
                    disabled={saving}
                    placeholder="MB"
                    className="h-9 font-mono uppercase"
                  />
                </Field>
                <Field
                  label={t("sepay.accountNumber")}
                  hint={t("sepay.accountNumberHint")}
                  error={enabled && !String(v("sepay_bank_account_number")).trim() ? t("errors.sepayAccount") : undefined}
                >
                  <Input
                    id="sepay-account-number"
                    value={String(v("sepay_bank_account_number"))}
                    onChange={(e) => set("sepay_bank_account_number", e.target.value)}
                    disabled={saving}
                    className="h-9 font-mono"
                  />
                </Field>
                <Field label={t("sepay.accountName")}>
                  <Input
                    id="sepay-account-name"
                    value={String(v("sepay_bank_account_name"))}
                    onChange={(e) => set("sepay_bank_account_name", e.target.value)}
                    disabled={saving}
                    className="h-9"
                  />
                </Field>
                <Field label={t("sepay.accountId")} hint={t("sepay.accountIdHint")}>
                  <Input
                    id="sepay-account-id"
                    value={String(v("sepay_bank_account_id"))}
                    onChange={(e) => set("sepay_bank_account_id", e.target.value)}
                    disabled={saving}
                    className="h-9 font-mono text-[12px]"
                  />
                </Field>
              </div>
            </div>
          )}

          <div>
            <h4 className="text-[12px] font-semibold text-fg">{t("limits.title")}</h4>
            
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t("limits.min")}>
                <NumberInput
                  id={`${key}-min`}
                  value={Number(v(key === "sepay" ? "deposit_min_amount" : "deposit_usdt_min_vnd"))}
                  onChange={(n) => set(key === "sepay" ? "deposit_min_amount" : "deposit_usdt_min_vnd", n)}
                  disabled={saving}
                  suffix="VND"
                />
              </Field>
              <Field
                label={t("limits.max")}
                error={
                  Number(v(key === "sepay" ? "deposit_min_amount" : "deposit_usdt_min_vnd"))
                    >= Number(v(key === "sepay" ? "deposit_max_amount" : "deposit_usdt_max_vnd"))
                    ? t("errors.rangeShort")
                    : undefined
                }
              >
                <NumberInput
                  id={`${key}-max`}
                  value={Number(v(key === "sepay" ? "deposit_max_amount" : "deposit_usdt_max_vnd"))}
                  onChange={(n) => set(key === "sepay" ? "deposit_max_amount" : "deposit_usdt_max_vnd", n)}
                  disabled={saving}
                  suffix="VND"
                  invalid={
                    Number(v(key === "sepay" ? "deposit_min_amount" : "deposit_usdt_min_vnd"))
                    >= Number(v(key === "sepay" ? "deposit_max_amount" : "deposit_usdt_max_vnd"))
                  }
                />
              </Field>
            </div>
          </div>

          <div>
            <h4 className="text-[12px] font-semibold text-fg">{t("timing.title")}</h4>
            
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t(`timing.${key}Expire`)} hint={t(`timing.${key}ExpireHint`) || undefined}>
                <NumberInput
                  id={`${key}-expire`}
                  value={Number(v(key === "sepay" ? "deposit_expire_minutes" : "deposit_usdt_local_window_minutes"))}
                  onChange={(n) => set(key === "sepay" ? "deposit_expire_minutes" : "deposit_usdt_local_window_minutes", n)}
                  disabled={saving}
                  suffix={t("unitMin")}
                />
              </Field>
              <Field label={t("timing.reconcile")} hint={t(`timing.${key}ReconcileHint`)}>
                <NumberInput
                  id={`${key}-reconcile`}
                  value={Number(v(key === "sepay" ? "deposit_reconcile_retention_hours" : "deposit_usdt_reconcile_retention_hours"))}
                  onChange={(n) => set(key === "sepay" ? "deposit_reconcile_retention_hours" : "deposit_usdt_reconcile_retention_hours", n)}
                  disabled={saving}
                  suffix={t("unitHour")}
                />
              </Field>
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-line bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={saved.sepay === "live" ? "good" : STATE_TONE[saved.sepay]}>
            {t("sepay.title")}: {t(`state.${saved.sepay}`)}
          </Tag>
          <Tag tone={saved.nowpayments === "live" ? "good" : STATE_TONE[saved.nowpayments]}>
            {t("nowpayments.title")}: {t(`state.${saved.nowpayments}`)}
          </Tag>
          {dirty && <Tag tone="warn">{t("unsaved")}</Tag>}
        </div>
        <p className="mt-2 text-[15px] font-medium leading-snug text-fg">
          {liveCount === 0 ? t("summary.none") : liveCount === 1 ? t("summary.one") : t("summary.both")}
        </p>
        <p className="mt-1 text-[12px] text-muted">{t("summary.order")}</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {railCard("sepay")}
        {railCard("nowpayments")}
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          {notice && (
            <InlineNotice
              tone={notice.tone}
              icon={notice.tone === "good" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            >
              {notice.text}
            </InlineNotice>
          )}
          {!notice && problems.length > 0 && problems.map((p) => (
            <InlineNotice key={p} tone="bad" icon={<AlertCircle className="h-3.5 w-3.5" />}>{p}</InlineNotice>
          ))}
          {!notice && problems.length === 0 && (
            <button
              type="button"
              onClick={() => void reset()}
              disabled={saving}
              className="text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50"
            >
              {t("reset")}
            </button>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => { setDraft({}); setNotice(null); }} disabled={saving}>
              {t("discard")}
            </Button>
          )}
          <Button size="sm" onClick={() => void save()} disabled={saving || !dirty || problems.length > 0}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
