/**
 * Public URL builders. Every storefront link to a product, category or seller
 * goes through here so the URL shape lives in one place.
 *
 * Products: `/products/{slug}-{key}` — the 8-char base36 key at the end is
 * what the backend resolves; the slug is decorative and may change. A bare
 * numeric segment is a legacy id link and still resolves server-side, which
 * lets the product page redirect it to the canonical URL.
 *
 * Categories: `/categories/{slug}` (category slugs are unique in the DB).
 * Sellers: `/sellers/{handle}-{key}` (or `/sellers/{key}` while the shop has
 * no business name); legacy `/sellers/{account_id}` still resolves and redirects.
 */

export const PUBLIC_KEY_PATTERN = /^[0-9a-z]{8}$/;
const NUMERIC_PARAM = /^\d+$/;

export type ProductRef = {
  id: number;
  slug?: string | null;
  public_key?: string | null;
  canonical_path?: string | null;
};

export type CategoryRef = {
  id: number;
  slug?: string | null;
};

export type SellerRef = {
  public_key?: string | null;
  /** Slug of the business name; absent until the shop has one. */
  handle?: string | null;
  canonical_path?: string | null;
  /** Legacy fallback only (old cached payloads). */
  account_id?: number | null;
};

export function productPath(product: ProductRef): string {
  if (product.canonical_path) return product.canonical_path;
  if (product.public_key) {
    const slug = product.slug?.trim();
    return slug ? `/products/${slug}-${product.public_key}` : `/products/${product.public_key}`;
  }
  return `/products/${product.id}`;
}

export function categoryPath(category: CategoryRef): string {
  const slug = category.slug?.trim();
  return slug ? `/categories/${slug}` : `/categories/${category.id}`;
}

export function sellerPath(seller: SellerRef): string {
  if (seller.canonical_path) return seller.canonical_path;
  if (seller.public_key) {
    const handle = seller.handle?.trim();
    return handle ? `/sellers/${handle}-${seller.public_key}` : `/sellers/${seller.public_key}`;
  }
  return `/sellers/${seller.account_id ?? ""}`;
}

/** True when the route param already is the seller's canonical URL segment. */
export function sellerParamIsCanonical(param: string, seller: SellerRef): boolean {
  return sellerPath(seller) === `/sellers/${param}`;
}

/** `/products/12` or `/categories/3` — an old id-based link. */
export function isLegacyNumericParam(param: string): boolean {
  return NUMERIC_PARAM.test(param);
}

/**
 * The public key inside a product route param: the segment after the last
 * `-` when it looks like a key (8 base36 chars with at least one letter — an
 * all-digit tail is part of the slug, e.g. "iphone-15"). A bare key with no
 * slug also matches. Returns null for legacy numeric params and garbage.
 */
export function productKeyFromParam(param: string): string | null {
  const tail = param.includes("-") ? param.slice(param.lastIndexOf("-") + 1) : param;
  if (!PUBLIC_KEY_PATTERN.test(tail) || NUMERIC_PARAM.test(tail)) return null;
  return tail;
}

/** True when the route param already is the product's canonical URL segment. */
export function productParamIsCanonical(param: string, product: ProductRef): boolean {
  return productPath(product) === `/products/${param}`;
}

/** Sub-category filter on a category page: accepts a slug or a legacy numeric id. */
export function matchCategoryParam<T extends CategoryRef>(param: string | null | undefined, candidates: T[]): T | null {
  if (!param) return null;
  const trimmed = param.trim();
  if (!trimmed) return null;
  if (isLegacyNumericParam(trimmed)) {
    const id = Number(trimmed);
    return candidates.find((c) => c.id === id) ?? null;
  }
  return candidates.find((c) => c.slug === trimmed) ?? null;
}

/**
 * Seller console routes. Like the storefront they carry public keys, never
 * row ids, so nothing a seller sees (URL bar, notifications, copied links)
 * reveals how many products or packages exist. The id fallbacks only cover
 * cached payloads written before keys existed.
 */
export function sellerProductPath(product: { id: number; public_key?: string | null }): string {
  return `/seller/products/${product.public_key ?? product.id}`;
}

export function sellerInventoryPath(pkg: { variant_id: number; variant_key?: string | null }, query?: string): string {
  const base = `/seller/inventory/${pkg.variant_key ?? pkg.variant_id}`;
  return query ? `${base}?${query}` : base;
}

/** `/seller/inventory?product={key}` — the inventory console searches that product. */
export function sellerInventoryProductQuery(product: { id: number; public_key?: string | null }): string {
  return `/seller/inventory?product=${encodeURIComponent(product.public_key ?? String(product.id))}`;
}
