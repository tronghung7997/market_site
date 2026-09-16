import type { Dispute, Order, SellerOrderKind, SellerOrderQuery, SellerOrderSort, SellerOrderTab } from "@/lib/types";
import { hasOpenDispute } from "@/lib/order-status";

export const PAGE_SIZE = 20;
export const ORDER_TABS: SellerOrderTab[] = ["all", "disputed", "action_required", "escrow", "completed", "cancelled"];
export const ORDER_KINDS: SellerOrderKind[] = ["instant", "manual", "api", "task", "proxy"];
export const ORDER_SORTS: SellerOrderSort[] = ["newest", "oldest", "amount_desc", "amount_asc"];

export interface SellerOrdersFilters {
  tab: SellerOrderTab;
  search: string;
  /** Product public key (URL `?product=`); legacy `?product_id=` ids still parse. */
  product: string | null;
  kind: SellerOrderKind | null;
  dateFrom: string;
  dateTo: string;
  sort: SellerOrderSort;
  page: number;
}

export const DEFAULT_FILTERS: SellerOrdersFilters = {
  tab: "all", search: "", product: null, kind: null, dateFrom: "", dateTo: "", sort: "newest", page: 1,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** URL → filters. Unknown values fall back to defaults so old bookmarks and
 *  notification links (`?tab=disputed`, `?search=%2312`) keep working. */
export function parseOrdersFilters(search: URLSearchParams): SellerOrdersFilters {
  const tab = search.get("tab");
  const kind = search.get("kind");
  const sort = search.get("sort");
  const product = (search.get("product") || search.get("product_id") || "").trim();
  const page = Number(search.get("page"));
  const dateFrom = search.get("from") ?? "";
  const dateTo = search.get("to") ?? "";
  return {
    tab: tab && (ORDER_TABS as string[]).includes(tab) ? (tab as SellerOrderTab) : "all",
    search: search.get("search") ?? "",
    product: product || null,
    kind: kind && (ORDER_KINDS as string[]).includes(kind) ? (kind as SellerOrderKind) : null,
    dateFrom: ISO_DATE.test(dateFrom) ? dateFrom : "",
    dateTo: ISO_DATE.test(dateTo) ? dateTo : "",
    sort: sort && (ORDER_SORTS as string[]).includes(sort) ? (sort as SellerOrderSort) : "newest",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function ordersFiltersToSearch(f: SellerOrdersFilters): string {
  const q = new URLSearchParams();
  if (f.tab !== "all") q.set("tab", f.tab);
  if (f.search.trim()) q.set("search", f.search.trim());
  if (f.product) q.set("product", f.product);
  if (f.kind) q.set("kind", f.kind);
  if (f.dateFrom) q.set("from", f.dateFrom);
  if (f.dateTo) q.set("to", f.dateTo);
  if (f.sort !== "newest") q.set("sort", f.sort);
  if (f.page > 1) q.set("page", String(f.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function ordersFiltersToQuery(f: SellerOrdersFilters): SellerOrderQuery {
  return {
    tab: f.tab,
    search: f.search.trim() || undefined,
    product: f.product ?? undefined,
    kind: f.kind ?? undefined,
    date_from: f.dateFrom || undefined,
    date_to: f.dateTo || undefined,
    sort: f.sort,
    page: f.page,
    per_page: PAGE_SIZE,
  };
}

export function hasActiveOrderFilters(f: SellerOrdersFilters): boolean {
  return f.tab !== "all" || f.search.trim() !== "" || f.product !== null || f.kind !== null
    || f.dateFrom !== "" || f.dateTo !== "";
}

/** Order targeted by a notification/deep link: `?order=ORD-…` (or a legacy
 *  `?order_id=12` / `?search=#12&resources=`). Returns the raw ref for the
 *  detail route, which resolves codes and ids alike. */
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

export function isOrderDisputed(order: Order, dispute?: Dispute | null): boolean {
  if (dispute) return dispute.status === "open";
  return hasOpenDispute(order);
}

export function closedDisputeStatus(order: Order, dispute?: Dispute | null): string | null {
  const status = dispute?.status && dispute.status !== "open" ? dispute.status : order.dispute_status;
  if (!status || status === "open") return null;
  return status;
}

export function splitDeliveryLines(data: string): string[] {
  return data.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** CSV cell escaping per RFC 4180. */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
