import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { AdminProduct } from "@/lib/types";

export function useAdminProducts() {
  return useQuery({
    queryKey: queryKeys.products(),
    queryFn: () => api.adminProducts({ perPage: 100 }),
  });
}

export function useProductDetail(id: number | null) {
  return useQuery({
    queryKey: queryKeys.productDetail(id ?? 0),
    queryFn: () => api.adminProducts({ perPage: 100 }),
    enabled: !!id,
  });
}
