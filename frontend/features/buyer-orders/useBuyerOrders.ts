"use client";

import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { Order, PaginatedOrderResponse } from "@/lib/types";
import { ordersFiltersToQuery, type BuyerOrdersFilters } from "./model";

const LIST_STALE_MS = 15_000;

export function useBuyerOrders(filters: BuyerOrdersFilters, accountId: number | null | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  const params = ordersFiltersToQuery(filters);
  const query = useQuery({
    queryKey: queryKeys.orders({ ...params }, accountId),
    queryFn: () => api.orders(params),
    enabled,
    placeholderData: (previous) => previous,
    staleTime: LIST_STALE_MS,
    refetchOnWindowFocus: true,
  });

  // Warm the next page as soon as this one lands so paging feels instant.
  const total = query.data?.total ?? 0;
  const hasNext = filters.page * filters.perPage < total;
  useEffect(() => {
    if (!enabled || !hasNext || query.isPlaceholderData) return;
    const next = { ...params, page: filters.page + 1 };
    void queryClient.prefetchQuery({
      queryKey: queryKeys.orders(next, accountId),
      queryFn: () => api.orders(next),
      staleTime: LIST_STALE_MS,
    });
    // params is derived from filters; keying on the serialized form avoids re-running per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasNext, query.isPlaceholderData, JSON.stringify(params), accountId, queryClient]);

  return query;
}

export function useBuyerOrderStats(accountId: number | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.orderStats(accountId),
    queryFn: () => api.orderStats(),
    enabled,
    staleTime: LIST_STALE_MS,
    refetchOnWindowFocus: true,
  });
}

/** Fetch one order by code/id when it is not on the current page (deep links). */
export function useBuyerOrder(orderRef: string | null, accountId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.orderByRef(orderRef ?? "", accountId),
    queryFn: () => api.getOrder(orderRef!),
    enabled: Boolean(orderRef),
    staleTime: LIST_STALE_MS,
    retry: false,
  });
}

/** Patch one order everywhere it is cached — every list page (all filter
 *  combinations) and the by-ref detail — in one pass. Cheaper and less flashy
 *  than invalidating: the row updates in place and the background refetch
 *  confirms it. */
export function usePatchCachedOrder(accountId: number | null | undefined) {
  const queryClient = useQueryClient();
  return useCallback((orderId: number, patch: (order: Order) => Order) => {
    queryClient.setQueriesData<PaginatedOrderResponse | Order>(
      { queryKey: queryKeys.ordersScope(accountId) },
      (prev) => {
        if (!prev) return prev;
        if ("items" in prev && Array.isArray(prev.items)) {
          let touched = false;
          const items = prev.items.map((ord) => {
            if (ord.id !== orderId) return ord;
            touched = true;
            return patch(ord);
          });
          return touched ? { ...prev, items } : prev;
        }
        if ("id" in prev && prev.id === orderId) return patch(prev as Order);
        return prev;
      },
    );
  }, [queryClient, accountId]);
}

export function useInvalidateBuyerOrders(accountId: number | null | undefined) {
  const queryClient = useQueryClient();
  return useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.ordersScope(accountId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.orderStats(accountId) }),
  ]), [queryClient, accountId]);
}

export const confirmedPatch = (ord: Order): Order => ({
  ...ord,
  status: "completed",
  has_dispute: false,
  protection: { status: "closed" },
  settlement: { status: "released" },
  fulfillment: ord.fulfillment ? { ...ord.fulfillment, status: "completed" } : ord.fulfillment,
  capabilities: ord.capabilities
    ? { ...ord.capabilities, can_confirm: false, can_dispute: false, can_append_claims: false, can_review: !ord.has_review }
    : ord.capabilities,
});

export const disputeOpenedPatch = (ord: Order): Order => ({
  ...ord,
  has_dispute: true,
  dispute_status: "open",
  protection: { status: "dispute_open" },
  capabilities: ord.capabilities
    ? { ...ord.capabilities, can_confirm: false, can_dispute: false, can_append_claims: true, can_review: false }
    : ord.capabilities,
});

export const reviewedPatch = (ord: Order): Order => ({
  ...ord,
  has_review: true,
  capabilities: ord.capabilities ? { ...ord.capabilities, can_review: false } : ord.capabilities,
});

export function useConfirmOrder(accountId: number | null | undefined) {
  const patchCached = usePatchCachedOrder(accountId);
  const invalidate = useInvalidateBuyerOrders(accountId);
  return useMutation({
    mutationFn: (orderId: number) => api.confirmOrder(orderId),
    onSuccess: (_data, orderId) => {
      patchCached(orderId, confirmedPatch);
      void invalidate();
    },
  });
}
