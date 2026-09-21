"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui";
import { AffiliateDashboard } from "@/features/affiliate";

export default function AffiliatePage() {
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !account) router.push("/login");
  }, [account, authLoading, router]);

  if (authLoading || !account) {
    return <div className="grid place-items-center py-20"><Spinner /></div>;
  }
  return <AffiliateDashboard />;
}
