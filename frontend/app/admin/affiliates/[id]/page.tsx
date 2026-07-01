"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAdminAffiliateDetail } from "@/hooks/use-affiliate";
import { Button, Input, Spinner } from "@/components/ui";
import { AffiliateStatsView } from "@/components/AffiliateStatsView";

export default function AdminAffiliateDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading } = useAdminAffiliateDetail(id, {
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  });

  return (
    <div className="w-full mx-auto max-w-[1000px] px-6 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/admin/affiliates")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Quay lại
          </Button>
          <h1 className="font-serif text-[24px] tracking-tight">Chi tiết affiliate</h1>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
          <span className="text-muted text-sm">—</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
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
