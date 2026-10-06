import { fetchPublicJson } from "@/lib/seo";
import { CATALOG_CACHE_TAG } from "@/lib/bff-cache";
import { unstable_cache } from "next/cache";
import { flattenCategories } from "@/lib/categories";
import { isLegacyNumericParam, matchCategoryParam } from "@/lib/routes";
import { browseQueryToListOpts, listOptsToSearchParams } from "./browse-query";
import type { CategoryBrowseQuery, ProductListOpts } from "./browse-query";
import type { Category, CategoryContentPublic, CategoryShelvesResponse, PaginatedProducts, Product, ProductCatalogSummary, ProductDetail, SellerProfile, SellerSummary, ShowcaseReview, TopSeller } from "@/lib/types";

export type HomeCatalog = {
  categories: Category[];
  products: Product[];
  total: number;
  summary: ProductCatalogSummary | null;
  topSellers: TopSeller[];
  latestReviews: ShowcaseReview[];
  error: string | null;
};

export type CategoryShelfTotals = Record<number, { total: number; price_from: number | null }>;

/** What the /categories layout keeps on screen across category pages: the
 *  tree for the rail and header, and the counts beside every node. */
export type CategoryShellData = {
  categories: Category[];
  /** Branch size and "from" price, keyed by top-level category id. */
  shelfTotals: CategoryShelfTotals;
  /** Active products of every category's branch, by category id. */
  categoryTotals: Record<number, number>;
  /** Active products across the catalog. */
  total: number;
  error: string | null;
};

export type CategoryPageCatalog = {
  categories: Category[];
  /** The category the route param resolved to (by slug, or legacy id); null = unknown. */
  category: Category | null;
  /** Slug of the sub-category filter in effect, if any. */
  sub: string | null;
  /** The `/products` request the first page was rendered from; the client
   *  hook reuses `result` for that exact shape and fetches for any other. */
  listOpts: ProductListOpts | null;
  result: PaginatedProducts | null;
  /** Admin-written description, guide and FAQ of the category page. */
  content: CategoryContentPublic | null;
  /** "Tất cả" only: the shops buyers order from most, for the shop strip. */
  topShops?: TopSeller[];
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
  /** Public profile of the product's shop (null when unavailable). */
  seller?: SellerProfile | null;
  /** Up to 3 other products of the same shop. */
  sameShop?: Product[];
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
  ["public-catalog-summary-v2"],
  { revalidate: 600, tags: ["public-catalog-summary", CATALOG_CACHE_TAG] },
);

export async function loadHomeCatalog(locale: string): Promise<HomeCatalog> {
  const [categories, products, summary, topSellers, latestReviews] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<PaginatedProducts>("/products?page=1&per_page=24&sort=bestseller", locale),
    loadCachedCatalogSummary(locale).catch(() => null),
    fetchPublicJson<TopSeller[]>("/sellers/top?limit=6", locale),
    fetchPublicJson<ShowcaseReview[]>("/reviews/latest?limit=6", locale),
  ]);
  const extras = { topSellers: topSellers ?? [], latestReviews: latestReviews ?? [] };
  if (!categories || !products) {
    return { categories: categories ?? [], products: [], total: 0, summary: null, ...extras, error: "load" };
  }
  return {
    categories,
    products: products.items,
    total: products.total,
    summary,
    ...extras,
    error: null,
  };
}

/** One cache key for the hub and every category page: a buyer who opens a
 *  category from the hub then finds its rail totals already cached. */
const SHELVES_PATH = "/products/shelves?per_shelf=8";

/** "Tất cả": the whole catalog in the same grid, filters and sorts as a
 *  category page (no category id), plus the top shops for the shop strip. */
export async function loadCatalogAll(locale: string, query: CategoryBrowseQuery = {}): Promise<CategoryPageCatalog> {
  const listOpts = browseQueryToListOpts(query, null);
  const [categories, result, topShops] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<PaginatedProducts>(`/products?${listOptsToSearchParams(listOpts)}`, locale),
    fetchPublicJson<TopSeller[]>("/sellers/top?limit=8", locale),
  ]);
  return {
    categories: categories ?? [],
    category: null,
    sub: null,
    listOpts,
    result,
    content: null,
    topShops: topShops ?? [],
    error: categories && result ? null : "load",
  };
}

/** Data of the /categories layout (rail + header): the tree and the branch
 *  counts, cached, so every page under it reuses them. */
export async function loadCategoryShell(locale: string): Promise<CategoryShellData> {
  const [categories, shelves] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<CategoryShelvesResponse>(SHELVES_PATH, locale),
  ]);
  return {
    categories: categories ?? [],
    shelfTotals: Object.fromEntries(
      (shelves?.shelves ?? []).map((shelf) => [shelf.category_id, { total: shelf.total, price_from: shelf.price_from }]),
    ),
    categoryTotals: shelves?.category_totals ?? {},
    total: shelves?.total ?? 0,
    error: categories && shelves ? null : "load",
  };
}

export async function loadCategoryPage(
  locale: string,
  /** Route param: the category slug, or a legacy numeric id. */
  categoryRef: string,
  query: CategoryBrowseQuery = {},
): Promise<CategoryPageCatalog> {
  // The admin content is keyed by slug, so it can start with the tree instead
  // of after it; a legacy numeric param resolves first and fetches it below.
  const contentBySlug = isLegacyNumericParam(categoryRef)
    ? null
    : fetchPublicJson<CategoryContentPublic>(`/categories/${encodeURIComponent(categoryRef)}/content`, locale);
  // The rail and header (counts included) live in the /categories layout.
  const categories = await fetchPublicJson<Category[]>("/categories", locale);
  const base = { categories: categories ?? [], sub: null, listOpts: null, result: null, content: null };
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
  const [result, content] = await Promise.all([
    fetchPublicJson<PaginatedProducts>(`/products?${listOptsToSearchParams(listOpts)}`, locale),
    contentBySlug && category.slug === categoryRef
      ? contentBySlug
      : category.slug
        ? fetchPublicJson<CategoryContentPublic>(`/categories/${encodeURIComponent(category.slug)}/content`, locale)
        : Promise.resolve(null),
  ]);
  return {
    ...base,
    category,
    sub: subCategory?.slug ?? null,
    listOpts,
    result,
    content,
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
  const sellerKey = product.seller_key ?? null;
  const [page1, seller, shopPage] = await Promise.all([
    product.category_id
      ? fetchPublicJson<PaginatedProducts>(`/products?category_id=${product.category_id}&page=1&per_page=24`, locale)
      : Promise.resolve(null),
    sellerKey ? fetchPublicJson<SellerProfile>(`/sellers/${encodeURIComponent(sellerKey)}`, locale) : Promise.resolve(null),
    sellerKey
      ? fetchPublicJson<PaginatedProducts>(`/products?seller=${encodeURIComponent(sellerKey)}&sort=bestseller&page=1&per_page=6`, locale)
      : Promise.resolve(null),
  ]);
  const sameShop = (shopPage?.items ?? []).filter((row) => row.id !== product.id).slice(0, 3);
  const shown = new Set(sameShop.map((row) => row.id));
  const seen = new Set<string>();
  const related = (page1?.items ?? []).filter((row) => {
    if (row.id === product.id || shown.has(row.id)) return false;
    if (row.title === product.title) return false;
    if (row.title.length < 3) return false;
    if (seen.has(row.title)) return false;
    seen.add(row.title);
    return true;
  }).slice(0, 3);
  return {
    product,
    related,
    seller,
    sameShop,
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
