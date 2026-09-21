import { fetchPublicJson } from "@/lib/seo";
import { unstable_cache } from "next/cache";
import { flattenCategories } from "@/lib/categories";
import { matchCategoryParam } from "@/lib/routes";
import { browseQueryToListOpts, listOptsToSearchParams } from "./browse-query";
import type { CategoryBrowseQuery, ProductListOpts } from "./browse-query";
import type { Category, CategoryShelf, CategoryShelvesResponse, PaginatedProducts, Product, ProductCatalogSummary, ProductDetail, SellerProfile, SellerSummary } from "@/lib/types";

export type HomeCatalog = {
  categories: Category[];
  products: Product[];
  total: number;
  summary: ProductCatalogSummary | null;
  topSellers: SellerSummary[];
  error: string | null;
};

export type CategoryHubCatalog = {
  categories: Category[];
  /** Keyed by top-level category id. */
  shelves: Record<number, CategoryShelf>;
  /** Active products across the catalog. */
  total: number;
  error: string | null;
};

export type CategoryShelfTotals = Record<number, { total: number; price_from: number | null }>;

export type CategoryPageCatalog = {
  categories: Category[];
  /** Branch totals keyed by top-level category id, for the category rail. */
  shelfTotals: CategoryShelfTotals;
  /** The category the route param resolved to (by slug, or legacy id); null = unknown. */
  category: Category | null;
  /** Slug of the sub-category filter in effect, if any. */
  sub: string | null;
  /** The `/products` request the first page was rendered from; the client
   *  hook reuses `result` for that exact shape and fetches for any other. */
  listOpts: ProductListOpts | null;
  result: PaginatedProducts | null;
  error: string | null;
};

export type { CategoryBrowseQuery } from "./browse-query";

export type SellerPageCatalog = {
  seller: SellerProfile | null;
  products: Product[];
  categories: Category[];
  error: string | null;
};

export type ProductPageCatalog = {
  product: ProductDetail | null;
  related: Product[];
  pricingStrategy: string;
  error: string | null;
};

const loadCachedCatalogSummary = unstable_cache(
  async (locale: string) => {
    const summary = await fetchPublicJson<ProductCatalogSummary>("/products/catalog-summary", locale);
    // Do not cache rollout/network failures as an all-zero advertising metric.
    if (!summary) throw new Error("Catalog summary is unavailable");
    return summary;
  },
  ["public-catalog-summary-v1"],
  { revalidate: 600, tags: ["public-catalog-summary"] },
);

export async function loadHomeCatalog(locale: string): Promise<HomeCatalog> {
  const [categories, products, summary, topSellers] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<PaginatedProducts>("/products?page=1&per_page=24&sort=bestseller", locale),
    loadCachedCatalogSummary(locale).catch(() => null),
    fetchPublicJson<SellerSummary[]>("/sellers/top?limit=6", locale),
  ]);
  if (!categories || !products) {
    return { categories: categories ?? [], products: [], total: 0, summary: null, topSellers: topSellers ?? [], error: "load" };
  }
  return {
    categories,
    products: products.items,
    total: products.total,
    summary,
    topSellers: topSellers ?? [],
    error: null,
  };
}

/** Hub shelves come pre-grouped from the API (8 best sellers per top-level
 *  branch + branch totals) instead of the first 100 products grouped in the
 *  browser — a fraction of the payload and every shelf is complete. */
export async function loadCategoryHub(locale: string): Promise<CategoryHubCatalog> {
  const [categories, shelves] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<CategoryShelvesResponse>("/products/shelves?per_shelf=8", locale),
  ]);
  if (!categories || !shelves) {
    return { categories: categories ?? [], shelves: {}, total: 0, error: "load" };
  }
  return {
    categories,
    shelves: Object.fromEntries(shelves.shelves.map((shelf) => [shelf.category_id, shelf])),
    total: shelves.total,
    error: null,
  };
}

export async function loadCategoryPage(
  locale: string,
  /** Route param: the category slug, or a legacy numeric id. */
  categoryRef: string,
  query: CategoryBrowseQuery = {},
): Promise<CategoryPageCatalog> {
  const [categories, shelves] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<CategoryShelvesResponse>("/products/shelves?per_shelf=1", locale),
  ]);
  const shelfTotals: CategoryShelfTotals = Object.fromEntries(
    (shelves?.shelves ?? []).map((shelf) => [shelf.category_id, { total: shelf.total, price_from: shelf.price_from }]),
  );
  const base = { categories: categories ?? [], shelfTotals, sub: null, listOpts: null, result: null };
  if (!categories) {
    return { ...base, category: null, error: "load" };
  }
  const category = matchCategoryParam(categoryRef, flattenCategories(categories));
  if (!category) {
    return { ...base, category: null, error: null };
  }
  // `?sub=` narrows to one descendant; accepts a slug (current links) or an id (old links).
  const descendants = flattenCategories(category.children ?? []);
  const subCategory = matchCategoryParam(query.sub, descendants);
  const listOpts = browseQueryToListOpts(query, subCategory?.id ?? category.id);
  const result = await fetchPublicJson<PaginatedProducts>(`/products?${listOptsToSearchParams(listOpts)}`, locale);
  return {
    ...base,
    category,
    sub: subCategory?.slug ?? null,
    listOpts,
    result,
    error: result ? null : "load",
  };
}

/**
 * `productRef` is the route param: `{slug}-{key}`, a bare key, or a legacy
 * numeric id — the backend resolves all three. The page compares the result's
 * canonical path with the param and redirects when they differ.
 */
export async function loadProductPage(locale: string, productRef: string): Promise<ProductPageCatalog> {
  const product = await fetchPublicJson<ProductDetail>(`/products/${encodeURIComponent(productRef)}`, locale);
  if (!product) {
    return { product: null, related: [], pricingStrategy: "fixed", error: "missing" };
  }
  let related: Product[] = [];
  if (product.category_id) {
    const page1 = await fetchPublicJson<PaginatedProducts>(
      `/products?category_id=${product.category_id}&page=1&per_page=24`,
      locale,
    );
    const seen = new Set<string>();
    related = (page1?.items ?? []).filter((row) => {
      if (row.id === product.id) return false;
      if (row.title === product.title) return false;
      if (row.title.length < 3) return false;
      if (seen.has(row.title)) return false;
      seen.add(row.title);
      return true;
    }).slice(0, 3);
  }
  return {
    product,
    related,
    pricingStrategy: product.pricing_strategy ?? "fixed",
    error: null,
  };
}

/**
 * `sellerRef` is the route param: `{handle}-{key}`, a bare key, or a legacy
 * account id. The page redirects to `canonical_path` when they differ.
 */
export async function loadSellerPage(locale: string, sellerRef: string): Promise<SellerPageCatalog> {
  const seller = await fetchPublicJson<SellerProfile>(`/sellers/${encodeURIComponent(sellerRef)}`, locale);
  if (!seller) {
    return { seller: null, products: [], categories: [], error: "missing" };
  }
  const [products, categories] = await Promise.all([
    fetchPublicJson<PaginatedProducts>(`/products?seller=${encodeURIComponent(seller.public_key)}&per_page=100`, locale),
    fetchPublicJson<Category[]>("/categories", locale),
  ]);
  return {
    seller,
    products: products?.items ?? [],
    categories: categories ?? [],
    error: products ? null : "load",
  };
}
