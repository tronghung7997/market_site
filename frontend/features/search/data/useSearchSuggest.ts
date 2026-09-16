"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useDebounce } from "@/lib/hooks/useDebounce";
import type { Category, SearchSuggest } from "@/lib/types";
import { foldText } from "../model";

const SUGGEST_DEBOUNCE_MS = 120;
const SUGGEST_STALE_MS = 30_000;

/**
 * Typeahead query for the palette.
 *
 * - debounced so a burst of keystrokes costs one request;
 * - keyed by the folded query, so "Tài" and "tai" share a cache entry
 *   (the backend normalises identically);
 * - previous results stay on screen while the next ones load (no flicker);
 * - TanStack cancels the in-flight request when the key changes.
 */
export function useSearchSuggest(term: string, enabled: boolean) {
  const locale = useLocale();
  const debounced = useDebounce(term, SUGGEST_DEBOUNCE_MS);
  const key = foldText(debounced);
  const query = useQuery<SearchSuggest>({
    queryKey: queryKeys.searchSuggest(locale, key),
    queryFn: ({ signal }) => api.searchSuggest(debounced, { signal }),
    enabled: enabled && key.length > 0,
    staleTime: SUGGEST_STALE_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return {
    ...query,
    /** True while the visible results belong to an older query. */
    isStale: query.isPlaceholderData || (enabled && key.length > 0 && foldText(term) !== key),
  };
}

/** Category tree for the empty-state "browse" group; shared with the catalog cache. */
export function useCategoryTree(enabled: boolean) {
  return useQuery<Category[]>({
    queryKey: queryKeys.categoriesTree(),
    queryFn: () => api.categories(),
    enabled,
    staleTime: 5 * 60_000,
  });
}
