/**
 * Single money formatting path for the marketplace.
 *
 * Ledger is always integer VND. Display currency (USD/VND) is buyer-facing only
 * and never written back to the API.
 *
 * Intent APIs (do not invent $ / ₫ / Intl outside this module):
 *   formatBrowseMoney      — catalog, nav balance, tiles
 *   formatCheckoutMoney    — product checkout + confirm modal
 *   formatOrderHistoryMoney — past orders (snapshot or legacy rate)
 *   formatLedgerMoney      — admin/forms/settlement (always VND)
 */
import {
  LEGACY_ORDER_DISPLAY_FX_RATE,
  type DisplayCurrency,
} from "./constants";

export type FormatLocale = string; // "en" | "vi" | full BCP-47

function intlLocale(locale: FormatLocale): string {
  if (locale === "vi" || locale.startsWith("vi")) return "vi-VN";
  if (locale === "en" || locale.startsWith("en")) return "en-US";
  return locale || "en-US";
}

function isValidFxRate(rate: number | null | undefined): rate is number {
  return (
    typeof rate === "number" &&
    Number.isFinite(rate) &&
    rate > 0
  );
}

/**
 * Always VND — forms, admin, reconciliation, PayOS deposit amounts.
 * Alias target for legacy `vnd()`.
 */
export function formatLedgerMoney(
  amountVnd: number,
  locale: FormatLocale = "en",
): string {
  const n = Number.isFinite(amountVnd) ? amountVnd : 0;
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
}

export type DisplayMoneyContext = {
  locale?: FormatLocale;
  currency: DisplayCurrency;
  /** VND per 1 USD. Invalid/missing → fall back to VND even if currency is USD. */
  fxRate: number | null | undefined;
};

function formatUsd(
  amountVnd: number,
  locale: FormatLocale,
  fxRate: number,
): string {
  const usd = amountVnd / fxRate;
  if (!Number.isFinite(usd)) {
    return formatLedgerMoney(amountVnd, locale);
  }
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: "USD",
    // vi-VN defaults to "US$" (CLDR); narrowSymbol keeps a plain "$".
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

/**
 * Core convert-then-format once. Never multiplies pre-rounded unit strings.
 * No ≈ prefix — buyer surfaces show a clean price.
 */
function formatByCurrency(
  amountVnd: number,
  { locale = "en", currency, fxRate }: DisplayMoneyContext,
): string {
  if (currency === "USD" && isValidFxRate(fxRate)) {
    return formatUsd(amountVnd, locale, fxRate);
  }
  return formatLedgerMoney(amountVnd, locale);
}

/** Catalog / nav / tiles — display preference, no payment-rail copy. */
export function formatBrowseMoney(
  amountVnd: number,
  ctx: DisplayMoneyContext,
): string {
  return formatByCurrency(amountVnd, ctx);
}

/**
 * Checkout package / unit / total / confirm modal.
 * Always format the raw VND total once — do not multiply rounded unit prices.
 */
export function formatCheckoutMoney(
  amountVnd: number,
  ctx: DisplayMoneyContext,
): string {
  return formatByCurrency(amountVnd, ctx);
}

/**
 * @deprecated Prefer formatBrowseMoney / formatCheckoutMoney.
 * Kept as alias so older call sites keep working; no ≈ prefix.
 */
export function formatDisplayMoney(
  amountVnd: number,
  opts: DisplayMoneyContext & { approx?: boolean },
): string {
  const text = formatByCurrency(amountVnd, opts);
  // approx flag ignored for buyer UX (plan 2026-08-12); kept for API compat.
  void opts.approx;
  return text;
}

export type HistoricalMoneyContext = {
  locale?: FormatLocale;
  currency: DisplayCurrency;
};

export type HistoricalMoneyResult = {
  text: string;
  usedLegacyRate: boolean;
  rateUsed: number | null;
};

/**
 * Order history: snapshot rate if present, else immutable legacy 26_000.
 * Never uses the live site rate for past orders. No ≈ prefix.
 */
export function formatOrderHistoryMoney(
  amountVnd: number,
  snapshotRate: number | null | undefined,
  { locale = "en", currency }: HistoricalMoneyContext,
): HistoricalMoneyResult {
  if (currency !== "USD") {
    return {
      text: formatLedgerMoney(amountVnd, locale),
      usedLegacyRate: false,
      rateUsed: null,
    };
  }

  if (isValidFxRate(snapshotRate)) {
    return {
      text: formatUsd(amountVnd, locale, snapshotRate),
      usedLegacyRate: false,
      rateUsed: snapshotRate,
    };
  }

  return {
    text: formatUsd(amountVnd, locale, LEGACY_ORDER_DISPLAY_FX_RATE),
    usedLegacyRate: true,
    rateUsed: LEGACY_ORDER_DISPLAY_FX_RATE,
  };
}

/** @deprecated Alias of formatOrderHistoryMoney. */
export const formatHistoricalOrderMoney = formatOrderHistoryMoney;

/** Convert VND → USD number for hints (not for display strings). */
export function vndToUsd(
  amountVnd: number,
  fxRate: number | null | undefined,
): number | null {
  if (!isValidFxRate(fxRate)) return null;
  const usd = amountVnd / fxRate;
  return Number.isFinite(usd) ? usd : null;
}

export function parseDisplayCurrency(
  value: string | null | undefined,
): DisplayCurrency | null {
  if (value === "VND" || value === "USD") return value;
  return null;
}
