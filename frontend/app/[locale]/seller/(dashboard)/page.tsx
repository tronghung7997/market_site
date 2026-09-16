"use client";

import { Suspense, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useApiErrorMessage } from "@/lib/use-api-error";
import {
  dashboardRangeToSearch,
  parseDashboardRange,
  SellerOverview,
  SellerOverviewError,
  SellerOverviewSkeleton,
  useSellerDashboard,
  type DashboardRangeParams,
} from "@/features/seller-dashboard";

export default function SellerDashboardPage() {
  return (
    <Suspense fallback={<SellerOverviewSkeleton />}>
      <SellerDashboardRoute />
    </Suspense>
  );
}

/* The range lives in the URL (?range=7d | ?range=custom&from=&to=) so a view
   can be bookmarked/shared and the browser back button restores it. */
function SellerDashboardRoute() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const apiErrorMessage = useApiErrorMessage();
  const params = useMemo(() => parseDashboardRange(new URLSearchParams(searchParams.toString())), [searchParams]);
  const query = useSellerDashboard(params);

  const onRangeChange = useCallback((next: DashboardRangeParams) => {
    router.replace(`${pathname}${dashboardRangeToSearch(next)}`, { scroll: false });
  }, [pathname, router]);

  if (query.isPending) return <SellerOverviewSkeleton />;
  if (query.isError && !query.data) {
    return <SellerOverviewError message={apiErrorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  return (
    <SellerOverview
      data={query.data}
      params={params}
      refreshing={query.isFetching && query.isPlaceholderData}
      onRangeChange={onRangeChange}
    />
  );
}
