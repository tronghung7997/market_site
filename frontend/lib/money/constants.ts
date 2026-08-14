/** Display currency preference — independent of i18n locale. */
export type DisplayCurrency = "VND" | "USD";

/** Cookie name for SSR + client preference (source of truth for preference). */
export const DISPLAY_CURRENCY_COOKIE = "display_currency";

/** localStorage mirror only — cookie is authoritative for SSR. */
export const DISPLAY_CURRENCY_STORAGE_KEY = "display_currency";

/**
 * Immutable fallback for orders created before snapshot rollout.
 * Must never change after production — old history would drift.
 */
export const LEGACY_ORDER_DISPLAY_FX_RATE = 26_000;

/** Safe FE defaults when /public/money-config is unreachable. */
export const MONEY_CONFIG_FALLBACK = {
  ledger_currency: "VND" as const,
  display_fx_rate: null as number | null,
  display_currency_default: "USD" as DisplayCurrency,
  allow_user_toggle: false,
  allow_locale_toggle: false,
  /** Off → hide rate / VND conversion hints for pure-USD chrome. */
  show_fx_hints: true,
};

export type MoneyConfig = {
  ledger_currency: "VND";
  display_fx_rate: number | null;
  display_currency_default: DisplayCurrency;
  allow_user_toggle: boolean;
  allow_locale_toggle: boolean;
  show_fx_hints: boolean;
};
