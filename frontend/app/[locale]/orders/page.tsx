"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { BuyerOrdersConsole, BuyerOrdersSkeleton } from "@/features/buyer-orders";

/* Every piece of console state (tabs, search, dates, sort, page, the order open
   in the inspector) lives in the URL and is owned by the feature; this route
   only gates on auth and gives `useSearchParams` its Suspense boundary. */
export default function OrdersPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <Suspense fallback={<BuyerOrdersSkeleton />}>
        <OrdersRoute />
      </Suspense>
    </div>
  );
}

function OrdersRoute() {
  const { account, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !account) router.push("/login");
  }, [account, loading, router]);
  return <BuyerOrdersConsole />;
}
