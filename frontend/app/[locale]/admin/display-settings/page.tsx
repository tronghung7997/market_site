"use client";

/* Hallmark · pre-emit critique: P4 H5 E4 S5 R4 V4
 * genre: modern-minimal · macrostructure: Split Studio · tone: utilitarian
 * theme: preserved Proxora light (Newsreader / Be Vietnam Pro / JetBrains Mono, iris)
 * enrichment: none · nav: AdminShell · footer: none
 * 2026-08-13 polish: full-width, solid cards, higher control contrast
 * 2026-08-13 density: readable type, rails save at bottom of section
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { MailSettingsPanel } from "@/features/admin-mail";
import { usePathname, useRouter } from "@/i18n/navigation";
import type {
  DepositRailConfigAdmin,
  DepositRailConfigUpdate,
  MoneyConfigAdmin,
} from "@/lib/types";
import {
  formatBrowseMoney,
  formatLedgerMoney,
  type DisplayCurrency,
} from "@/lib/money";
import { cn } from "@/lib/cn";
import { Button, Spinner, Tag } from "@/components/ui";

const PREVIEW_AMOUNT_VND = 50_000;

function formatRateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
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
        "relative h-5 w-9 shrink-0 rounded-full border",
        "transition-[background-color,border-color,transform] duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
        "active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed",
        checked ? "bg-iris border-iris" : "bg-slate-300 border-slate-400",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/5",
          "transition-transform duration-200",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

function NumField({
  label,
  hint,
  value,
  onChange,
  disabled,
  suffix,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  // Same thousand-separator style as the FX rate field (en-US: 26,000).
  const display = Number.isFinite(value) && value !== 0
    ? value.toLocaleString("en-US")
    : value === 0
      ? "0"
      : "";

  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      <div className="relative mt-1">
        <input
          inputMode="numeric"
          value={display}
          disabled={disabled}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            onChange(digits ? parseInt(digits, 10) : 0);
          }}
          className={cn(
            "h-9 w-full rounded-md border border-line-2 bg-surface px-2.5 text-right font-mono text-[13px] tabular-nums text-fg",
            "placeholder:text-faint focus:border-iris focus:ring-2 focus:ring-iris/15",
            "disabled:bg-raised disabled:text-muted",
            suffix && "pr-11",
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</p>}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "mt-1 h-9 w-full rounded-md border border-line-2 bg-surface px-2.5 text-[13px] text-fg",
          "placeholder:text-faint focus:border-iris focus:ring-2 focus:ring-iris/15 disabled:bg-raised disabled:text-muted",
        )}
      />
    </label>
  );
}

function railStatus(
  enabled: boolean,
  secrets: boolean,
  effective: boolean,
  t: ReturnType<typeof useTranslations>,
): { tone: "good" | "warn" | "bad"; label: string } {
  if (effective) return { tone: "good", label: t("railLive") };
  if (enabled && !secrets) return { tone: "warn", label: t("railMissingSecrets") };
  return { tone: "bad", label: t("railOff") };
}

type SettingsTab = "display" | "deposits" | "mail";

function AdminMoneyAndDepositPage() {
  const t = useTranslations("currency");
  const tTabs = useTranslations("adminSettings");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawTab = searchParams.get("tab");
  const tab: SettingsTab = rawTab === "mail" || rawTab === "deposits" ? rawTab : "display";

  const setTab = (next: SettingsTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "display") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const [money, setMoney] = useState<MoneyConfigAdmin | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [currencyDefault, setCurrencyDefault] = useState<DisplayCurrency>("USD");
  const [allowCurrencyToggle, setAllowCurrencyToggle] = useState(true);
  const [allowLocaleToggle, setAllowLocaleToggle] = useState(false);
  const [showFxHints, setShowFxHints] = useState(true);

  const [rail, setRail] = useState<DepositRailConfigAdmin | null>(null);
  const [railDraft, setRailDraft] = useState<DepositRailConfigUpdate>({});

  const [loading, setLoading] = useState(true);
  const [savingDisplay, setSavingDisplay] = useState(false);
  const [savingRails, setSavingRails] = useState(false);
  const [displayMsg, setDisplayMsg] = useState("");
  const [displayErr, setDisplayErr] = useState("");
  const [railsMsg, setRailsMsg] = useState("");
  const [railsErr, setRailsErr] = useState("");

  const applyMoney = (data: MoneyConfigAdmin) => {
    setMoney(data);
    setRateInput(data.display_fx_rate != null ? String(data.display_fx_rate) : "");
    setCurrencyDefault(data.display_currency_default);
    setAllowCurrencyToggle(data.allow_user_toggle);
    setAllowLocaleToggle(data.allow_locale_toggle);
    setShowFxHints(data.show_fx_hints !== false);
  };

  const load = async () => {
    setLoading(true);
    setDisplayErr("");
    setRailsErr("");
    try {
      const [m, r] = await Promise.all([api.adminMoneyConfig(), api.adminDepositRailConfig()]);
      applyMoney(m);
      setRail(r);
      setRailDraft({});
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("pageLoadFail");
      setDisplayErr(msg);
      setRailsErr(msg);
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
    money?.source === "db"
      ? t("adminSourceDb")
      : money?.source === "env"
        ? t("adminSourceEnv")
        : t("adminSourceNone");

  const displayDirty = useMemo(() => {
    if (!money) return false;
    const currentRate = money.display_fx_rate != null ? String(money.display_fx_rate) : "";
    return (
      rateInput !== currentRate
      || currencyDefault !== money.display_currency_default
      || allowCurrencyToggle !== money.allow_user_toggle
      || allowLocaleToggle !== money.allow_locale_toggle
      || showFxHints !== (money.show_fx_hints !== false)
    );
  }, [money, rateInput, currencyDefault, allowCurrencyToggle, allowLocaleToggle, showFxHints]);

  const railsDirty = Object.keys(railDraft).length > 0;

  const rv = <K extends keyof DepositRailConfigAdmin>(key: K): DepositRailConfigAdmin[K] => {
    if (railDraft[key as keyof DepositRailConfigUpdate] !== undefined) {
      return railDraft[key as keyof DepositRailConfigUpdate] as DepositRailConfigAdmin[K];
    }
    return rail![key];
  };

  const setRailField = <K extends keyof DepositRailConfigUpdate>(
    key: K,
    value: DepositRailConfigUpdate[K],
  ) => {
    setRailDraft((d) => ({ ...d, [key]: value }));
  };

  const saveDisplay = async () => {
    const rate = parseInt(rateInput, 10);
    if (!Number.isFinite(rate) || !money || rate < money.rate_min || rate > money.rate_max) {
      setDisplayErr(t("adminInvalid"));
      return;
    }
    setSavingDisplay(true);
    setDisplayMsg("");
    setDisplayErr("");
    try {
      await api.adminUpdateMoneyConfig({
        display_fx_rate: rate,
        display_currency_default: currencyDefault,
        allow_user_toggle: allowCurrencyToggle,
        allow_locale_toggle: allowLocaleToggle,
        show_fx_hints: showFxHints,
      });
      setDisplayMsg(t("adminSavedAll"));
      const next = await api.adminMoneyConfig();
      applyMoney(next);
    } catch (e) {
      setDisplayErr(e instanceof Error ? e.message : t("displaySaveFail"));
    } finally {
      setSavingDisplay(false);
    }
  };

  const resetRate = async () => {
    if (!money?.env_rate) return;
    if (!window.confirm(t("adminResetConfirm"))) return;
    setSavingDisplay(true);
    setDisplayMsg("");
    setDisplayErr("");
    try {
      await api.adminResetMoneyConfigToEnv();
      setDisplayMsg(t("adminResetDone", { rate: money.env_rate.toLocaleString() }));
      const next = await api.adminMoneyConfig();
      applyMoney(next);
    } catch (e) {
      setDisplayErr(e instanceof Error ? e.message : t("displayResetFail"));
    } finally {
      setSavingDisplay(false);
    }
  };

  const saveRails = async () => {
    if (!rail) return;
    if (!railsDirty) {
      setRailsMsg(t("railsNoChange"));
      return;
    }
    setSavingRails(true);
    setRailsMsg("");
    setRailsErr("");
    try {
      const next = await api.updateDepositRailConfig(railDraft);
      setRail(next);
      setRailDraft({});
      setRailsMsg(t("railsSaved"));
    } catch (e) {
      setRailsErr(e instanceof Error ? e.message : t("railsSaveFail"));
    } finally {
      setSavingRails(false);
    }
  };

  const resetRails = async () => {
    if (!window.confirm(t("railsResetConfirm"))) return;
    setSavingRails(true);
    setRailsMsg("");
    setRailsErr("");
    try {
      const next = await api.resetDepositRailConfig();
      setRail(next);
      setRailDraft({});
      setRailsMsg(t("railsReset"));
    } catch (e) {
      setRailsErr(e instanceof Error ? e.message : t("railsResetFail"));
    } finally {
      setSavingRails(false);
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "display", label: tTabs("tabDisplay") },
    { id: "deposits", label: tTabs("tabDeposits") },
    { id: "mail", label: tTabs("tabMail") },
  ];

  if (tab !== "mail" && loading) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  }

  const sepay = rail
    ? railStatus(Boolean(rv("sepay_enabled")), rail.sepay_secrets_configured, rail.effective_sepay_enabled, t)
    : null;
  const usdt = rail
    ? railStatus(
        Boolean(rv("nowpayments_enabled")),
        rail.nowpayments_secrets_configured,
        rail.effective_nowpayments_enabled,
        t,
      )
    : null;

  const usdOpensUsdt =
    currencyDefault === "USD" && rail && Boolean(rv("nowpayments_enabled"));

  return (
    <div className="w-full space-y-3.5 pb-5">
      <p className="text-[13px] leading-snug text-muted">{t("pageSubtitle")}</p>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("pageSubtitle")}>
        {tabs.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            role="tab"
            aria-selected={tab === item.id}
            variant={tab === item.id ? "primary" : "ghost"}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {tab === "mail" && <MailSettingsPanel />}

      {tab === "display" && (
      <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Rate */}
          <div className="min-w-0 border-b border-line p-4 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold tracking-tight text-fg">
                {t("adminRateCardTitle")}
              </h2>
              <Tag tone="neutral">{sourceLabel}</Tag>
            </div>
            <p className="mt-0.5 text-[12px] text-muted">{t("adminRateCardHint")}</p>

            <div className="mt-3 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  {t("rateEqualsLabel")}
                </p>
                <input
                  inputMode="numeric"
                  value={formatRateInput(rateInput)}
                  onChange={(e) => setRateInput(e.target.value.replace(/\D/g, ""))}
                  aria-label={t("adminRate")}
                  aria-invalid={Boolean(displayErr && !rateNum)}
                  className="mt-1 h-auto w-full rounded-sm border-0 bg-transparent p-0 font-mono text-[2rem] font-semibold leading-none tabular-nums tracking-tight text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-iris/40"
                />
              </div>
              <span className="mb-1 shrink-0 text-[12px] font-medium text-muted">
                {t("adminRateSuffix")}
              </span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
              {money && (
                <span>
                  {t("adminRange", {
                    min: money.rate_min.toLocaleString(),
                    max: money.rate_max.toLocaleString(),
                  })}
                </span>
              )}
              {previewText && (
                <span className="font-mono tabular-nums text-fg">
                  {t("adminPreview", {
                    vnd: formatLedgerMoney(PREVIEW_AMOUNT_VND, locale),
                    usd: previewText,
                  })}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-line pt-2.5">
              <span className="text-[12px] text-muted">
                {t("adminEnvRate")}:{" "}
                <span className="font-mono font-medium tabular-nums text-fg">
                  {money?.env_rate != null ? money.env_rate.toLocaleString() : "—"}
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void resetRate()}
                disabled={savingDisplay || money?.env_rate == null}
              >
                {t("adminReset")}
              </Button>
            </div>
          </div>

          {/* Visitor options */}
          <div className="flex min-w-0 flex-col p-4">
            <h2 className="text-[14px] font-semibold tracking-tight text-fg">
              {t("adminExperienceTitle")}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">{t("adminExperienceHint")}</p>

            <div className="mt-2.5 flex-1 space-y-0">
              <div className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fg">{t("adminDefaultCurrency")}</div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted">{t("adminDefaultCurrencyHint")}</p>
                </div>
                <div
                  className="inline-flex shrink-0 items-center rounded-md border border-line-2 bg-raised p-0.5"
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
                          "min-w-11 rounded-md px-2.5 py-1.5 text-[12px] font-bold tracking-[0.06em]",
                          "transition-[background-color,color,box-shadow] duration-150",
                          active
                            ? "bg-iris text-white shadow-sm"
                            : "text-muted hover:bg-surface hover:text-fg",
                        )}
                      >
                        {code}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fg">{t("adminShowCurrencyToggle")}</div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted">{t("adminShowCurrencyToggleHint")}</p>
                </div>
                <Switch
                  checked={allowCurrencyToggle}
                  onChange={setAllowCurrencyToggle}
                  disabled={savingDisplay}
                  label={t("adminShowCurrencyToggle")}
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fg">{t("adminShowLocaleToggle")}</div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted">{t("adminShowLocaleToggleHint")}</p>
                </div>
                <Switch
                  checked={allowLocaleToggle}
                  onChange={setAllowLocaleToggle}
                  disabled={savingDisplay}
                  label={t("adminShowLocaleToggle")}
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fg">{t("adminShowFxHints")}</div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted">{t("adminShowFxHintsHint")}</p>
                </div>
                <Switch
                  checked={showFxHints}
                  onChange={setShowFxHints}
                  disabled={savingDisplay}
                  label={t("adminShowFxHints")}
                />
              </div>
            </div>

            {(displayMsg || displayErr) && (
              <div className="mt-2 space-y-1">
                {displayMsg && (
                  <p className="rounded-md border border-good/25 bg-good-soft px-2.5 py-1.5 text-[12px] text-good" role="status">
                    {displayMsg}
                  </p>
                )}
                {displayErr && (
                  <p className="rounded-md border border-bad/25 bg-bad-soft px-2.5 py-1.5 text-[12px] text-bad" role="alert">
                    {displayErr}
                  </p>
                )}
              </div>
            )}

            <div className="mt-2.5 flex justify-end border-t border-line pt-2.5">
              <Button
                size="sm"
                onClick={() => void saveDisplay()}
                disabled={savingDisplay || !displayDirty}
                className={cn(
                  !displayDirty &&
                    !savingDisplay &&
                    "disabled:opacity-100 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none",
                )}
              >
                {savingDisplay ? t("saving") : t("saveDisplay")}
              </Button>
            </div>
          </div>
        </div>
      </section>
      )}

      {tab === "deposits" && (
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-tight text-fg">{t("railsTitle")}</h2>
            <p className="mt-0.5 max-w-2xl text-[12px] leading-snug text-muted">{t("railsHint")}</p>
          </div>
          {usdOpensUsdt && (
            <p className="max-w-sm rounded-md border border-iris/20 bg-iris-soft px-2.5 py-1 text-[11px] leading-snug text-iris-hi">
              {t("usdOpensUsdt")}
            </p>
          )}
        </div>

        {rail && sepay && usdt && (
          <div className="grid gap-2.5 xl:grid-cols-2">
            <article className="rounded-card border border-line bg-card p-3.5 shadow-card">
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-[13px] font-semibold text-fg">{t("railSepayTitle")}</h3>
                    <Tag tone={sepay.tone}>{sepay.label}</Tag>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">{t("railSepayHint")}</p>
                </div>
                <Switch
                  checked={Boolean(rv("sepay_enabled"))}
                  onChange={(x) => setRailField("sepay_enabled", x)}
                  disabled={savingRails}
                  label={t("railSepayTitle")}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
                <span>
                  {t("secretsLabel")}:{" "}
                  <span className={rail.sepay_secrets_configured ? "font-medium text-good" : "font-medium text-bad"}>
                    {rail.sepay_secrets_configured ? t("secretsOk") : t("secretsMissing")}
                  </span>
                </span>
                <span>
                  {t("autoReconcile")}:{" "}
                  <span className={rail.sepay_reconciliation_configured ? "font-medium text-good" : "font-medium text-bad"}>
                    {rail.sepay_reconciliation_configured ? t("secretsOk") : t("secretsMissing")}
                  </span>
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <TextField label={t("sepayBankCode")} value={String(rv("sepay_bank_code"))} onChange={(v) => setRailField("sepay_bank_code", v)} disabled={savingRails} />
                <TextField label={t("sepayAccountNumber")} value={String(rv("sepay_bank_account_number"))} onChange={(v) => setRailField("sepay_bank_account_number", v)} disabled={savingRails} />
                <TextField label={t("sepayAccountName")} value={String(rv("sepay_bank_account_name"))} onChange={(v) => setRailField("sepay_bank_account_name", v)} disabled={savingRails} />
                <TextField label={t("sepayAccountId")} value={String(rv("sepay_bank_account_id"))} onChange={(v) => setRailField("sepay_bank_account_id", v)} disabled={savingRails} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-2">
                <NumField
                  label={t("minVnd")}
                  value={Number(rv("deposit_min_amount"))}
                  onChange={(n) => setRailField("deposit_min_amount", n)}
                  disabled={savingRails}
                />
                <NumField
                  label={t("maxVnd")}
                  value={Number(rv("deposit_max_amount"))}
                  onChange={(n) => setRailField("deposit_max_amount", n)}
                  disabled={savingRails}
                />
                <NumField
                  label={t("expireMinutes")}
                  hint={t("sepayExpireHint")}
                  value={Number(rv("deposit_expire_minutes"))}
                  onChange={(n) => setRailField("deposit_expire_minutes", n)}
                  disabled={savingRails}
                  suffix={t("unitMin")}
                />
                <NumField
                  label={t("reconcileHours")}
                  hint={t("sepayReconcileHint")}
                  value={Number(rv("deposit_reconcile_retention_hours"))}
                  onChange={(n) => setRailField("deposit_reconcile_retention_hours", n)}
                  disabled={savingRails}
                  suffix={t("unitHour")}
                />
              </div>
            </article>

            <article className="rounded-card border border-line bg-card p-3.5 shadow-card">
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-[13px] font-semibold text-fg">{t("railUsdtTitle")}</h3>
                    <Tag tone={usdt.tone}>{usdt.label}</Tag>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">{t("railUsdtHint")}</p>
                </div>
                <Switch
                  checked={Boolean(rv("nowpayments_enabled"))}
                  onChange={(x) => setRailField("nowpayments_enabled", x)}
                  disabled={savingRails}
                  label={t("railUsdtTitle")}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
                <span>
                  {t("secretsLabel")}:{" "}
                  <span className={rail.nowpayments_secrets_configured ? "font-medium text-good" : "font-medium text-bad"}>
                    {rail.nowpayments_secrets_configured ? t("secretsOk") : t("secretsMissing")}
                  </span>
                </span>
                <span>
                  {t("autoReconcile")}:{" "}
                  <span className={rail.nowpayments_reconciliation_configured ? "font-medium text-good" : "font-medium text-bad"}>
                    {rail.nowpayments_reconciliation_configured ? t("secretsOk") : t("secretsMissing")}
                  </span>
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-2">
                <NumField
                  label={t("minVnd")}
                  value={Number(rv("deposit_usdt_min_vnd"))}
                  onChange={(n) => setRailField("deposit_usdt_min_vnd", n)}
                  disabled={savingRails}
                />
                <NumField
                  label={t("maxVnd")}
                  value={Number(rv("deposit_usdt_max_vnd"))}
                  onChange={(n) => setRailField("deposit_usdt_max_vnd", n)}
                  disabled={savingRails}
                />
                <NumField
                  label={t("localWindow")}
                  hint={t("usdtWindowHint")}
                  value={Number(rv("deposit_usdt_local_window_minutes"))}
                  onChange={(n) => setRailField("deposit_usdt_local_window_minutes", n)}
                  disabled={savingRails}
                  suffix={t("unitMin")}
                />
                <NumField
                  label={t("reconcileHours")}
                  hint={t("usdtReconcileHint")}
                  value={Number(rv("deposit_usdt_reconcile_retention_hours"))}
                  onChange={(n) => setRailField("deposit_usdt_reconcile_retention_hours", n)}
                  disabled={savingRails}
                  suffix={t("unitHour")}
                />
              </div>
            </article>
          </div>
        )}

        {(railsMsg || railsErr) && (
          <div className="space-y-1">
            {railsMsg && (
              <p className="rounded-md border border-good/25 bg-good-soft px-2.5 py-1.5 text-[12px] text-good" role="status">
                {railsMsg}
              </p>
            )}
            {railsErr && (
              <p className="rounded-md border border-bad/25 bg-bad-soft px-2.5 py-1.5 text-[12px] text-bad" role="alert">
                {railsErr}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-2.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void resetRails()}
            disabled={savingRails}
          >
            {t("resetRails")}
          </Button>
          <Button
            size="sm"
            onClick={() => void saveRails()}
            disabled={savingRails || !railsDirty}
            className={cn(
              !railsDirty &&
                !savingRails &&
                "disabled:opacity-100 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none",
            )}
          >
            {savingRails ? t("saving") : t("saveRails")}
          </Button>
        </div>
      </section>
      )}
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      }
    >
      <AdminMoneyAndDepositPage />
    </Suspense>
  );
}
