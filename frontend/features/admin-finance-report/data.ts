"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Range = { start: string; end: string };

export const financeKeys = {
  all: ["admin", "finance"] as const,
  report: (r: Range) => ["admin", "finance", "report", r] as const,
  checklist: (r: Range) => ["admin", "finance", "checklist", r] as const,
  closes: ["admin", "finance", "closes"] as const,
};

export function useFinanceReport(range: Range) {
  return useQuery({
    queryKey: financeKeys.report(range),
    queryFn: () => api.adminFinanceReport(range),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useCloseChecklist(range: Range, enabled: boolean) {
  return useQuery({
    queryKey: financeKeys.checklist(range),
    queryFn: () => api.adminFinanceCloseChecklist(range),
    enabled,
    staleTime: 0,
  });
}

export function useClosedPeriods() {
  return useQuery({ queryKey: financeKeys.closes, queryFn: api.adminFinanceCloses, staleTime: 60_000 });
}

export function useClosePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.adminFinanceClosePeriod,
    onSuccess: () => qc.invalidateQueries({ queryKey: financeKeys.all }),
  });
}
