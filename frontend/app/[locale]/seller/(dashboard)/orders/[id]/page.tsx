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
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const orderId = Number(id);
  const highlight = useMemo(() => parseHighlightedResourceIds(searchParams.get("resources")), [searchParams]);
  return <SellerOrderDetail orderId={orderId} highlightResourceIds={highlight} />;
}
