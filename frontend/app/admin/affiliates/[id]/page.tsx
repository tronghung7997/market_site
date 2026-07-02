"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push("/admin/affiliates")}>
            <ArrowLeft size={16} /> Quay lại
          </Button>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-slate-900 truncate">
              {data ? data.code : "Chi tiết affiliate"}
            </h1>
            <p className="text-[13px] text-slate-500 mt-0.5">Thống kê giới thiệu của tài khoản</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
          <span className="text-slate-400 text-sm">—</span>
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
