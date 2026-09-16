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
   Deep links: `?variant=KEY` (notifications, products table) opens the
   package page with the restock panel; `?product=KEY` searches that product. */
function SellerInventoryRoute() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Both accept the public key (current links) or a numeric id (old links).
  const legacyVariant = searchParams.get("variant")?.trim() || null;
  const legacyProduct = searchParams.get("product")?.trim() || null;

  useEffect(() => {
    if (legacyVariant) {
      router.replace(`/seller/inventory/${encodeURIComponent(legacyVariant)}?restock=1`);
    } else if (legacyProduct) {
      const term = /^\d+$/.test(legacyProduct) ? `#${legacyProduct}` : legacyProduct;
      router.replace(`${pathname}?search=${encodeURIComponent(term)}&products=all`);
    }
  }, [legacyVariant, legacyProduct, pathname, router]);

  const filters = useMemo(() => parseInventoryFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  const onFiltersChange = useCallback((next: InventoryFilters) => {
    router.replace(`${pathname}${inventoryFiltersToSearch(next)}`, { scroll: false });
  }, [pathname, router]);

  if (legacyVariant || legacyProduct) return <InventoryConsoleSkeleton />;
  return <InventoryConsole filters={filters} onFiltersChange={onFiltersChange} />;
}
