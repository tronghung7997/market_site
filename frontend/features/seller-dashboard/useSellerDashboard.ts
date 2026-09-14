"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { browserTimeZone, type DashboardRangeParams } from "./model";

export function useSellerDashboard(params: DashboardRangeParams) {
  const tz = useMemo(browserTimeZone, []);
  const request = { range: params.range, tz, from: params.from, to: params.to };
  return useQuery({
    queryKey: queryKeys.sellerDashboard(request),
    queryFn: () => api.sellerDashboard(request),
    // Keep the previous range on screen while the next one loads so the
    // range picker feels instant instead of flashing a skeleton.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
