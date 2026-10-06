"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  parseProductsFilters,
  productsFiltersToSearch,
  SellerProductsConsole,
  SellerProductsSkeleton,
  type SellerProductsFilters,
} from "@/features/seller-products";

export default function SellerProductsPage() {
  return (
    <Suspense fallback={<SellerProductsSkeleton />}>
      <SellerProductsRoute />
    </Suspense>
  );
}

/* Tab/search/sort/page live in the URL so the console survives reloads and
   the back button, and the overview can deep-link into a filtered view. */
function SellerProductsRoute() {
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseProductsFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  // History API, not router.replace: Next syncs useSearchParams from it without
  // a route round trip, so a slow navigation never overwrites fresh keystrokes.
  const onFiltersChange = useCallback((next: SellerProductsFilters) => {
    window.history.replaceState(null, "", `${window.location.pathname}${productsFiltersToSearch(next)}`);
  }, []);
  return <SellerProductsConsole filters={filters} onFiltersChange={onFiltersChange} />;
}
