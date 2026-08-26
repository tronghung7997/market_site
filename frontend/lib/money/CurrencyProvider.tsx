"use client";

/**
 * Owns display-currency preference + runtime money config.
 * Preference is independent of i18n locale (Booking-style).
 *
 * Cookie `display_currency` is the source of truth (SSR-safe).
 * localStorage is a mirror only.
 *
 * Important: never persist FALLBACK/provisional defaults into the cookie.
 * If SSR money-config fails, wait for the client retry before writing a
 * first-visit preference — otherwise USD gets stuck when the real default is VND.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DISPLAY_CURRENCY_COOKIE,
  DISPLAY_CURRENCY_STORAGE_KEY,
  MONEY_CONFIG_FALLBACK,
  type DisplayCurrency,
  type MoneyConfig,
} from "./constants";
import {
  formatBrowseMoney,
  formatCheckoutMoney,
  formatDisplayMoney,
  formatLedgerMoney,
  formatOrderHistoryMoney,
  formatUnitMoney,
  parseDisplayCurrency,
  vndToUsd,
  type DisplayMoneyContext,
  type HistoricalMoneyContext,
  type HistoricalMoneyResult,
} from "./format";
import { getCookie, setCookie } from "@/lib/utils/cookies";

type LocaleOpts = { locale?: string };

type MoneyContextValue = {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
  config: MoneyConfig;
  configReady: boolean;
  /** Live site rate (VND per USD); null → USD display falls back to VND. */
  fxRate: number | null;
  /** Show VND|USD switcher. */
  allowToggle: boolean;
  /** Show EN|VI language switcher. */
  allowLocaleToggle: boolean;
  /** Buyer-facing FX / VND conversion hints (rate tooltip, ≈ ledger). */
  showFxHints: boolean;
  formatLedgerMoney: (amountVnd: number, locale?: string) => string;
  formatBrowseMoney: (amountVnd: number, opts?: LocaleOpts) => string;
  formatCheckoutMoney: (amountVnd: number, opts?: LocaleOpts) => string;
  formatUnitMoney: (amountVnd: number, opts?: LocaleOpts) => string;
  /** @deprecated Prefer formatBrowseMoney / formatCheckoutMoney. */
  formatDisplayMoney: (amountVnd: number, opts?: LocaleOpts) => string;
  formatOrderHistoryMoney: (
    amountVnd: number,
    snapshotRate: number | null | undefined,
    opts?: LocaleOpts,
  ) => HistoricalMoneyResult;
  /** @deprecated Alias of formatOrderHistoryMoney. */
  formatHistoricalOrderMoney: (
    amountVnd: number,
    snapshotRate: number | null | undefined,
    opts?: LocaleOpts,
  ) => HistoricalMoneyResult;
  vndToUsd: (amountVnd: number) => number | null;
};

const MoneyContext = createContext<MoneyContextValue | null>(null);

function readStoredCurrency(): DisplayCurrency | null {
  if (typeof document === "undefined") return null;
  const fromCookie = parseDisplayCurrency(getCookie(DISPLAY_CURRENCY_COOKIE));
  if (fromCookie) return fromCookie;
  try {
    return parseDisplayCurrency(
      localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

function persistCurrency(c: DisplayCurrency) {
  setCookie(DISPLAY_CURRENCY_COOKIE, c, 365);
  try {
    localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, c);
  } catch {
    /* ignore */
  }
}

function bindCtx(
  currency: DisplayCurrency,
  fxRate: number | null,
  opts?: LocaleOpts,
): DisplayMoneyContext {
  return {
    locale: opts?.locale ?? "en",
    currency,
    fxRate,
  };
}

function normalizeConfig(body: Partial<MoneyConfig>): MoneyConfig {
  const rate =
    typeof body.display_fx_rate === "number" &&
    Number.isFinite(body.display_fx_rate) &&
    body.display_fx_rate > 0
      ? body.display_fx_rate
      : null;
  const def = parseDisplayCurrency(body.display_currency_default) ?? "USD";
  return {
    ledger_currency: "VND",
    display_fx_rate: rate,
    display_currency_default: def,
    allow_user_toggle: !!body.allow_user_toggle,
    allow_locale_toggle: !!body.allow_locale_toggle,
    // Missing field → true (legacy API / partial body keeps hints visible).
    show_fx_hints: body.show_fx_hints !== false,
  };
}

export function CurrencyProvider({
  children,
  initialCurrency,
  initialConfig,
}: {
  children: ReactNode;
  /**
   * From cookie on the server so SSR matches client first paint.
   * initialConfig: resolved MoneyConfig from SSR, or null if SSR fetch failed
   * (client must retry). Omit/undefined treated like null for retry.
   */
  initialCurrency?: DisplayCurrency;
  initialConfig?: MoneyConfig | null;
}) {
  const ssrConfig = initialConfig ?? null;
  const seedDefault =
    ssrConfig?.display_currency_default ??
    MONEY_CONFIG_FALLBACK.display_currency_default;

  const [currency, setCurrencyState] = useState<DisplayCurrency>(
    () => initialCurrency ?? seedDefault,
  );
  // First paint always has a config object (SSR or FALLBACK); client retry
  // upgrades FALLBACK when SSR returned null.
  const [config, setConfig] = useState<MoneyConfig>(
    () => ssrConfig ?? MONEY_CONFIG_FALLBACK,
  );
  const [configReady, setConfigReady] = useState(ssrConfig != null);

  // Client hydrate: restore stored preference; only persist trusted defaults.
  useEffect(() => {
    const stored = readStoredCurrency();
    if (stored) {
      setCurrencyState(stored);
      // Ensure cookie exists if only localStorage had it.
      if (!getCookie(DISPLAY_CURRENCY_COOKIE)) {
        persistCurrency(stored);
      }
      return;
    }

    // No stored preference (true first visit).
    if (ssrConfig != null) {
      // Trusted server default — safe to write cookie.
      const def = ssrConfig.display_currency_default;
      setCurrencyState(def);
      persistCurrency(def);
      return;
    }

    // SSR failed: keep provisional FALLBACK currency in memory only.
    // Do NOT write cookie — client retry will apply real default (e.g. VND).
    setCurrencyState(seedDefault);
  }, [ssrConfig, seedDefault]);

  // Fetch when SSR did not supply config (failure / not loaded). Preference
  // still never comes from API — only rate + flags. First-visit default
  // may come from recovered config when no cookie exists yet.
  useEffect(() => {
    if (ssrConfig != null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/money-config", {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("money-config failed");
        const body = (await res.json()) as MoneyConfig;
        if (cancelled) return;
        const next = normalizeConfig(body);
        setConfig(next);

        // First visit without any stored preference: apply recovered default.
        // Do not check only cookie — we intentionally skipped writing FALLBACK.
        if (readStoredCurrency() == null) {
          setCurrencyState(next.display_currency_default);
          persistCurrency(next.display_currency_default);
        }
      } catch {
        if (!cancelled) {
          setConfig(MONEY_CONFIG_FALLBACK);
          // Still no trusted config — leave currency provisional, no cookie.
        }
      } finally {
        if (!cancelled) setConfigReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ssrConfig]);

  const setCurrency = useCallback(
    (c: DisplayCurrency) => {
      if (!config.allow_user_toggle && c !== currency) {
        // Flag off: ignore toggle (stay on current / default).
        return;
      }
      setCurrencyState(c);
      persistCurrency(c);
    },
    [config.allow_user_toggle, currency],
  );

  const fxRate = config.display_fx_rate;

  const value = useMemo<MoneyContextValue>(() => {
    // When toggle disabled, force default (or VND if USD rate missing).
    const effective: DisplayCurrency = config.allow_user_toggle
      ? currency
      : config.display_currency_default;

    const history = (
      amountVnd: number,
      snapshotRate: number | null | undefined,
      opts?: LocaleOpts,
    ): HistoricalMoneyResult =>
      formatOrderHistoryMoney(amountVnd, snapshotRate, {
        locale: opts?.locale ?? "en",
        currency: effective,
      } satisfies HistoricalMoneyContext);

    return {
      currency: effective,
      setCurrency,
      config,
      configReady,
      fxRate,
      allowToggle: config.allow_user_toggle,
      allowLocaleToggle: config.allow_locale_toggle,
      showFxHints: config.show_fx_hints,
      formatLedgerMoney: (amountVnd, locale = "en") =>
        formatLedgerMoney(amountVnd, locale),
      formatBrowseMoney: (amountVnd, opts) =>
        formatBrowseMoney(amountVnd, bindCtx(effective, fxRate, opts)),
      formatCheckoutMoney: (amountVnd, opts) =>
        formatCheckoutMoney(amountVnd, bindCtx(effective, fxRate, opts)),
      formatUnitMoney: (amountVnd, opts) =>
        formatUnitMoney(amountVnd, bindCtx(effective, fxRate, opts)),
      formatDisplayMoney: (amountVnd, opts) =>
        formatDisplayMoney(amountVnd, bindCtx(effective, fxRate, opts)),
      formatOrderHistoryMoney: history,
      formatHistoricalOrderMoney: history,
      vndToUsd: (amountVnd) => vndToUsd(amountVnd, fxRate),
    };
  }, [currency, setCurrency, config, configReady, fxRate]);

  return (
    <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>
  );
}

const fallbackHistory = (
  amountVnd: number,
  _snapshot: number | null | undefined,
  opts?: LocaleOpts,
): HistoricalMoneyResult => ({
  text: formatLedgerMoney(amountVnd, opts?.locale ?? "en"),
  usedLegacyRate: false,
  rateUsed: null,
});

export function useMoney(): MoneyContextValue {
  const ctx = useContext(MoneyContext);
  if (!ctx) {
    // Graceful fallback outside provider (stories / stray trees): VND only.
    return {
      currency: "VND",
      setCurrency: () => {},
      config: MONEY_CONFIG_FALLBACK,
      configReady: true,
      fxRate: null,
      allowToggle: false,
      allowLocaleToggle: false,
      showFxHints: false,
      formatLedgerMoney: (a, l) => formatLedgerMoney(a, l),
      formatBrowseMoney: (a, opts) =>
        formatLedgerMoney(a, opts?.locale ?? "en"),
      formatCheckoutMoney: (a, opts) =>
        formatLedgerMoney(a, opts?.locale ?? "en"),
      formatUnitMoney: (a, opts) =>
        formatLedgerMoney(a, opts?.locale ?? "en"),
      formatDisplayMoney: (a, opts) =>
        formatLedgerMoney(a, opts?.locale ?? "en"),
      formatOrderHistoryMoney: fallbackHistory,
      formatHistoricalOrderMoney: fallbackHistory,
      vndToUsd: () => null,
    };
  }
  return ctx;
}
