/** Pure helpers for the supplier-sources feature (no React). */

import type { SourceCatalogItem, SourceListing, SupplierSource } from "@/lib/types";

/** URL/API ref of a source: sellers see the public key, never the row id. */
export function sourceRef(area: "admin" | "seller", source: { id: number; public_key: string }): string {
  return area === "seller" ? source.public_key : String(source.id);
}

/** Giá bán gợi ý = vốn × (1 + margin%), làm tròn LÊN bội số `roundTo` —
 *  cùng công thức với backend `suppliers.service.suggest_price`. */
export function suggestPrice(costPrice: number, marginPct: number, roundTo = 1000): number {
  if (costPrice <= 0) return 0;
  const step = Math.max(Math.trunc(roundTo) || 1, 1);
  return Math.ceil((costPrice * (1 + marginPct / 100)) / step) * step;
}

export function marginOf(price: number, cost: number): number | null {
  if (cost <= 0) return null;
  return ((price - cost) / cost) * 100;
}

/** "H30. Clone Ngoại TUT..." → bỏ mã đầu dòng của shop; giữ phần mô tả. */
export function cleanTitle(name: string): string {
  return name.replace(/^[A-Z]{1,3}\d{1,4}\.\s*/i, "").replace(/\s{2,}/g, " ").trim();
}

/** Tên phân loại ngắn: bỏ tiền tố nhóm nếu tên bắt đầu bằng nó
 *  ("Facebook cổ 2018 · 50 bạn" trong nhóm Facebook → "cổ 2018 · 50 bạn"). */
export function variantNameFrom(name: string, group: string): string {
  const cleaned = cleanTitle(name);
  const g = group.trim();
  if (g && cleaned.toLowerCase().startsWith(g.toLowerCase())) {
    const rest = cleaned.slice(g.length).replace(/^[\s\-–—:·|,]+/, "").trim();
    if (rest.length >= 3) return rest;
  }
  return cleaned;
}

/* ------------------------------------------------------------------ */
/* Trạng thái một phân loại: chỉ 3 trạng thái người dùng cần hiểu        */
/* ------------------------------------------------------------------ */

export type ListingState = "selling" | "blocked" | "off";
/** Lý do hệ thống chặn bán — mỗi lý do có đúng một cách sửa. */
export type BlockReason = "delisted" | "lowMargin" | "autoPaused" | "outOfStock";

export function blockReason(r: SourceListing): BlockReason | null {
  if (r.sync_error === "delisted") return "delisted";
  if (r.auto_paused_at) return "autoPaused";
  if (!r.variant_active) return null;
  if (!r.margin_ok) return "lowMargin";
  if (r.sellable <= 0) return "outOfStock";
  return null;
}

/** "off" gồm cả phân loại của sản phẩm chưa đăng (nháp / tạm dừng):
 *  người mua chưa thấy nên không tính là đang bán. */
export function listingState(r: SourceListing): ListingState {
  if (blockReason(r)) return "blocked";
  return r.variant_active && r.product_status === "active" ? "selling" : "off";
}

/** Chặn cần người xử lý (hết hàng ở nguồn thì tự bán lại, không cần làm gì). */
export function needsAction(r: SourceListing): boolean {
  const reason = blockReason(r);
  return reason !== null && reason !== "outOfStock";
}

/** Giá tối thiểu để hết bị chặn vì lãi thấp, và giá theo luật nếu cao hơn. */
export function fixPrice(r: SourceListing, minMarginPct: number, rule: { markup_pct: number; round_to: number }): number {
  const byRule = suggestPrice(r.cost_price, rule.markup_pct, rule.round_to);
  const floor = suggestPrice(r.cost_price, minMarginPct, rule.round_to);
  return Math.max(byRule, floor);
}

/* ------------------------------------------------------------------ */
/* Bảng "Đang bán": nhóm phân loại theo sản phẩm                        */
/* ------------------------------------------------------------------ */

export type ListingGroup = {
  product_id: number;
  product_title: string;
  product_status: string;
  public_key: string;
  group_name: string;
  rows: SourceListing[];
};

export function groupListings(rows: SourceListing[]): ListingGroup[] {
  const map = new Map<number, ListingGroup>();
  for (const r of rows) {
    let g = map.get(r.product_id);
    if (!g) {
      g = {
        product_id: r.product_id, product_title: r.product_title, product_status: r.product_status,
        public_key: r.public_key, group_name: r.group_name, rows: [],
      };
      map.set(r.product_id, g);
    }
    g.rows.push(r);
  }
  return [...map.values()];
}

export type ListingCounts = Record<"all" | ListingState, number>;

export function countListings(rows: SourceListing[]): ListingCounts {
  const out: ListingCounts = { all: rows.length, selling: 0, blocked: 0, off: 0 };
  for (const r of rows) out[listingState(r)] += 1;
  return out;
}

/* ------------------------------------------------------------------ */
/* Nguồn: số dư đủ bao lâu, việc cần làm                               */
/* ------------------------------------------------------------------ */

/** Số ngày bán được với số dư hiện tại, theo mức tiêu 7 ngày qua. */
export function balanceDays(balance: number | null, cost7d: number): number | null {
  if (balance === null || cost7d <= 0) return null;
  return Math.floor(balance / (cost7d / 7));
}

export function lowBalance(s: Pick<SupplierSource, "balance_vnd" | "low_balance_vnd">): boolean {
  const threshold = Number(s.low_balance_vnd ?? 0);
  return s.balance_vnd !== null && threshold > 0 && s.balance_vnd < threshold;
}

export function blockedCount(s: SupplierSource): number {
  return s.listing_error_count + s.listing_low_margin_count + s.listing_auto_paused_count;
}

/* ------------------------------------------------------------------ */
/* Tab "Kho": SKU được chọn sẽ nằm ở đâu                                */
/* ------------------------------------------------------------------ */

export type DraftVariant = {
  external_id: string;
  name: string;          // tên catalog gốc
  group: string;         // nhóm catalog
  variant_name: string;
  price: number;
  cost_price: number;
  amount: number;
  /** đích: "new:<nhóm>" hoặc "existing:<product_id>" */
  target: string;
};

export type DraftProduct = {
  key: string;           // "new:<nhóm>"
  title: string;
  category_id: number;
  group: string;
};

export type ExistingProduct = { product_id: number; product_title: string; group_name: string; variant_names: string[] };

export function existingProducts(rows: SourceListing[]): ExistingProduct[] {
  return groupListings(rows).map((g) => ({
    product_id: g.product_id, product_title: g.product_title, group_name: g.group_name,
    variant_names: g.rows.map((r) => r.variant_name),
  }));
}

/** Xếp SKU đã tick: nhóm nào đã có sản phẩm đang bán → thêm phân loại vào
 *  sản phẩm đó; nhóm chưa có → một sản phẩm mới cho cả nhóm. Tên/giá/đích
 *  người dùng đã sửa (`prev`) được giữ. */
export function planPlacement(
  items: SourceCatalogItem[], existing: ExistingProduct[], rule: { markup_pct: number; round_to: number },
  prev: { products: DraftProduct[]; variants: DraftVariant[] } = { products: [], variants: [] },
): { products: DraftProduct[]; variants: DraftVariant[] } {
  const prevVariants = new Map(prev.variants.map((v) => [v.external_id, v]));
  const prevProducts = new Map(prev.products.map((p) => [p.key, p]));
  const byGroup = new Map<string, number>();
  for (const e of existing) if (e.group_name && !byGroup.has(e.group_name)) byGroup.set(e.group_name, e.product_id);

  const variants: DraftVariant[] = items.map((it) => {
    const group = it.group_name || it.category_path[0] || "";
    const old = prevVariants.get(it.external_id);
    const match = byGroup.get(group);
    return {
      external_id: it.external_id, name: it.name, group,
      variant_name: old?.variant_name ?? variantNameFrom(it.name, group),
      price: old?.price ?? suggestPrice(it.cost_price, rule.markup_pct, rule.round_to),
      cost_price: it.cost_price, amount: it.amount,
      target: old?.target ?? (match ? `existing:${match}` : `new:${group}`),
    };
  });
  const products: DraftProduct[] = [];
  for (const v of variants) {
    if (!v.target.startsWith("new:") || products.some((p) => p.key === v.target)) continue;
    const kept = prevProducts.get(v.target);
    products.push(kept ?? { key: v.target, title: v.group || cleanTitle(v.name), category_id: 0, group: v.group });
  }
  return { products, variants };
}
