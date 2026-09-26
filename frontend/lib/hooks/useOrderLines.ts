import { useCallback, useMemo } from "react";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ORDER_LINES_PAGE } from "@/lib/order-lines";
import type { Resource } from "@/lib/types";

/**
 * An order's delivered lines, loaded a page (200 lines) at a time. Orders can
 * hold thousands of lines of up to 20 KB, so screens show what is loaded and
 * fetch more on demand; `loadAll` is for actions that need every line.
 */
export function useOrderLines(orderRef: string | number, { queryKey, enabled = true }: { queryKey: QueryKey; enabled?: boolean }) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => api.orderResources(orderRef, { after: pageParam, limit: ORDER_LINES_PAGE }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_after,
    enabled: enabled && Boolean(orderRef),
  });
  const { data, hasNextPage, fetchNextPage } = query;
  const rows = useMemo<Resource[]>(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;

  /** Fetch the remaining pages; resolves to every line of the order. */
  const loadAll = useCallback(async (): Promise<Resource[]> => {
    let more = hasNextPage;
    let pages = data?.pages ?? [];
    while (more) {
      const next = await fetchNextPage({ cancelRefetch: false });
      if (next.isError) throw next.error;
      pages = next.data?.pages ?? pages;
      more = next.hasNextPage;
    }
    return pages.flatMap((page) => page.items);
  }, [data, fetchNextPage, hasNextPage]);

  return { ...query, rows, total, complete: data != null && !hasNextPage, loadAll };
}
