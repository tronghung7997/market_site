"use client";

/**
 * Admin: FX rate + default display currency + language/currency switcher flags.
 * VND ledger is never touched — only buyer-facing display prefs.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { MoneyConfigAdmin } from "@/lib/types";
import {
  formatBrowseMoney,
  formatLedgerMoney,
  type DisplayCurrency,
} from "@/lib/money";
import { cn } from "@/lib/cn";
import { Button, Card, Spinner } from "@/components/ui";

const PREVIEW_AMOUNT_VND = 50_000;

function formatRateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}

/** Flat setting row: title + description left, control right. No nested cards. */
function SettingRow({
  label,
  description,
  children,
  className,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-fg">{label}</div>
        <p className="mt-0.5 text-[12px] text-muted leading-snug">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 rounded-full border transition-[background-color,border-color] duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
        checked ? "bg-iris border-iris" : "bg-raised border-line",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm",
          "transition-transform duration-200",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

export default function AdminDisplaySettingsPage() {
  const t = useTranslations("currency");
  const locale = useLocale();
  const [cfg, setCfg] = useState<MoneyConfigAdmin | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [currencyDefault, setCurrencyDefault] = useState<DisplayCurrency>("USD");
  const [allowCurrencyToggle, setAllowCurrencyToggle] = useState(true);
  const [allowLocaleToggle, setAllowLocaleToggle] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const applyCfg = (data: MoneyConfigAdmin) => {
    setCfg(data);
    setRateInput(data.display_fx_rate != null ? String(data.display_fx_rate) : "");
    setCurrencyDefault(data.display_currency_default);
    setAllowCurrencyToggle(data.allow_user_toggle);
    setAllowLocaleToggle(data.allow_locale_toggle);
  };

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await api.adminMoneyConfig();
      applyCfg(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rateNum = useMemo(() => {
    const n = parseInt(rateInput, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [rateInput]);

  const previewText = useMemo(() => {
    if (rateNum == null) return null;
    return formatBrowseMoney(PREVIEW_AMOUNT_VND, {
      locale,
      currency: "USD",
      fxRate: rateNum,
    });
  }, [rateNum, locale]);

  const sourceLabel =
    cfg?.source === "db"
      ? t("adminSourceDb")
      : cfg?.source === "env"
        ? t("adminSourceEnv")
        : t("adminSourceNone");

  const save = async () => {
    const rate = parseInt(rateInput, 10);
    if (!Number.isFinite(rate) || !cfg || rate < cfg.rate_min || rate > cfg.rate_max) {
      setErr(t("adminInvalid"));
      return;
    }
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      await api.adminUpdateMoneyConfig({
        display_fx_rate: rate,
        display_currency_default: currencyDefault,
        allow_user_toggle: allowCurrencyToggle,
        allow_locale_toggle: allowLocaleToggle,
      });
      setMsg(t("adminSavedAll"));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const resetRate = async () => {
    if (!cfg?.env_rate) return;
    if (!window.confirm(t("adminResetConfirm"))) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      await api.adminResetMoneyConfigToEnv();
      setMsg(t("adminResetDone", { rate: cfg.env_rate.toLocaleString() }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5 pb-20 sm:pb-6">
      {/* AdminShell already renders page title — only subtitle here */}
      <p className="text-[13px] text-muted leading-relaxed -mt-1">{t("adminSubtitle")}</p>

      {msg && (
        <div className="rounded-lg border border-good/30 bg-good-soft px-3.5 py-2.5 text-[13px] text-good">
          {msg}
        </div>
      )}
      {err && (
        <div className="rounded-lg border border-bad/30 bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">
          {err}
        </div>
      )}

      {/* Current display rate */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight">{t("adminRateCardTitle")}</h2>
            <p className="mt-0.5 text-[12px] text-muted">{t("adminRateCardHint")}</p>
          </div>
          <span className="inline-flex items-center rounded-full border border-line bg-raised px-2.5 py-0.5 text-[11px] font-medium text-muted">
            {sourceLabel}
          </span>
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wider text-faint font-medium mb-1.5">
            {t("adminRate")}
          </label>
          <div className="relative">
            <input
              inputMode="numeric"
              value={formatRateInput(rateInput)}
              onChange={(e) => setRateInput(e.target.value.replace(/\D/g, ""))}
              className="h-11 w-full rounded-lg border border-line bg-surface pl-3 pr-28 font-mono text-[15px] tabular-nums focus:border-iris"
              aria-describedby="admin-rate-suffix"
            />
            <span
              id="admin-rate-suffix"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint font-medium"
            >
              {t("adminRateSuffix")}
            </span>
          </div>
          {cfg && (
            <p className="mt-1.5 text-[11.5px] text-faint">
              {t("adminRange", {
                min: cfg.rate_min.toLocaleString(),
                max: cfg.rate_max.toLocaleString(),
              })}
            </p>
          )}
        </div>

        {previewText && (
          <p className="text-[13px] text-muted">
            {t("adminPreview", {
              vnd: formatLedgerMoney(PREVIEW_AMOUNT_VND, locale),
              usd: previewText,
            })}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-line">
          <div className="text-[12px] text-faint">
            <span className="text-muted">{t("adminEnvRate")}: </span>
            <span className="font-mono tabular">
              {cfg?.env_rate != null ? cfg.env_rate.toLocaleString() : "—"}
            </span>
            {cfg?.updated_at && (
              <span className="ml-2">
                · {new Date(cfg.updated_at).toLocaleString(locale === "vi" ? "vi-VN" : "en-US")}
                {cfg.updated_by_id != null && ` · #${cfg.updated_by_id}`}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={resetRate}
            disabled={saving || cfg?.env_rate == null}
          >
            {t("adminReset")}
          </Button>
        </div>

        <p className="text-[11.5px] text-faint leading-snug">{t("adminRateAffectsNote")}</p>
      </Card>

      {/* Visitor options — flat rows, two groups: currency + language */}
      <Card className="p-5">
        <div className="mb-1">
          <h2 className="text-[14px] font-semibold tracking-tight">{t("adminExperienceTitle")}</h2>
          <p className="mt-0.5 text-[12px] text-muted">{t("adminExperienceHint")}</p>
        </div>

        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-faint font-medium mb-1">
            {t("adminGroupCurrency")}
          </div>
          <div className="divide-y divide-line">
            <SettingRow
              label={t("adminDefaultCurrency")}
              description={t("adminDefaultCurrencyHint")}
            >
              <div
                className="inline-flex items-center rounded-lg border border-line bg-raised/75 p-0.5"
                role="group"
                aria-label={t("adminDefaultCurrency")}
              >
                {(["USD", "VND"] as const).map((code) => {
                  const active = currencyDefault === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setCurrencyDefault(code)}
                      aria-pressed={active}
                      className={cn(
                        "min-w-12 rounded-md px-2.5 py-1.5 text-[12px] font-bold tracking-[0.06em]",
                        "transition-[background-color,color,box-shadow] duration-200",
                        active
                          ? "bg-iris text-white shadow-[0_1px_2px_rgba(67,56,202,0.32)]"
                          : "text-faint hover:bg-surface hover:text-fg",
                      )}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            </SettingRow>
            <SettingRow
              label={t("adminShowCurrencyToggle")}
              description={t("adminShowCurrencyToggleHint")}
            >
              <Switch
                checked={allowCurrencyToggle}
                onChange={setAllowCurrencyToggle}
                disabled={saving}
                label={t("adminShowCurrencyToggle")}
              />
            </SettingRow>
          </div>
        </div>

        <div className="mt-5 pt-1">
          <div className="text-[11px] uppercase tracking-wider text-faint font-medium mb-1">
            {t("adminGroupLocale")}
          </div>
          <div className="divide-y divide-line border-t border-line">
            <SettingRow
              label={t("adminShowLocaleToggle")}
              description={t("adminShowLocaleToggleHint")}
            >
              <Switch
                checked={allowLocaleToggle}
                onChange={setAllowLocaleToggle}
                disabled={saving}
                label={t("adminShowLocaleToggle")}
              />
            </SettingRow>
          </div>
        </div>

        <div className="hidden sm:flex justify-end pt-4 mt-2 border-t border-line">
          <Button size="md" onClick={save} disabled={saving}>
            {t("adminSave")}
          </Button>
        </div>
      </Card>

      {/* Sticky save on mobile */}
      <div className="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button size="md" block onClick={save} disabled={saving}>
          {t("adminSave")}
        </Button>
      </div>
    </div>
  );
}
