import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useAffiliateMe(params?: { date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: queryKeys.affiliateMe(params),
    queryFn: () => api.affiliateMe(params),
    // Clicks/orders arrive from other visitors' browsers; refresh when the
    // affiliate returns to this tab instead of serving a stale 60s cache.
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function useAdminAffiliates(params?: { search?: string; page?: number; per_page?: number }) {
  return useQuery({
    queryKey: queryKeys.adminAffiliates(params),
    queryFn: () => api.adminAffiliates(params),
  });
}

export function useAdminAffiliateDetail(id: number, params?: { date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: queryKeys.adminAffiliateDetail(id, params),
    queryFn: () => api.adminAffiliateDetail(id, params),
    enabled: !!id,
  });
}
