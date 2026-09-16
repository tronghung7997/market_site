"use client";

import { Suspense, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { parseHighlightedResourceIds } from "@/lib/dispute-case";
import { SellerOrderDetail, SellerOrderDetailSkeleton } from "@/features/seller-orders";

export default function SellerOrderDetailPage() {
  return (
    <Suspense fallback={<SellerOrderDetailSkeleton />}>
      <SellerOrderDetailRoute />
    </Suspense>
  );
}

function SellerOrderDetailRoute() {
  // `code` is the ORD-XXXXXXXX order number; old numeric links still resolve.
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const highlight = useMemo(() => parseHighlightedResourceIds(searchParams.get("resources")), [searchParams]);
  const lines = useMemo(() => parseHighlightedResourceIds(searchParams.get("lines")), [searchParams]);
  return <SellerOrderDetail orderRef={code} highlightResourceIds={highlight} highlightLines={lines} />;
}
