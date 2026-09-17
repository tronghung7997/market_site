import type { Order, OrderStats } from "@/lib/types";
// Relative so the model stays loadable by the node test runner (no path alias there).
import { normalizeOrderCode } from "../../lib/order-ref.ts";

export const PAGE_SIZES = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;

/** `""` is "all"; the rest map 1:1 to the backend `?status=` tabs. */
export const ORDER_TABS = ["", "active", "awaiting_confirm", "disputed", "deleted"] as const;
export type BuyerOrderTab = (typeof ORDER_TABS)[number];

export const ORDER_SORTS = ["newest", "oldest", "amount_desc", "amount_asc"] as const;
export type BuyerOrderSort = (typeof ORDER_SORTS)[number];

export const DATE_PRESETS = ["all", "today", "7d", "30d"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export interface BuyerOrdersFilters {
  tab: BuyerOrderTab;
  search: string;
  dateFrom: string;
  dateTo: string;
  sort: BuyerOrderSort;
  page: number;
  perPage: number;
}

export const DEFAULT_FILTERS: BuyerOrdersFilters = {
  tab: "", search: "", dateFrom: "", dateTo: "", sort: "newest", page: 1, perPage: DEFAULT_PAGE_SIZE,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** URL → filters. Unknown values fall back to defaults so old bookmarks and
 *  notification links (`?status=disputed`, `?search=%23ORD-…`) keep working. */
export function parseOrdersFilters(search: URLSearchParams): BuyerOrdersFilters {
  const tab = search.get("status") ?? "";
  const sort = search.get("sort");
  const page = Number(search.get("page"));
  const perPage = Number(search.get("per_page"));
  const dateFrom = search.get("date_from") ?? "";
  const dateTo = search.get("date_to") ?? "";
  // A deep link's `?search=#12&resources=` targets one order; it is not a list filter.
  const rawSearch = search.get("search") ?? "";
  const isDeepLink = Boolean(deepLinkedOrderRef(search));
  return {
    tab: (ORDER_TABS as readonly string[]).includes(tab) ? (tab as BuyerOrderTab) : "",
    search: isDeepLink ? "" : rawSearch,
    dateFrom: ISO_DATE.test(dateFrom) ? dateFrom : "",
    dateTo: ISO_DATE.test(dateTo) ? dateTo : "",
    sort: sort && (ORDER_SORTS as readonly string[]).includes(sort) ? (sort as BuyerOrderSort) : "newest",
    page: Number.isInteger(page) && page > 1 ? page : 1,
    perPage: (PAGE_SIZES as readonly number[]).includes(perPage) ? perPage : DEFAULT_PAGE_SIZE,
  };
}

/** Filters → query string. Keys not owned by the filters (`order`, `lines`,
 *  `resources`, `review`) are carried over from `keep` untouched. */
export function ordersFiltersToSearch(f: BuyerOrdersFilters, keep?: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const key of ["order", "lines", "resources", "review"] as const) {
    const value = keep?.get(key);
    if (value) q.set(key, value);
  }
  if (f.tab) q.set("status", f.tab);
  if (f.search.trim()) q.set("search", f.search.trim());
  if (f.dateFrom) q.set("date_from", f.dateFrom);
  if (f.dateTo) q.set("date_to", f.dateTo);
  if (f.sort !== "newest") q.set("sort", f.sort);
  if (f.page > 1) q.set("page", String(f.page));
  if (f.perPage !== DEFAULT_PAGE_SIZE) q.set("per_page", String(f.perPage));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export interface BuyerOrderQuery {
  status?: string; search?: string; date_from?: string; date_to?: string;
  sort?: string; page?: number; per_page?: number;
}

export function ordersFiltersToQuery(f: BuyerOrdersFilters): BuyerOrderQuery {
  return {
    status: f.tab || undefined,
    search: f.search.trim() || undefined,
    date_from: f.dateFrom || undefined,
    date_to: f.dateTo || undefined,
    sort: f.sort,
    page: f.page,
    per_page: f.perPage,
  };
}

export function hasActiveOrderFilters(f: BuyerOrdersFilters): boolean {
  return f.tab !== "" || f.search.trim() !== "" || f.dateFrom !== "" || f.dateTo !== "" || f.sort !== "newest";
}

/** Order targeted by a notification/deep link: `?order=ORD-…` (or a legacy
 *  `?order_id=12` / `?search=#12&resources=`). */
export function deepLinkedOrderRef(search: URLSearchParams): string | null {
  const direct = (search.get("order") || search.get("order_id") || "").trim();
  if (direct) return direct;
  const raw = (search.get("search") ?? "").trim();
  if (raw.startsWith("#") && (search.has("resources") || search.has("lines"))) {
    const ref = raw.slice(1).trim();
    if (ref) return ref;
  }
  return null;
}

/** `#ORD-3F9K2M7Q`, `#212`, `ord-3f9k2m7q` search one order exactly (the
 *  backend treats `#…` / `ORD-…` as an exact lookup). A bare 8-letter word
 *  such as "facebook" is a title search, even though it has a code's shape. */
export function isExactOrderRefSearch(search: string): boolean {
  const s = search.trim();
  if (s.startsWith("#")) return s.length > 1;
  return /^ord-/i.test(s) && normalizeOrderCode(s) !== null;
}

/** Local calendar date (YYYY-MM-DD) — the browser's zone, not UTC, so "today"
 *  at 01:00 in Hồ Chí Minh is still today. */
export function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const PRESET_DAYS: Record<Exclude<DatePreset, "all">, number> = { today: 0, "7d": 7, "30d": 30 };

export function datePresetRange(preset: DatePreset, now = new Date()): Pick<BuyerOrdersFilters, "dateFrom" | "dateTo"> {
  if (preset === "all") return { dateFrom: "", dateTo: "" };
  const from = new Date(now);
  from.setDate(from.getDate() - PRESET_DAYS[preset]);
  return { dateFrom: localDateString(from), dateTo: localDateString(now) };
}

export function activeDatePreset(f: Pick<BuyerOrdersFilters, "dateFrom" | "dateTo">, now = new Date()): DatePreset | "custom" {
  if (!f.dateFrom && !f.dateTo) return "all";
  for (const preset of ["today", "7d", "30d"] as const) {
    const range = datePresetRange(preset, now);
    if (range.dateFrom === f.dateFrom && range.dateTo === f.dateTo) return preset;
  }
  return "custom";
}

/** Tab counts come straight from `/orders/stats`; "all" is the total. */
export function tabCount(stats: OrderStats | null | undefined, tab: BuyerOrderTab): number | undefined {
  if (!stats) return undefined;
  switch (tab) {
    case "": return stats.total;
    case "active": return stats.active;
    case "awaiting_confirm": return stats.awaiting_confirm;
    case "disputed": return stats.disputed;
    case "deleted": return stats.cancelled_or_refunded;
  }
}

/** Download name for the delivered-data file: the public code, never the row id. */
export function deliveredDataFileName(order: Pick<Order, "order_code" | "quantity">): string {
  return `${order.order_code}_${order.quantity}.txt`;
}

/** Left-border accent for the mobile card / row emphasis. */
export function orderAccentTone(order: Order, disputed: boolean): "bad" | "iris" | "good" | "neutral" | "warn" {
  if (disputed) return "bad";
  if (order.status === "completed") return "iris";
  if (order.status === "delivered") return "good";
  if (order.status === "cancelled" || order.status === "refunded") return "neutral";
  return "warn";
}
