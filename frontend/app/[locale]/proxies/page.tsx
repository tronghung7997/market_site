"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { BuyerProxiesConsole, BuyerProxiesSkeleton } from "@/features/buyer-proxies";

/* Buyer proxy console: every proxy line the account owns, across orders, with
   tags and bulk actions (`GET /me/proxies`). Filters live in the URL (owned by
   the feature); this route only gates on auth and gives `useSearchParams` its
   Suspense boundary. */
export default function ProxiesPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <Suspense fallback={<BuyerProxiesSkeleton />}>
        <ProxiesRoute />
      </Suspense>
    </div>
  );
}

function ProxiesRoute() {
  const { account, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !account) router.push("/login");
  }, [account, loading, router]);
  return <BuyerProxiesConsole />;
}
