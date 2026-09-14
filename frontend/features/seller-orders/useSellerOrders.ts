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

export function useSellerOrder(orderId: number, initial?: Order | null) {
  return useQuery({
    queryKey: queryKeys.sellerOrderDetail(orderId),
    queryFn: () => api.getOrder(orderId),
    initialData: initial ?? undefined,
    enabled: Number.isInteger(orderId) && orderId > 0,
  });
}

export function useSellerDispute(orderId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sellerDispute(orderId),
    queryFn: () => api.sellerDispute(orderId),
    enabled: enabled && orderId > 0,
    retry: false,
  });
}

export function useSellerOrderResources(orderId: number) {
  return useQuery({
    queryKey: queryKeys.sellerOrderResources(orderId),
    queryFn: () => api.orderResources(orderId),
    enabled: orderId > 0,
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
