"use client";

import * as React from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, type LedgerQueryParams } from "@/lib/api";
import type { LedgerPage } from "@/lib/types";

export const ledgerKeys = {
  all: ["admin", "ledger"] as const,
  entries: (p: LedgerQueryParams) => ["admin", "ledger", "entries", p] as const,
  summary: (p: LedgerQueryParams) => ["admin", "ledger", "summary", p] as const,
  statement: (id: number, p: { start?: string; end?: string }) => ["admin", "ledger", "statement", id, p] as const,
  group: (key: string) => ["admin", "ledger", "group", key] as const,
  search: (q: string) => ["admin", "ledger", "search", q] as const,
};

export const PAGE_SIZE = 50;

/** Sổ giao dịch, phân trang bằng con trỏ (created_at, id) — "Tải thêm" nối trang. */
export function useLedgerEntries(params: LedgerQueryParams) {
  const query = useInfiniteQuery({
    queryKey: ledgerKeys.entries(params),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.adminLedgerEntries({ ...params, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last: LedgerPage) => last.next_cursor,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const items = React.useMemo(() => {
    const seen = new Set<number>();
    return (query.data?.pages ?? []).flatMap((p) => p.items).filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
  }, [query.data]);
  return { query, items };
}

export function useLedgerSummary(params: LedgerQueryParams) {
  return useQuery({
    queryKey: ledgerKeys.summary(params),
    queryFn: () => api.adminLedgerSummary(params),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useLedgerStatement(accountId: number | null, range: { start?: string; end?: string }) {
  return useQuery({
    queryKey: ledgerKeys.statement(accountId ?? 0, range),
    queryFn: () => api.adminLedgerStatement(accountId!, range),
    enabled: accountId !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useLedgerGroup(key: string | null) {
  return useQuery({
    queryKey: ledgerKeys.group(key ?? ""),
    queryFn: () => api.adminLedgerGroup(key!),
    enabled: key !== null,
    staleTime: 15_000,
  });
}

export function useLedgerSearch(term: string) {
  return useQuery({
    queryKey: ledgerKeys.search(term),
    queryFn: () => api.adminLedgerSearch(term),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
