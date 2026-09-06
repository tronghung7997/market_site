import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { AdminProduct } from "@/lib/types";

export function useAdminProducts() {
  return useQuery({
    queryKey: queryKeys.products(),
    queryFn: () => api.adminProducts({ page: 1, perPage: 50 }),
  });
}

export function useProductDetail(id: number | null) {
  return useQuery({
    queryKey: queryKeys.productDetail(id ?? 0),
    queryFn: () => api.adminProduct(id!),
    enabled: !!id,
  });
}
