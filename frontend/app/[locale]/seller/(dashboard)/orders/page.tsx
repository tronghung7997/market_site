"use client";

import { Suspense, useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import {
  deepLinkedOrderId,
  ordersFiltersToSearch,
  parseOrdersFilters,
  SellerOrdersConsole,
  SellerOrdersSkeleton,
  type SellerOrdersFilters,
} from "@/features/seller-orders";

export default function SellerOrdersPage() {
  return (
    <Suspense fallback={<SellerOrdersSkeleton />}>
      <SellerOrdersRoute />
    </Suspense>
  );
}

/* Filters live in the URL so tabs, product/kind/date filters, sort and page
   survive reloads and the back button. Notification links that target one
   order (`?order_id=`, `?search=%2312&resources=`) go to the detail route. */
function SellerOrdersRoute() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const filters = useMemo(() => parseOrdersFilters(params), [params]);

  const detailHref = useCallback((id: number | string, source: URLSearchParams) => {
    const resources = source.get("resources");
    return `/seller/orders/${id}${resources ? `?resources=${encodeURIComponent(resources)}` : ""}`;
  }, []);

  useEffect(() => {
    const id = deepLinkedOrderId(params);
    if (id) router.replace(detailHref(id, params));
  }, [detailHref, params, router]);

  useEffect(() => {
    const onNotificationClick = (event: Event) => {
      const href = (event as CustomEvent<{ href: string }>).detail?.href;
      if (!href) return;
      try {
        const url = new URL(href, window.location.origin);
        if (!url.pathname.includes("/seller/orders")) return;
        const id = deepLinkedOrderId(url.searchParams);
        if (!id) return;
        // The bell already rewrote this page's URL to the deep link; restore
        // the list URL so the back button lands on the list, not on a redirect.
        window.history.replaceState(null, "", `${window.location.pathname}${ordersFiltersToSearch(filters)}`);
        router.push(detailHref(id, url.searchParams));
      } catch {
        // ignore malformed hrefs
      }
    };
    window.addEventListener("app:notification-click", onNotificationClick);
    return () => window.removeEventListener("app:notification-click", onNotificationClick);
  }, [detailHref, filters, router]);

  const onFiltersChange = useCallback((next: SellerOrdersFilters) => {
    router.replace(`${pathname}${ordersFiltersToSearch(next)}`, { scroll: false });
  }, [pathname, router]);

  return <SellerOrdersConsole filters={filters} onFiltersChange={onFiltersChange} />;
}
