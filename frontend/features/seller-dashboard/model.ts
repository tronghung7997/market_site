import type { SellerDashboardRangeKey } from "@/lib/types";

export const RANGE_PRESETS: SellerDashboardRangeKey[] = ["7d", "30d", "90d"];
export const DEFAULT_RANGE: SellerDashboardRangeKey = "30d";
export const MAX_CUSTOM_DAYS = 366;

export interface DashboardRangeParams {
  range: SellerDashboardRangeKey;
  /** YYYY-MM-DD, only meaningful when range === "custom". */
  from?: string;
  to?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** URL → params. Anything malformed falls back to the default preset so a
 *  shared link never produces a 400 from the API. */
export function parseDashboardRange(search: URLSearchParams): DashboardRangeParams {
  const range = search.get("range");
  if (range === "custom") {
    const from = search.get("from");
    const to = search.get("to");
    if (isIsoDate(from) && isIsoDate(to) && from <= to) return { range, from, to };
    return { range: DEFAULT_RANGE };
  }
  if (range && (RANGE_PRESETS as string[]).includes(range)) {
    return { range: range as SellerDashboardRangeKey };
  }
  return { range: DEFAULT_RANGE };
}

export function dashboardRangeToSearch(params: DashboardRangeParams): string {
  const search = new URLSearchParams();
  if (params.range === "custom" && params.from && params.to) {
    search.set("range", "custom");
    search.set("from", params.from);
    search.set("to", params.to);
  } else if (params.range !== DEFAULT_RANGE) {
    search.set("range", params.range);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Today as YYYY-MM-DD in the browser's local timezone (matches the API's
 *  `tz` bucketing, unlike `toISOString()` which is UTC). */
export function localIsoDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function customRangeError(from: string, to: string): "missing" | "order" | "too_long" | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return "missing";
  if (to < from) return "order";
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_CUSTOM_DAYS) return "too_long";
  return null;
}

/** Relative change vs the previous period. `null` = no baseline (previous
 *  period was zero), which the UI renders as "new" rather than +∞%. */
export function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** "2026-09-14" → localized short date, parsed as a LOCAL calendar date so
 *  the label never shifts a day across timezones. */
export function formatIsoDate(
  iso: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", options);
}

/** Fixed display order for the status breakdown — matches the lifecycle,
 *  terminal states last. */
export const ORDER_STATUS_ORDER = [
  "completed",
  "delivered",
  "processing",
  "pending",
  "disputed",
  "refunded",
  "cancelled",
] as const;

export type BreakdownStatus = (typeof ORDER_STATUS_ORDER)[number];

/** Tab on /seller/orders that lists this status. */
export function ordersTabForStatus(status: BreakdownStatus): string {
  switch (status) {
    case "pending":
    case "processing":
      return "action_required";
    case "delivered":
      return "escrow";
    case "completed":
      return "completed";
    case "disputed":
      return "disputed";
    case "refunded":
    case "cancelled":
      return "cancelled";
  }
}
