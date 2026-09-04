import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { Order } from "@/lib/types";

export interface OrderFilters {
  status?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  sort?: string;
  page?: number;
  per_page?: number;
}

export function useOrders(filters: OrderFilters = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.orders(filters as Record<string, unknown>),
    queryFn: () => api.orders(filters),
    enabled,
    placeholderData: (previousData) => previousData,
  });
}

export function useOrderDetail(id: number | null) {
  return useQuery({
    queryKey: queryKeys.orderDetail(id ?? 0),
    queryFn: () => api.adminOrderDetail(id!),
    enabled: !!id,
  });
}

export function useOrderStats(enabled = true) {
  return useQuery({
    queryKey: queryKeys.orderStats(),
    queryFn: () => api.orderStats(),
    enabled,
  });
}

export function useRefundDispute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      api.refundDispute(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["disputes"] });
    },
  });
}

export function useRejectDispute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      api.rejectDispute(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["disputes"] });
    },
  });
}
