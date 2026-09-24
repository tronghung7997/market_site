"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { browserTimeZone, parseState, stateToQuery, stateToSearch, type AnalyticsState } from "./model";

/** Page state lives in the URL (shareable, back-button friendly). Updates go
 *  through the History API, which Next keeps in sync with useSearchParams
 *  without a route transition. */
export function useAnalyticsState() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const state = useMemo(() => parseState(new URLSearchParams(searchParams.toString())), [searchParams]);

  const update = useCallback(
    (patch: Partial<AnalyticsState>, mode: "push" | "replace" = "replace") => {
      const next = { ...state, ...patch };
      const url = `${pathname}${stateToSearch(next)}`;
      if (mode === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname, state],
  );
  return { state, update };
}

export function useBusinessAnalytics(state: AnalyticsState) {
  const tz = useMemo(browserTimeZone, []);
  // Tab and chart metric are view-only: they never refetch.
  const query = stateToQuery(state, tz);
  return useQuery({
    queryKey: queryKeys.adminBusinessAnalytics(query as unknown as Record<string, unknown>),
    queryFn: ({ signal }) => api.adminBusinessAnalytics(query, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useBusinessFilterOptions() {
  return useQuery({
    queryKey: queryKeys.adminBusinessFilterOptions(),
    queryFn: api.adminBusinessFilterOptions,
    staleTime: 5 * 60_000,
  });
}
