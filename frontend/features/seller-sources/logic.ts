/** Pure helpers for the supplier-sources feature (no React). */

import type { SourceCatalogItem, SourceListing } from "@/lib/types";

/** Giá bán gợi ý = vốn × (1 + margin%), làm tròn LÊN bội số `roundTo` —
 *  cùng công thức với backend `sources.suggest_price`. */
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
/* Bảng "Sản phẩm của nguồn": nhóm phân loại theo sản phẩm             */
/* ------------------------------------------------------------------ */

export type ListingGroup = {
  product_id: number;
  product_title: string;
  product_status: string;
  public_key: string;
  seller_id: number;
  rows: SourceListing[];
  /** số phân loại bị gỡ / lãi thấp → hiện cảnh báo trên dòng sản phẩm */
  delisted: number;
  lowMargin: number;
  active: number;
};

export function groupListings(rows: SourceListing[]): ListingGroup[] {
  const map = new Map<number, ListingGroup>();
  for (const r of rows) {
    let g = map.get(r.product_id);
    if (!g) {
      g = {
        product_id: r.product_id, product_title: r.product_title, product_status: r.product_status,
        public_key: r.public_key, seller_id: r.seller_id, rows: [], delisted: 0, lowMargin: 0, active: 0,
      };
      map.set(r.product_id, g);
    }
    g.rows.push(r);
    if (r.sync_error) g.delisted += 1;
    else if (!r.margin_ok) g.lowMargin += 1;
    if (r.variant_active && !r.sync_error && r.margin_ok) g.active += 1;
  }
  return [...map.values()];
}

export function needsAttention(r: SourceListing): boolean {
  return Boolean(r.sync_error) || !r.margin_ok;
}

/* ------------------------------------------------------------------ */
/* Drawer "Thêm sản phẩm" — bước 2: xếp SKU vào sản phẩm               */
/* ------------------------------------------------------------------ */

export type DraftVariant = {
  external_id: string;
  name: string;          // tên catalog gốc
  group: string;         // nhóm catalog
  variant_name: string;
  price: number;
  cost_price: number;
  amount: number;
  /** đích: "new:<key>" hoặc "existing:<product_id>" */
  target: string;
};

export type DraftProduct = {
  key: string;           // "new:<n>"
  title: string;
  category_id: number;
  group: string;
};

export type GroupMode = "auto" | "single" | "one";

/** Gợi ý gộp: auto = theo nhóm catalog; single = mỗi SKU một sản phẩm;
 *  one = tất cả vào một sản phẩm. Trả về danh sách sản phẩm mới + target
 *  cho từng SKU (SKU đã có target existing:* giữ nguyên). */
export function autoGroup(
  items: SourceCatalogItem[], mode: GroupMode, marginPct: number, prev?: DraftVariant[],
): { products: DraftProduct[]; variants: DraftVariant[] } {
  const prevBy = new Map((prev ?? []).map((v) => [v.external_id, v]));
  const products: DraftProduct[] = [];
  const keyByGroup = new Map<string, string>();
  const variants: DraftVariant[] = items.map((it, i) => {
    const old = prevBy.get(it.external_id);
    const price = old?.price ?? suggestPrice(it.cost_price, marginPct);
    const group = it.group_name || it.category_path[0] || "";
    let target: string;
    if (mode === "single") {
      const key = `new:${i}`;
      products.push({ key, title: cleanTitle(it.name), category_id: 0, group });
      target = key;
    } else if (mode === "one") {
      if (products.length === 0) products.push({ key: "new:0", title: group || cleanTitle(it.name), category_id: 0, group });
      target = "new:0";
    } else {
      let key = keyByGroup.get(group);
      if (!key) {
        key = `new:${products.length}`;
        keyByGroup.set(group, key);
        products.push({ key, title: group || cleanTitle(it.name), category_id: 0, group });
      }
      target = key;
    }
    return {
      external_id: it.external_id, name: it.name, group,
      variant_name: mode === "single" ? old?.variant_name ?? "1 tài khoản" : old?.variant_name ?? variantNameFrom(it.name, group),
      price, cost_price: it.cost_price, amount: it.amount, target,
    };
  });
  return { products, variants };
}

/** Sản phẩm mới không còn SKU nào → bỏ khỏi danh sách. */
export function pruneEmpty(products: DraftProduct[], variants: DraftVariant[]): DraftProduct[] {
  const used = new Set(variants.map((v) => v.target));
  return products.filter((p) => used.has(p.key));
}
