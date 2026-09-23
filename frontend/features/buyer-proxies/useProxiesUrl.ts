"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { parseProxyFilters, proxyFiltersToSearch, type ProxyFilters } from "./model";

/** Filters and the open line (`?line=ORD-…#01`) live in the URL, written via
 *  the History API so a filter click never round-trips the server — same
 *  contract as the buyer orders console. */
export function useProxiesUrl() {
  const searchParams = useSearchParams();
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const filters = useMemo(() => parseProxyFilters(params), [params]);
  const lineId = params.get("line");

  const write = useCallback((next: URLSearchParams, mode: "push" | "replace") => {
    const query = next.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  const setFilters = useCallback((next: ProxyFilters) => {
    write(new URLSearchParams(proxyFiltersToSearch(next, new URLSearchParams(window.location.search))), "replace");
  }, [write]);

  const openLine = useCallback((id: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set("line", id);
    write(next, "push");
  }, [write]);

  const closeLine = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    if (!next.has("line")) return;
    next.delete("line");
    write(next, "replace");
  }, [write]);

  return { filters, lineId, setFilters, openLine, closeLine };
}
