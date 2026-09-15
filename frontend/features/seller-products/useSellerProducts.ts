"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { PAGE_SIZE, type SellerProductsFilters } from "./model";

export function useSellerProducts(filters: SellerProductsFilters) {
  const params = {
    page: filters.page,
    perPage: PAGE_SIZE,
    search: filters.search.trim(),
    status: filters.tab,
    categoryIds: filters.categoryIds,
    serviceType: filters.serviceType ?? undefined,
    sort: filters.sort,
  };
  return useQuery({
    queryKey: queryKeys.sellerProducts({ ...params }),
    queryFn: () => api.sellerProducts(params),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useInvalidateSellerProducts() {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sellerProducts() }),
    queryClient.invalidateQueries({ queryKey: ["seller-dashboard"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.actionItems() }),
  ]);
}

export function useToggleProductStatus() {
  const invalidate = useInvalidateSellerProducts();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: "active" | "paused" }) => api.updateSellerProductStatus(id, status),
    onSettled: () => void invalidate(),
  });
}

export function useBulkProductStatus() {
  const invalidate = useInvalidateSellerProducts();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: "active" | "paused" }) => api.bulkUpdateSellerProductStatus(ids, status),
    onSettled: () => void invalidate(),
  });
}
