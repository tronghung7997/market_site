/** Pure helpers for the public shop page: search and sort a shop's products
 *  in the browser (the page loads the whole shop, up to 1,000 products). */

import type { Product } from "../../../../lib/types.ts";
import { effectiveMinPrice } from "../../../../lib/pricing-display.ts";
import { matchesAllWords } from "../../../../lib/text-fold.ts";

export const SHOP_SORTS = ["bestseller", "rating", "newest", "price_asc", "price_desc"] as const;
export type ShopSort = (typeof SHOP_SORTS)[number];

export function isShopSort(value: string | null | undefined): value is ShopSort {
  return !!value && (SHOP_SORTS as readonly string[]).includes(value);
}

/** Priced products first for price sorts; "quote" products go last. */
function priceKey(product: Product, direction: 1 | -1): number {
  const price = effectiveMinPrice(product);
  return price > 0 ? price * direction : Number.POSITIVE_INFINITY;
}

export function filterShopProducts(
  products: Product[],
  { query, categoryId, sort }: { query: string; categoryId: number | null; sort: ShopSort },
): Product[] {
  const rows = products.filter((p) =>
    (categoryId == null || p.category_id === categoryId) && matchesAllWords(`${p.title} ${p.highlight_text ?? ""}`, query),
  );
  const byNewest = (a: Product, b: Product) => (b.created_at ?? "").localeCompare(a.created_at ?? "");
  const compare: Record<ShopSort, (a: Product, b: Product) => number> = {
    bestseller: (a, b) => (b.sold_count ?? 0) - (a.sold_count ?? 0) || byNewest(a, b),
    rating: (a, b) => (b.rating_avg ?? 0) - (a.rating_avg ?? 0) || (b.rating_count ?? 0) - (a.rating_count ?? 0),
    newest: byNewest,
    price_asc: (a, b) => priceKey(a, 1) - priceKey(b, 1),
    price_desc: (a, b) => priceKey(a, -1) - priceKey(b, -1),
  };
  return [...rows].sort(compare[sort]);
}
