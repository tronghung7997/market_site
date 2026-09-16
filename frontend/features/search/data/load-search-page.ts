import { fetchPublicJson } from "@/lib/seo";
import type { SearchResult } from "@/lib/types";
import { parseSearchFilters, searchFiltersToApiQuery, type RawSearchQuery, type SearchFilters } from "../model";

export type SearchPageData = {
  filters: SearchFilters;
  result: SearchResult | null;
  /** "load" when the backend could not be reached; null otherwise. */
  error: "load" | null;
};

const EMPTY_RESULT = (filters: SearchFilters): SearchResult => ({
  query: filters.q,
  products: { items: [], total: 0, page: filters.page, per_page: 24 },
  categories: [],
  sellers: [],
});

/**
 * Server loader for `/[locale]/search`. One signed backend round-trip, shared
 * across visitors for a minute through `fetchPublicJson`'s cache. An empty
 * query renders the "start typing" state without touching the backend.
 */
export async function loadSearchPage(locale: string, raw: RawSearchQuery): Promise<SearchPageData> {
  const filters = parseSearchFilters(raw);
  if (!filters.q) {
    return { filters, result: EMPTY_RESULT(filters), error: null };
  }
  const result = await fetchPublicJson<SearchResult>(`/search?${searchFiltersToApiQuery(filters)}`, locale);
  if (!result) {
    return { filters, result: null, error: "load" };
  }
  return { filters, result, error: null };
}
