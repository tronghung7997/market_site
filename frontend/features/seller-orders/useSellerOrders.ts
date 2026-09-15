"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { Order } from "@/lib/types";
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

export function useSellerOrderResources(orderRef: string | number) {
  return useQuery({
    queryKey: queryKeys.sellerOrderResources(orderRef),
    queryFn: () => api.orderResources(orderRef),
    enabled: Boolean(orderRef),
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
