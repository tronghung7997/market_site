"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { MoneyConfigAdmin } from "@/lib/types";
import { formatBrowseMoney, formatLedgerMoney, type DisplayCurrency } from "@/lib/money";
import { cn } from "@/lib/cn";
import { Button, Spinner, Switch, Tag } from "@/components/ui";
import { useToast } from "@/components/toast";
import { SettingsFooter } from "./SettingsRow";

const PREVIEW_AMOUNT_VND = 50_000;

function formatThousands(digits: string): string {
  return digits ? Number(digits).toLocaleString("en-US") : "";
}

function SettingRow({
  title, hint, control, first,
}: { title: string; hint: string; control: React.ReactNode; first?: boolean }) {
  return (
    <div className={cn("flex items-start gap-3 py-3", !first && "border-t border-line")}>
      <span className="mt-px shrink-0">{control}</span>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-fg">{title}</div>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</p>
      </div>
    </div>
  );
}

export function DisplaySettingsPanel() {
  const t = useTranslations("adminDisplay");
  const apiErrorMessage = useApiErrorMessage();
  const locale = useLocale();
  const [money, setMoney] = useState<MoneyConfigAdmin | null>(null);
  const [rateDigits, setRateDigits] = useState("");
  const [currencyDefault, setCurrencyDefault] = useState<DisplayCurrency>("VND");
  const [allowCurrencyToggle, setAllowCurrencyToggle] = useState(true);
  const [allowLocaleToggle, setAllowLocaleToggle] = useState(false);
  const [showFxHints, setShowFxHints] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const apply = (data: MoneyConfigAdmin) => {
    setMoney(data);
    setRateDigits(data.display_fx_rate != null ? String(data.display_fx_rate) : "");
    setCurrencyDefault(data.display_currency_default);
    setAllowCurrencyToggle(data.allow_user_toggle);
    setAllowLocaleToggle(data.allow_locale_toggle);
    setShowFxHints(data.show_fx_hints !== false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr("");
    try {
      apply(await api.adminMoneyConfig());
    } catch (e) {
      setLoadErr(apiErrorMessage(e, t("loadFail")));
    } finally {
      setLoading(false);
    }
  }, [apiErrorMessage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rate = useMemo(() => {
    const n = parseInt(rateDigits, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [rateDigits]);

  const rateInRange = money != null && rate != null && rate >= money.rate_min && rate <= money.rate_max;

  const dirty = useMemo(() => {
    if (!money) return false;
    const savedRate = money.display_fx_rate != null ? String(money.display_fx_rate) : "";
    return (
      rateDigits !== savedRate
      || currencyDefault !== money.display_currency_default
      || allowCurrencyToggle !== money.allow_user_toggle
      || allowLocaleToggle !== money.allow_locale_toggle
      || showFxHints !== (money.show_fx_hints !== false)
    );
  }, [money, rateDigits, currencyDefault, allowCurrencyToggle, allowLocaleToggle, showFxHints]);

  const save = async () => {
    if (!money || rate == null || !rateInRange) {
      toast.error(t("rateInvalid", { min: money?.rate_min.toLocaleString() ?? "", max: money?.rate_max.toLocaleString() ?? "" }));
      return;
    }
    setSaving(true);
    try {
      await api.adminUpdateMoneyConfig({
        display_fx_rate: rate,
        display_currency_default: currencyDefault,
        allow_user_toggle: allowCurrencyToggle,
        allow_locale_toggle: allowLocaleToggle,
        show_fx_hints: showFxHints,
      });
      apply(await api.adminMoneyConfig());
      toast.success(t("saved"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("saveFail")));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (money) apply(money);
  };

  const useServerRate = () => {
    if (money?.env_rate == null) return;
    setRateDigits(String(money.env_rate));
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!money) {
    return (
      <div className="rounded-card border border-bad/25 bg-bad-soft px-4 py-3 text-[13px] text-bad" role="alert">
        <p>{loadErr || t("loadFail")}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  // What a first-time visitor sees with the *saved* settings, so the summary never lies about a draft.
  const savedUsdAvailable = money.display_fx_rate != null;
  const savedPreview = savedUsdAvailable
    ? formatBrowseMoney(PREVIEW_AMOUNT_VND, { locale, currency: "USD", fxRate: money.display_fx_rate! })
    : null;
  const draftPreview = rate != null
    ? formatBrowseMoney(PREVIEW_AMOUNT_VND, { locale, currency: "USD", fxRate: rate })
    : null;
  const vndPreview = formatLedgerMoney(PREVIEW_AMOUNT_VND, locale);

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-line bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="iris">{t("summary.visitorSees", { currency: money.display_currency_default })}</Tag>
          <Tag tone={money.allow_user_toggle && savedUsdAvailable ? "good" : "neutral"}>
            {money.allow_user_toggle && savedUsdAvailable ? t("summary.canSwitch") : t("summary.cannotSwitch")}
          </Tag>
          <Tag tone={money.allow_locale_toggle ? "good" : "neutral"}>
            {money.allow_locale_toggle ? t("summary.langSwitchOn") : t("summary.langSwitchOff")}
          </Tag>
          {dirty && <Tag tone="warn">{t("summary.unsaved")}</Tag>}
        </div>
        <p className="mt-2 text-[15px] font-medium leading-snug text-fg">
          {savedUsdAvailable
            ? t("summary.rateLine", { rate: money.display_fx_rate!.toLocaleString(), vnd: vndPreview, usd: savedPreview ?? "" })
            : t("summary.noRate")}
        </p>
        <p className="mt-1 text-[12px] text-muted">{t("summary.ledgerNote")}</p>
      </section>

      <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line bg-raised/40 px-5 py-3">
          <h2 className="text-[13.5px] font-semibold text-fg">{t("title")}</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-muted">{t("hint")}</p>
        </div>

        <div className="divide-y divide-line">
          <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-x-10">
            <div>
              <h3 className="text-[13px] font-semibold text-fg">{t("currency.title")}</h3>
              <p className="mt-1 text-[12px] leading-snug text-muted">{t("currency.hint")}</p>
            </div>
            <div>
              <div role="radiogroup" aria-label={t("currency.default")} className="overflow-hidden rounded-lg border border-line">
                {(["VND", "USD"] as const).map((code) => {
                  const selected = currencyDefault === code;
                  const id = `display-currency-${code}`;
                  return (
                    <label
                      key={code}
                      htmlFor={id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 border-b border-line px-3 py-3 transition-colors last:border-b-0",
                        selected ? "bg-iris-soft" : "bg-surface hover:bg-raised",
                      )}
                    >
                      <input
                        id={id}
                        type="radio"
                        name="display_currency_default"
                        value={code}
                        checked={selected}
                        onChange={() => setCurrencyDefault(code)}
                        className="mt-1 h-4 w-4 shrink-0 accent-iris"
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-[13px] font-medium", selected ? "text-iris-hi" : "text-fg")}>
                          {t(`currency.${code}`)}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-snug text-muted">{t(`currency.${code}Hint`)}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
                        {code === "VND" ? vndPreview : (draftPreview ?? "—")}
                      </span>
                    </label>
                  );
                })}
              </div>
              <SettingRow
                title={t("currency.allowToggle")}
                hint={t("currency.allowToggleHint")}
                control={(
                  <Switch
                    checked={allowCurrencyToggle}
                    onChange={setAllowCurrencyToggle}
                    disabled={saving}
                    label={t("currency.allowToggle")}
                  />
                )}
                first
              />
            </div>
          </div>

          <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-x-10">
            <div>
              <h3 className="text-[13px] font-semibold text-fg">{t("rate.title")}</h3>
              <p className="mt-1 text-[12px] leading-snug text-muted">{t("rate.hint")}</p>
            </div>
            <div>
              <label htmlFor="display-fx-rate" className="block text-[13px] font-medium text-muted">
                {t("rate.label")}
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[14px] text-fg">1 USD =</span>
                <input
                  id="display-fx-rate"
                  inputMode="numeric"
                  value={formatThousands(rateDigits)}
                  onChange={(e) => setRateDigits(e.target.value.replace(/\D/g, ""))}
                  aria-invalid={rate != null && !rateInRange}
                  placeholder="26,000"
                  className={cn(
                    "h-10 w-36 rounded-lg border bg-surface px-3 text-right font-mono text-[15px] tabular-nums text-fg",
                    "placeholder:text-faint focus:border-iris focus:bg-panel",
                    rate != null && !rateInRange ? "border-bad" : "border-line",
                  )}
                />
                <span className="text-[14px] text-fg">VND</span>
                {draftPreview && (
                  <span className="ml-2 font-mono text-[12px] tabular-nums text-muted">
                    {t("rate.preview", { vnd: vndPreview, usd: draftPreview })}
                  </span>
                )}
              </div>
              <p className={cn("mt-1.5 text-[12px]", rate != null && !rateInRange ? "text-bad" : "text-faint")}>
                {t("rate.range", { min: money.rate_min.toLocaleString(), max: money.rate_max.toLocaleString() })}
              </p>
              {money.env_rate != null && String(money.env_rate) !== rateDigits && (
                <button
                  type="button"
                  onClick={useServerRate}
                  className="mt-1.5 text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline"
                >
                  {t("rate.useServer", { rate: money.env_rate.toLocaleString() })}
                </button>
              )}
              <div className="mt-3 border-t border-line">
                <SettingRow
                  title={t("rate.showHints")}
                  hint={t("rate.showHintsHint")}
                  control={(
                    <Switch checked={showFxHints} onChange={setShowFxHints} disabled={saving} label={t("rate.showHints")} />
                  )}
                  first
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-x-10">
            <div>
              <h3 className="text-[13px] font-semibold text-fg">{t("language.title")}</h3>
              <p className="mt-1 text-[12px] leading-snug text-muted">{t("language.hint")}</p>
            </div>
            <SettingRow
              title={t("language.showSwitcher")}
              hint={t("language.showSwitcherHint")}
              control={(
                <Switch
                  checked={allowLocaleToggle}
                  onChange={setAllowLocaleToggle}
                  disabled={saving}
                  label={t("language.showSwitcher")}
                />
              )}
              first
            />
          </div>
        </div>

      </section>

      <SettingsFooter
        dirty={dirty}
        valid={rateInRange}
        saving={saving}
        onReset={discard}
        onSave={() => void save()}
      />
    </div>
  );
}
