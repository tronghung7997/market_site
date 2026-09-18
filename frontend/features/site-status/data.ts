import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Public operational switches; polled so a freeze/maintenance flip shows up
 *  within a minute without a reload. */
export function useSiteStatus() {
  return useQuery({
    queryKey: queryKeys.siteStatus(),
    queryFn: api.publicSiteStatus,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
