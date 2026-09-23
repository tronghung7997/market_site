"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  PackagePage,
  PackagePageSkeleton,
  parseResourceFilters,
  resourceFiltersToSearch,
  type ResourceFilters,
} from "@/features/seller-inventory";

export default function SellerInventoryPackagePage() {
  return (
    <Suspense fallback={<PackagePageSkeleton />}>
      <PackageRoute />
    </Suspense>
  );
}

function PackageRoute() {
  // `variantId` is the package's public key (old numeric links still resolve).
  const params = useParams<{ variantId: string }>();
  const variantRef = params.variantId?.trim() ?? "";
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseResourceFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  const onFiltersChange = useCallback((next: ResourceFilters) => {
    // History API, not router.replace: Next syncs useSearchParams from it, so a
    // filter or page change re-renders at once without a server round trip.
    window.history.replaceState(null, "", `${window.location.pathname}${resourceFiltersToSearch(next)}`);
  }, []);
  if (!variantRef) return <PackagePageSkeleton />;
  return <PackagePage variantRef={variantRef} filters={filters} onFiltersChange={onFiltersChange} />;
}
