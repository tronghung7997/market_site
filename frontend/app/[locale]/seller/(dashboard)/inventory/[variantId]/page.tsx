"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseResourceFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  const onFiltersChange = useCallback((next: ResourceFilters) => {
    router.replace(`${pathname}${resourceFiltersToSearch(next)}`, { scroll: false });
  }, [pathname, router]);
  if (!variantRef) return <PackagePageSkeleton />;
  return <PackagePage variantRef={variantRef} filters={filters} onFiltersChange={onFiltersChange} />;
}
