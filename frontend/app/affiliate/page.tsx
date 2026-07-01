"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAffiliateMe } from "@/hooks/use-affiliate";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { AffiliateStatsView } from "@/components/AffiliateStatsView";

export default function AffiliatePage() {
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading, refetch } = useAffiliateMe({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  });

  useEffect(() => {
    if (authLoading) return;
    if (!account) { router.push("/login"); return; }
  }, [account, authLoading, router]);

  if (authLoading || (!account)) {
    return <div className="grid place-items-center py-20"><Spinner /></div>;
  }

  return (
    <div className="w-full mx-auto max-w-[1000px] px-6 py-10">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <h1 className="font-serif text-[28px] tracking-tight">Affiliate</h1>
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
          <span className="text-muted text-sm">—</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
          <Button variant="secondary" size="sm" onClick={() => refetch()}>Lọc</Button>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <AffiliateStatsView data={data} />
      )}
    </div>
  );
}
