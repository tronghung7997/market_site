"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { disputeResourceIds } from "@/lib/dispute-case";
import { useOrderLines } from "@/lib/hooks/useOrderLines";
import { fetchOrderLinesByIds } from "@/lib/order-lines";
import { queryKeys } from "@/lib/query-keys";
import type { Dispute, Order } from "@/lib/types";
import { ordersFiltersToQuery, type SellerOrdersFilters } from "./model";

export function useSellerOrders(filters: SellerOrdersFilters) {
  const params = ordersFiltersToQuery(filters);
  return useQuery({
    queryKey: queryKeys.sellerOrders({ ...params }),
    queryFn: () => api.sellerOrders(params),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

/** `orderRef` is the ORD-XXXXXXXX code from the route, or a numeric id. */
export function useSellerOrder(orderRef: string | number, initial?: Order | null) {
  return useQuery({
    queryKey: queryKeys.sellerOrderDetail(orderRef),
    queryFn: () => api.getOrder(orderRef),
    initialData: initial ?? undefined,
    enabled: Boolean(orderRef),
  });
}

export function useSellerDispute(orderRef: string | number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sellerDispute(orderRef),
    queryFn: () => api.sellerDispute(orderRef),
    enabled: enabled && Boolean(orderRef),
    retry: false,
  });
}

/** The order's delivered lines, a page at a time (see `useOrderLines`). */
export function useSellerOrderResources(orderRef: string | number) {
  return useOrderLines(orderRef, { queryKey: queryKeys.sellerOrderResources(orderRef) });
}

/** The lines a dispute names (chips, line numbers), whether or not their page is loaded. */
export function useSellerCaseLines(orderRef: string | number, dispute: Dispute | null | undefined) {
  const ids = disputeResourceIds(dispute);
  return useQuery({
    queryKey: [...queryKeys.sellerOrderResources(orderRef), "ids", ids] as const,
    queryFn: () => fetchOrderLinesByIds(orderRef, ids),
    enabled: Boolean(orderRef) && ids.length > 0,
  });
}

/** Any seller-side change to an order refreshes every console query. */
export function useInvalidateSellerOrders() {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sellerOrders() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.actionItems() }),
    queryClient.invalidateQueries({ queryKey: ["seller-dashboard"] }),
  ]);
}

export function useAcceptOrder() {
  const invalidate = useInvalidateSellerOrders();
  return useMutation({
    mutationFn: (orderId: number) => api.sellerAcceptOrder(orderId),
    onSuccess: () => void invalidate(),
  });
}

export function useDeliverOrder() {
  const invalidate = useInvalidateSellerOrders();
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: number; data: string }) => api.sellerDeliverOrder(orderId, data),
    onSuccess: () => void invalidate(),
  });
}
