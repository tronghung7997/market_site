import { fetchPublicJson } from "@/lib/seo";
import type { Category, PaginatedProducts, Product, SearchResult } from "@/lib/types";
import { parseSearchFilters, searchFiltersToApiQuery, type RawSearchQuery, type SearchFilters } from "../model";

export const FALLBACK_PRODUCT_LIMIT = 6;

export type SearchFallback = {
  /** Top-level storefront categories, as browse shortcuts. */
  categories: Category[];
  /** Best-selling products, so an empty result page still has something to open. */
  products: Product[];
};

export type SearchPageData = {
  filters: SearchFilters;
  result: SearchResult | null;
  /** Shown when there is no query or no product hit; null when results exist. */
  fallback: SearchFallback | null;
  /** "load" when the backend could not be reached; null otherwise. */
  error: "load" | null;
};

const EMPTY_RESULT = (filters: SearchFilters): SearchResult => ({
  query: filters.q,
  products: { items: [], total: 0, page: filters.page, per_page: 24 },
  categories: [],
  sellers: [],
});

async function loadFallback(locale: string): Promise<SearchFallback> {
  const [categories, bestsellers] = await Promise.all([
    fetchPublicJson<Category[]>("/categories", locale),
    fetchPublicJson<PaginatedProducts>(`/products?sort=bestseller&per_page=${FALLBACK_PRODUCT_LIMIT}`, locale),
  ]);
  return {
    categories: (categories ?? []).filter((c) => c.parent_id == null && c.is_active !== false),
    products: bestsellers?.items ?? [],
  };
}

/**
 * Server loader for `/[locale]/search`. One signed backend round-trip, shared
 * across visitors for a minute through `fetchPublicJson`'s cache. When the
 * page has nothing to show (no query, or no product matched) it also loads
 * browse shortcuts and bestsellers so the visitor is never left at a dead end.
 */
export async function loadSearchPage(locale: string, raw: RawSearchQuery): Promise<SearchPageData> {
  const filters = parseSearchFilters(raw);
  if (!filters.q) {
    return { filters, result: EMPTY_RESULT(filters), fallback: await loadFallback(locale), error: null };
  }
  const result = await fetchPublicJson<SearchResult>(`/search?${searchFiltersToApiQuery(filters)}`, locale);
  if (!result) {
    return { filters, result: null, fallback: null, error: "load" };
  }
  const fallback = result.products.total === 0 ? await loadFallback(locale) : null;
  return { filters, result, fallback, error: null };
}
