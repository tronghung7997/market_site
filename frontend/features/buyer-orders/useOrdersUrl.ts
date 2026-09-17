"use client";

import { useCallback, useMemo } from "react";
import { usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { parseHighlightedResourceIds } from "@/lib/dispute-case";
import { deepLinkedOrderRef, ordersFiltersToSearch, parseOrdersFilters, type BuyerOrdersFilters } from "./model";

/** The buyer console keeps all of its state in the URL: list filters, the
 *  order open in the inspector (`?order=ORD-…`), highlighted stock lines and
 *  the inspector tab. Writes go through the native History API, which Next
 *  syncs back into `useSearchParams`, so a filter change never round-trips
 *  the server the way `router.replace` does. Opening an order pushes an entry
 *  so the back button closes the inspector (what people expect on mobile). */
export function useBuyerOrdersUrl() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const filters = useMemo(() => parseOrdersFilters(params), [params]);
  const orderRef = useMemo(() => deepLinkedOrderRef(params), [params]);
  const highlightResourceIds = useMemo(() => parseHighlightedResourceIds(params.get("resources")), [params]);
  const highlightLines = useMemo(() => parseHighlightedResourceIds(params.get("lines")), [params]);
  const inspectorTab = params.get("review") === "1" ? ("review" as const) : undefined;

  const write = useCallback((next: URLSearchParams, mode: "push" | "replace") => {
    const query = next.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  const setFilters = useCallback((next: BuyerOrdersFilters) => {
    const current = new URLSearchParams(window.location.search);
    write(new URLSearchParams(ordersFiltersToSearch(next, current)), "replace");
  }, [write]);

  const openOrder = useCallback((ref: string, options?: { tab?: "review" }) => {
    const next = new URLSearchParams(window.location.search);
    next.set("order", ref);
    next.delete("order_id");
    if (options?.tab === "review") next.set("review", "1");
    else next.delete("review");
    write(next, next.get("order") === new URLSearchParams(window.location.search).get("order") ? "replace" : "push");
  }, [write]);

  const closeOrder = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    const wasDeepLink = deepLinkedOrderRef(next);
    for (const key of ["order", "order_id", "resources", "lines", "review"]) next.delete(key);
    // `?search=#12&resources=` was a link to one order, not a list filter.
    const search = next.get("search");
    if (wasDeepLink && search && search.startsWith("#")) next.delete("search");
    write(next, "replace");
  }, [write]);

  return { pathname, filters, orderRef, highlightResourceIds, highlightLines, inspectorTab, setFilters, openOrder, closeOrder };
}
