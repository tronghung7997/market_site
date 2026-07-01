import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useAffiliateMe(params?: { date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: queryKeys.affiliateMe(params),
    queryFn: () => api.affiliateMe(params),
  });
}
