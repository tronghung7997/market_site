"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { ExportPage, ExportPageSkeleton, parseExportParams, type ExportTab } from "@/features/seller-inventory";

export default function SellerInventoryExportPage() {
  return (
    <Suspense fallback={<ExportPageSkeleton />}>
      <ExportRoute />
    </Suspense>
  );
}

function ExportRoute() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useMemo(() => parseExportParams(new URLSearchParams(searchParams.toString())), [searchParams]);
  const onTabChange = useCallback((tab: ExportTab) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);
  return <ExportPage params={params} onTabChange={onTabChange} />;
}
