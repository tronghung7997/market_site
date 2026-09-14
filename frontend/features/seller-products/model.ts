import type { SellerProductSort, SellerProductTab } from "@/lib/types";

export const PAGE_SIZE = 20;
export const PRODUCT_TABS: SellerProductTab[] = ["all", "active", "low_stock", "out_of_stock", "paused", "draft"];
export const PRODUCT_SORTS: SellerProductSort[] = [
  "newest", "oldest", "title", "sold_desc", "rating_desc", "stock_desc", "stock_asc", "price_asc", "price_desc",
];

export interface SellerProductsFilters {
  tab: SellerProductTab;
  search: string;
  category: string | null;
  serviceType: string | null;
  sort: SellerProductSort;
  page: number;
}

export const DEFAULT_PRODUCT_FILTERS: SellerProductsFilters = {
  tab: "all", search: "", category: null, serviceType: null, sort: "newest", page: 1,
};

export function parseProductsFilters(search: URLSearchParams): SellerProductsFilters {
  const tab = search.get("tab");
  const sort = search.get("sort");
  const page = Number(search.get("page"));
  return {
    tab: tab && (PRODUCT_TABS as string[]).includes(tab) ? (tab as SellerProductTab) : "all",
    search: search.get("search") ?? "",
    category: search.get("category") || null,
    serviceType: search.get("service_type") || null,
    sort: sort && (PRODUCT_SORTS as string[]).includes(sort) ? (sort as SellerProductSort) : "newest",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function productsFiltersToSearch(f: SellerProductsFilters): string {
  const q = new URLSearchParams();
  if (f.tab !== "all") q.set("tab", f.tab);
  if (f.search.trim()) q.set("search", f.search.trim());
  if (f.category) q.set("category", f.category);
  if (f.serviceType) q.set("service_type", f.serviceType);
  if (f.sort !== "newest") q.set("sort", f.sort);
  if (f.page > 1) q.set("page", String(f.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function hasActiveProductFilters(f: SellerProductsFilters): boolean {
  return f.tab !== "all" || f.search.trim() !== "" || f.category !== null || f.serviceType !== null;
}
