"use client";

import { Suspense, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseProductsFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  const onFiltersChange = useCallback((next: SellerProductsFilters) => {
    router.replace(`${pathname}${productsFiltersToSearch(next)}`, { scroll: false });
  }, [pathname, router]);
  return <SellerProductsConsole filters={filters} onFiltersChange={onFiltersChange} />;
}
