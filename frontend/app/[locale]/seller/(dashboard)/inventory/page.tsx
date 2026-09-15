"use client";

import { Suspense, useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import {
  InventoryConsole,
  InventoryConsoleSkeleton,
  inventoryFiltersToSearch,
  parseInventoryFilters,
  type InventoryFilters,
} from "@/features/seller-inventory";

export default function SellerInventoryPage() {
  return (
    <Suspense fallback={<InventoryConsoleSkeleton />}>
      <SellerInventoryRoute />
    </Suspense>
  );
}

/* Filters live in the URL (tab, search, category, sort, grouped/flat, hide
   inactive, page) so reload / back / shared links all land on the same view.
   Legacy deep links: `?variant=ID` (notifications, products table) opens the
   package page with the restock panel; `?product=ID` searches that product. */
function SellerInventoryRoute() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const legacyVariant = Number(searchParams.get("variant")) || null;
  const legacyProduct = Number(searchParams.get("product")) || null;

  useEffect(() => {
    if (legacyVariant) {
      router.replace(`/seller/inventory/${legacyVariant}?restock=1`);
    } else if (legacyProduct) {
      router.replace(`${pathname}?search=${encodeURIComponent(`#${legacyProduct}`)}&products=all`);
    }
  }, [legacyVariant, legacyProduct, pathname, router]);

  const filters = useMemo(() => parseInventoryFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  const onFiltersChange = useCallback((next: InventoryFilters) => {
    router.replace(`${pathname}${inventoryFiltersToSearch(next)}`, { scroll: false });
  }, [pathname, router]);

  if (legacyVariant || legacyProduct) return <InventoryConsoleSkeleton />;
  return <InventoryConsole filters={filters} onFiltersChange={onFiltersChange} />;
}
