"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { PaginatedProducts } from "@/lib/types";
import type { ProductListOpts } from "./browse-query";

/** Products of a category for the browse page. The server renders the first
 *  page; every filter/sort/page change after that is a same-origin `/api`
 *  fetch while the previous list stays on screen — no route re-render, no
 *  blank frame. `seed` is the server result so the first key needs no fetch. */
export function useCategoryProducts(
  opts: ProductListOpts,
  seed: { opts: ProductListOpts; data: PaginatedProducts } | null,
) {
  const seeded = seed && JSON.stringify(seed.opts) === JSON.stringify(opts) ? seed.data : undefined;
  return useQuery<PaginatedProducts>({
    queryKey: queryKeys.categoryProducts(opts),
    queryFn: ({ signal }) => api.products({ ...opts, signal }),
    placeholderData: keepPreviousData,
    initialData: seeded,
    staleTime: 30_000,
  });
}
