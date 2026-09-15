import type {
  InventoryExportColumn,
  InventoryExportMask,
  InventoryPackage,
  InventoryPackageSort,
  InventoryProductStatusFilter,
  InventoryReportBasis,
  InventoryReportGroup,
  InventoryReportMetric,
  InventoryResourceStatus,
  InventoryStockTab,
  ResourceSort,
  ResourceStatusFilter,
  SellerDashboardRangeKey,
} from "@/lib/types";
// Relative import keeps this module loadable by node:test (no path alias).
import { isIsoDate, RANGE_PRESETS } from "../seller-dashboard/model.ts";

// ---------------------------------------------------------------------------
// Packages console (/seller/inventory)
// ---------------------------------------------------------------------------

export const PACKAGE_PAGE_SIZE = 20;
export const STOCK_TABS: InventoryStockTab[] = ["all", "low", "out", "error", "inactive"];
export const PACKAGE_SORTS: InventoryPackageSort[] = ["available_asc", "available_desc", "title", "last_restock", "sold_desc"];
export const PRODUCT_STATUS_FILTERS: InventoryProductStatusFilter[] = ["active", "paused", "all"];

export interface InventoryFilters {
  tab: InventoryStockTab;
  search: string;
  categoryId: number | null;
  productStatus: InventoryProductStatusFilter;
  sort: InventoryPackageSort;
  grouped: boolean;
  hideInactive: boolean;
  page: number;
}

export const DEFAULT_INVENTORY_FILTERS: InventoryFilters = {
  tab: "all", search: "", categoryId: null, productStatus: "active", sort: "available_asc",
  grouped: true, hideInactive: true, page: 1,
};

function pickEnum<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseInventoryFilters(search: URLSearchParams): InventoryFilters {
  const page = Number(search.get("page"));
  const categoryId = Number(search.get("category"));
  return {
    tab: pickEnum(search.get("tab"), STOCK_TABS, "all"),
    search: search.get("search") ?? "",
    categoryId: Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null,
    productStatus: pickEnum(search.get("products"), PRODUCT_STATUS_FILTERS, "active"),
    sort: pickEnum(search.get("sort"), PACKAGE_SORTS, "available_asc"),
    grouped: search.get("view") !== "flat",
    hideInactive: search.get("inactive") !== "show",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function inventoryFiltersToSearch(f: InventoryFilters): string {
  const q = new URLSearchParams();
  if (f.tab !== "all") q.set("tab", f.tab);
  if (f.search.trim()) q.set("search", f.search.trim());
  if (f.categoryId) q.set("category", String(f.categoryId));
  if (f.productStatus !== "active") q.set("products", f.productStatus);
  if (f.sort !== "available_asc") q.set("sort", f.sort);
  if (!f.grouped) q.set("view", "flat");
  if (!f.hideInactive) q.set("inactive", "show");
  if (f.page > 1) q.set("page", String(f.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function hasActiveInventoryFilters(f: InventoryFilters): boolean {
  return f.tab !== "all" || f.search.trim() !== "" || f.categoryId !== null || f.productStatus !== "active";
}

export interface PackageGroup {
  productId: number;
  productTitle: string;
  productStatus: string;
  categoryName: string;
  coverId: string | null;
  available: number;
  sold30d: number;
  error: number;
  packages: InventoryPackage[];
}

/** Rows arrive contiguous per product; fold them into product groups. */
export function groupPackages(items: InventoryPackage[]): PackageGroup[] {
  const groups: PackageGroup[] = [];
  const byProduct = new Map<number, PackageGroup>();
  for (const pkg of items) {
    let group = byProduct.get(pkg.product_id);
    if (!group) {
      group = {
        productId: pkg.product_id, productTitle: pkg.product_title, productStatus: pkg.product_status,
        categoryName: pkg.category_name, coverId: pkg.cover_id, available: 0, sold30d: 0, error: 0, packages: [],
      };
      byProduct.set(pkg.product_id, group);
      groups.push(group);
    }
    group.packages.push(pkg);
    if (pkg.is_active) group.available += pkg.available;
    group.sold30d += pkg.sold_30d;
    group.error += pkg.error;
  }
  return groups;
}

export type StockTone = "good" | "warn" | "bad" | "neutral";

export function stockTone(pkg: Pick<InventoryPackage, "stock_state">): StockTone {
  switch (pkg.stock_state) {
    case "out": return "bad";
    case "low": return "warn";
    case "inactive": return "neutral";
    default: return "good";
  }
}

/** Bar fill for the "available" column: full at 5× the low-stock threshold. */
export function stockBarPercent(available: number, threshold: number): number {
  if (available <= 0) return 0;
  const full = Math.max(threshold * 5, 1);
  return Math.max(2, Math.min(100, Math.round((available / full) * 100)));
}

// ---------------------------------------------------------------------------
// Package page (/seller/inventory/[variantId])
// ---------------------------------------------------------------------------

export const RESOURCE_PAGE_SIZES = [25, 50, 100] as const;
export const RESOURCE_STATUS_TABS: ResourceStatusFilter[] = ["all", "available", "assigned", "error", "expired", "archived"];
export type ResourceDatePreset = "all" | "7d" | "30d" | "90d" | "custom";
export const RESOURCE_DATE_PRESETS: ResourceDatePreset[] = ["all", "7d", "30d", "90d", "custom"];
export type ResourceOrderFilter = "all" | "with" | "without";

export interface ResourceFilters {
  status: ResourceStatusFilter;
  search: string;
  datePreset: ResourceDatePreset;
  from: string;
  to: string;
  order: ResourceOrderFilter;
  sort: ResourceSort;
  page: number;
  perPage: (typeof RESOURCE_PAGE_SIZES)[number];
  restock: boolean;
}

export const DEFAULT_RESOURCE_FILTERS: ResourceFilters = {
  status: "all", search: "", datePreset: "all", from: "", to: "", order: "all", sort: "newest",
  page: 1, perPage: 100, restock: false,
};

export function parseResourceFilters(search: URLSearchParams): ResourceFilters {
  const page = Number(search.get("page"));
  const perPage = Number(search.get("per_page"));
  const preset = pickEnum(search.get("date"), RESOURCE_DATE_PRESETS, "all");
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  const customValid = preset === "custom" && isIsoDate(from) && isIsoDate(to) && from <= to;
  return {
    status: pickEnum(search.get("status"), RESOURCE_STATUS_TABS, "all"),
    search: search.get("search") ?? "",
    datePreset: preset === "custom" && !customValid ? "all" : preset,
    from: customValid ? from : "",
    to: customValid ? to : "",
    order: pickEnum(search.get("order"), ["all", "with", "without"] as const, "all"),
    sort: pickEnum(search.get("sort"), ["newest", "oldest"] as const, "newest"),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    perPage: (RESOURCE_PAGE_SIZES as readonly number[]).includes(perPage) ? (perPage as ResourceFilters["perPage"]) : 100,
    restock: search.get("restock") === "1",
  };
}

export function resourceFiltersToSearch(f: ResourceFilters): string {
  const q = new URLSearchParams();
  if (f.status !== "all") q.set("status", f.status);
  if (f.search.trim()) q.set("search", f.search.trim());
  if (f.datePreset !== "all") q.set("date", f.datePreset);
  if (f.datePreset === "custom" && f.from && f.to) {
    q.set("from", f.from);
    q.set("to", f.to);
  }
  if (f.order !== "all") q.set("order", f.order);
  if (f.sort !== "newest") q.set("sort", f.sort);
  if (f.page > 1) q.set("page", String(f.page));
  if (f.perPage !== 100) q.set("per_page", String(f.perPage));
  if (f.restock) q.set("restock", "1");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Local-midnight ISO bounds for a preset — the API compares timestamptz, so
 *  the browser's own timezone offset rides along in the string. */
export function resourceDateBounds(f: Pick<ResourceFilters, "datePreset" | "from" | "to">): { createdFrom?: string; createdTo?: string } {
  if (f.datePreset === "all") return {};
  if (f.datePreset === "custom") {
    if (!f.from || !f.to) return {};
    return { createdFrom: localDayStart(f.from), createdTo: localDayStart(f.to, 1) };
  }
  const days = { "7d": 7, "30d": 30, "90d": 90 }[f.datePreset];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return { createdFrom: start.toISOString() };
}

/** ISO instant for local midnight of `isoDate` (+ `plusDays`). */
export function localDayStart(isoDate: string, plusDays = 0): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d + plusDays, 0, 0, 0, 0).toISOString();
}

export function hasOrderValue(order: ResourceOrderFilter): boolean | null {
  return order === "with" ? true : order === "without" ? false : null;
}

/** `user|••••••|••••••|mail` — same rule the export uses, for the on-screen mask toggle. */
export function maskResourceData(data: string, token = "••••••"): string {
  const parts = data.split("|");
  if (parts.length >= 3) return [parts[0], ...parts.slice(1, -1).map(() => token), parts[parts.length - 1]].join("|");
  if (parts.length === 2) return `${parts[0]}|${token}`;
  if (data.length > 10) return `${data.slice(0, 4)}${token}${data.slice(-4)}`;
  return data.length > 2 ? `${data.slice(0, 2)}${token}` : token;
}

export function fieldCount(line: string): number {
  return line.split("|").length;
}

// ---------------------------------------------------------------------------
// Export & report page (/seller/inventory/export)
// ---------------------------------------------------------------------------

export type ExportTab = "report" | "goods";
export const EXPORT_MASKS: InventoryExportMask[] = ["none", "middle", "edges", "id_only"];
export const EXPORT_COLUMNS: InventoryExportColumn[] = [
  "category", "product", "variant", "id", "status", "data", "order", "created_at", "assigned_at", "expires_at", "price",
];
export const DEFAULT_EXPORT_COLUMNS: InventoryExportColumn[] = ["product", "variant", "id", "status", "data", "order", "created_at"];
export const RESOURCE_STATUSES: InventoryResourceStatus[] = ["available", "assigned", "error", "expired"];
export const REPORT_GROUPS: InventoryReportGroup[] = ["category", "product", "variant", "day", "week"];
export const REPORT_METRICS: InventoryReportMetric[] = ["added", "sold", "error", "expired", "archived", "stock", "revenue"];
export const DEFAULT_REPORT_METRICS: InventoryReportMetric[] = ["added", "sold", "error", "expired", "stock"];
export const REPORT_BASES: InventoryReportBasis[] = ["created", "assigned"];
export const REPORT_RANGE_KEYS: SellerDashboardRangeKey[] = [...RANGE_PRESETS, "custom"];

/** Tri-state scope selection over the seller's package tree. */
export interface ScopeSelection {
  variantIds: Set<number>;
}

export interface ScopeCategory {
  id: number;
  name: string;
  products: ScopeProduct[];
}

export interface ScopeProduct {
  id: number;
  title: string;
  status: string;
  coverId: string | null;
  packages: InventoryPackage[];
}

export function buildScopeTree(items: InventoryPackage[]): ScopeCategory[] {
  const cats = new Map<number, ScopeCategory>();
  for (const pkg of items) {
    let cat = cats.get(pkg.category_id);
    if (!cat) {
      cat = { id: pkg.category_id, name: pkg.category_name, products: [] };
      cats.set(pkg.category_id, cat);
    }
    let product = cat.products.find((p) => p.id === pkg.product_id);
    if (!product) {
      product = { id: pkg.product_id, title: pkg.product_title, status: pkg.product_status, coverId: pkg.cover_id, packages: [] };
      cat.products.push(product);
    }
    product.packages.push(pkg);
  }
  const out = [...cats.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const cat of out) cat.products.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

export type CheckState = "none" | "some" | "all";

export function checkState(ids: number[], selected: Set<number>): CheckState {
  if (ids.length === 0) return "none";
  const n = ids.filter((id) => selected.has(id)).length;
  return n === 0 ? "none" : n === ids.length ? "all" : "some";
}

export function scopeSummary(tree: ScopeCategory[], selected: Set<number>): { categories: number; products: number; packages: number } {
  let categories = 0;
  let products = 0;
  for (const cat of tree) {
    let catHit = false;
    for (const product of cat.products) {
      if (product.packages.some((p) => selected.has(p.variant_id))) {
        products += 1;
        catHit = true;
      }
    }
    if (catHit) categories += 1;
  }
  return { categories, products, packages: selected.size };
}

/** Compact scope for the API: whole categories/products collapse to their id,
 *  leftovers go as variant ids. Keeps export links short with 100+ packages. */
export function compactScope(tree: ScopeCategory[], selected: Set<number>, includeInactive: boolean): {
  variantIds?: number[]; productIds?: number[]; categoryIds?: number[]; includeInactive?: boolean;
} {
  const categoryIds: number[] = [];
  const productIds: number[] = [];
  const variantIds: number[] = [];
  const eligible = (p: InventoryPackage) => includeInactive || p.is_active;
  for (const cat of tree) {
    const catPkgs = cat.products.flatMap((p) => p.packages).filter(eligible);
    if (catPkgs.length > 0 && catPkgs.every((p) => selected.has(p.variant_id))) {
      categoryIds.push(cat.id);
      continue;
    }
    for (const product of cat.products) {
      const pkgs = product.packages.filter(eligible);
      if (pkgs.length > 0 && pkgs.every((p) => selected.has(p.variant_id))) {
        productIds.push(product.id);
        continue;
      }
      for (const p of pkgs) if (selected.has(p.variant_id)) variantIds.push(p.variant_id);
    }
  }
  return {
    variantIds: variantIds.length ? variantIds : undefined,
    productIds: productIds.length ? productIds : undefined,
    categoryIds: categoryIds.length ? categoryIds : undefined,
    includeInactive: includeInactive || undefined,
  };
}

export function exportFileName(kind: "goods" | "report", packages: number, from?: string, to?: string, ext = "csv"): string {
  const today = new Date().toISOString().slice(0, 10);
  if (kind === "report") return `inventory-report_${from ?? today}_${to ?? today}.${ext}`;
  return `inventory_${packages}-packages_${today}.${ext}`;
}

/** Apply a mask to a sample line for the export page preview. */
export function maskSample(sample: string, mask: InventoryExportMask, maskChar: string): string {
  const token = maskChar.repeat(6);
  if (mask === "none") return sample;
  if (mask === "id_only") return "";
  if (mask === "middle") return maskResourceData(sample, token);
  if (sample.length > 10) return `${sample.slice(0, 4)}${token}${sample.slice(-4)}`;
  return sample.length > 2 ? `${sample.slice(0, 2)}${token}` : token;
}
