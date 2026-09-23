"use client";

/**
 * Data layer for the buyer proxy console: React Query reads of
 * `GET /me/proxies` and `/me/proxy-tags`, cache patching, and the bulk
 * rotate / whitelist runners (per line, through the existing per-order
 * endpoints). Cache ownership stays here; the UI only calls these hooks.
 */
import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ProxyLine, ProxyLineListResponse, ProxyLineQuery, ProxyTag, ProxyTagTone } from "@/lib/types";
import {
  findTagByName, groupImportByTag, lineOrderCode, normalizeTagName, proxyFiltersToQuery, rotateErrorOutcome, rotateSkipReason,
  runBulk, whitelistSkipReason, type BulkResult, type ProxyFilters,
} from "./model";

const LIST_STALE_MS = 15_000;
const ALL_PAGE_SIZE = 100;

type AccountId = number | null | undefined;

export function useProxyLines(filters: ProxyFilters, accountId: AccountId, enabled: boolean) {
  const queryClient = useQueryClient();
  const params = proxyFiltersToQuery(filters);
  const query = useQuery({
    queryKey: queryKeys.proxyLines({ ...params }, accountId),
    queryFn: () => api.myProxies.list(params),
    enabled,
    placeholderData: (previous) => previous,
    staleTime: LIST_STALE_MS,
    refetchOnWindowFocus: true,
  });

  // Warm the next page as soon as this one lands so paging feels instant.
  const total = query.data?.total ?? 0;
  const hasNext = filters.page * filters.perPage < total;
  useEffect(() => {
    if (!enabled || !hasNext || query.isPlaceholderData) return;
    const next = { ...params, page: filters.page + 1 };
    void queryClient.prefetchQuery({
      queryKey: queryKeys.proxyLines(next, accountId),
      queryFn: () => api.myProxies.list(next),
      staleTime: LIST_STALE_MS,
    });
    // params is derived from filters; keying on the serialized form avoids re-running per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasNext, query.isPlaceholderData, JSON.stringify(params), accountId, queryClient]);

  return query;
}

export function useProxyTags(accountId: AccountId, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.proxyTags(accountId),
    queryFn: () => api.myProxies.tags(),
    enabled,
    staleTime: LIST_STALE_MS,
  });
}

/** A deep-linked line (`?line=ORD-…#01`) that is not on the current page:
 *  look it up by its order code. */
export function useProxyLineLookup(lineId: string | null, pageLines: ProxyLine[] | undefined, accountId: AccountId, enabled: boolean) {
  const onPage = lineId ? pageLines?.find((l) => l.id === lineId) ?? null : null;
  const code = lineOrderCode(lineId);
  const query = useQuery({
    queryKey: queryKeys.proxyLines({ lookup: code }, accountId),
    queryFn: () => api.myProxies.list({ q: code ?? "", per_page: ALL_PAGE_SIZE, sort: "line" }),
    enabled: enabled && Boolean(code) && !onPage && pageLines !== undefined,
    staleTime: LIST_STALE_MS,
    retry: false,
  });
  const found = onPage ?? query.data?.items.find((l) => l.id === lineId) ?? null;
  return { line: found, loading: !onPage && query.isFetching, missing: Boolean(lineId) && !found && (query.isFetched || !code) };
}

/** Every line matching `query`, page by page — for "select all matching" and
 *  the CSV tag import, which need lines beyond the visible page. */
export async function fetchAllProxyLines(query: ProxyLineQuery): Promise<ProxyLine[]> {
  const out: ProxyLine[] = [];
  for (let page = 1; ; page += 1) {
    const res = await api.myProxies.list({ ...query, page, per_page: ALL_PAGE_SIZE });
    out.push(...res.items);
    if (res.items.length === 0 || page * ALL_PAGE_SIZE >= res.total) break;
  }
  return out;
}

/** Every line on the account (CSV tag import matches against all of them). */
export function useAllProxyLines(accountId: AccountId, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.proxyLines({ all: true }, accountId),
    queryFn: () => fetchAllProxyLines({ sort: "line" }),
    enabled,
    staleTime: LIST_STALE_MS,
  });
}

export function useInvalidateProxies(accountId: AccountId) {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.proxiesScope(accountId) }),
    [queryClient, accountId],
  );
}

/** Patch one line in every cached list page so the row updates in place;
 *  the background refetch then confirms it. */
export function usePatchCachedLine(accountId: AccountId) {
  const queryClient = useQueryClient();
  return useCallback((lineId: string, patch: Partial<ProxyLine>) => {
    queryClient.setQueriesData<ProxyLineListResponse>(
      { queryKey: queryKeys.proxiesScope(accountId) },
      (prev) => {
        if (!prev || !Array.isArray((prev as ProxyLineListResponse).items)) return prev;
        let touched = false;
        const items = prev.items.map((l) => {
          if (l.id !== lineId) return l;
          touched = true;
          return { ...l, ...patch };
        });
        return touched ? { ...prev, items } : prev;
      },
    );
  }, [queryClient, accountId]);
}

export type LinePatcher = (lineId: string, patch: Partial<ProxyLine>) => void;

/** Rotate each line's exit IP through `POST /orders/{code}/proxy/rotate`.
 *  Lines that cannot rotate are skipped before any request; a 429 is the
 *  line's cooldown and is reported as skipped, not failed. */
export function rotateLines(lines: ProxyLine[], onPatch: LinePatcher, onProgress?: (done: number) => void): Promise<BulkResult> {
  return runBulk(lines, async (line) => {
    try {
      const r = await api.rotateOrderProxy(line.order_code);
      onPatch(line.id, {
        public_ip: r.public_ip,
        last_rotated_at: r.last_rotated_at,
        cooldown_seconds: r.cooldown_seconds ?? line.cooldown_seconds,
        expires_at: r.expires_at,
        status: line.status === "offline" ? "allocated" : line.status,
      });
      return "ok";
    } catch (error) {
      return rotateErrorOutcome(error);
    }
  }, { precheck: (line) => rotateSkipReason(line), onProgress });
}

/** Set (or, with `""`, clear) one IPv4 on every line whose source supports an
 *  allow-list. `applied` lists the lines where it took effect immediately;
 *  the rest take it on their next rotation. */
export async function whitelistLines(lines: ProxyLine[], ipv4: string, onPatch: LinePatcher): Promise<BulkResult & { applied: string[] }> {
  const applied: string[] = [];
  const ips = ipv4 ? [ipv4] : [];
  const result = await runBulk(lines, async (line) => {
    const r = await api.setOrderProxyWhitelist(line.order_code, ips);
    onPatch(line.id, { whitelist_ips: r.whitelist_ips, public_ip: r.public_ip ?? line.public_ip });
    if (r.applied) applied.push(line.id);
    return "ok";
  }, { precheck: whitelistSkipReason });
  return { ...result, applied };
}

/** Create a tag, or return the existing one on a name clash (409). */
export async function ensureTag(name: string, tone: ProxyTagTone, known: ProxyTag[]): Promise<ProxyTag | null> {
  const clean = normalizeTagName(name);
  if (!clean) return null;
  const existing = findTagByName(known, clean);
  if (existing) return existing;
  try {
    return await api.myProxies.createTag(clean, tone);
  } catch (error) {
    if ((error as { status?: number })?.status !== 409) throw error;
    return findTagByName(await api.myProxies.tags(), clean) ?? null;
  }
}

/** Apply a CSV import: create missing tags, then one merge request per tag. */
export async function importTags(perLine: Map<string, string[]>, known: ProxyTag[]): Promise<number> {
  const tags = [...known];
  for (const group of groupImportByTag(perLine)) {
    const tag = await ensureTag(group.name, "iris", tags);
    if (!tag) continue;
    if (!tags.some((t) => t.id === tag.id)) tags.push(tag);
    await api.myProxies.assignTags({ line_ids: group.lineIds, add: [tag.id], remove: [], mode: "merge" });
  }
  return perLine.size;
}
