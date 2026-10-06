"use client";

import { keepPreviousData, useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { PaginatedProducts, Product } from "@/lib/types";
import type { ProductListOpts } from "./browse-query";

/** An offer list that grows as the buyer scrolls: pages after `opts.page`
 *  load on demand (`fetchNextPage`), and a list opened on `?page=N` can also
 *  reach back (`fetchPreviousPage`). The server-rendered page seeds the cache
 *  when its options match, so the first screen needs no request. Rows that
 *  appear twice across pages (the list moved while paging) are dropped. */
export function useInfiniteOffers(
  opts: ProductListOpts,
  seed: { opts: ProductListOpts; data: PaginatedProducts } | null,
  enabled = true,
) {
  const start = Math.max(1, Number(opts.page ?? 1));
  const seeded = seed && JSON.stringify(seed.opts) === JSON.stringify(opts) ? seed.data : undefined;
  const query = useInfiniteQuery<PaginatedProducts, Error, InfiniteData<PaginatedProducts, number>, readonly unknown[], number>({
    queryKey: [...queryKeys.categoryProducts({ ...opts, page: undefined }), "infinite", start],
    queryFn: ({ pageParam, signal }) => api.products({ ...opts, page: pageParam, signal }),
    initialPageParam: start,
    getNextPageParam: (last) => (last.page * last.per_page < last.total ? last.page + 1 : undefined),
    getPreviousPageParam: (first) => (first.page > 1 ? first.page - 1 : undefined),
    initialData: seeded ? { pages: [seeded], pageParams: [start] } : undefined,
    // A filter change keeps the old list on screen (dimmed) until the new one lands.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
  const pages = query.data?.pages ?? [];
  const seen = new Set<number>();
  const items: Product[] = [];
  for (const page of pages) {
    for (const product of page.items) {
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      items.push(product);
    }
  }
  const first = pages[0];
  return {
    ...query,
    items,
    total: first?.total ?? 0,
    perPage: first?.per_page ?? 0,
    /** First loaded page (1 unless the list opened on ?page=N). */
    firstPage: first?.page ?? start,
  };
}
