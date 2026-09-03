"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Check, Pencil, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useAdminAffiliateDetail } from "@/hooks/use-affiliate";
import { Button, Input, Spinner } from "@/components/ui";
import { AffiliateStatsView } from "@/components/AffiliateStatsView";

export default function AdminAffiliateDetailPage() {
  const apiErrorMessage = useApiErrorMessage();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading, refetch } = useAdminAffiliateDetail(id, {
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  });

  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startEdit = () => { setCode(data?.code ?? ""); setErr(null); setEditing(true); };
  const cancel = () => { setEditing(false); setErr(null); };

  const saveCode = async () => {
    setBusy(true); setErr(null);
    try {
      await api.adminUpdateAffiliateCode(id, code);
      setEditing(false);
      await refetch();
    } catch (e) {
      setErr(apiErrorMessage(e, "Đổi mã thất bại"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push("/admin/affiliates")}>
            <ArrowLeft size={16} /> Quay lại
          </Button>
          <div className="min-w-0">
            {editing ? (
              <div className="flex items-center gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="w-[160px] font-mono"
                  maxLength={8}
                  placeholder="Mã 4–8 ký tự"
                  autoFocus
                />
                <Button size="sm" disabled={busy} onClick={saveCode}><Check size={14} /> Lưu</Button>
                <Button size="sm" variant="ghost" onClick={cancel}><X size={14} /></Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-[18px] font-semibold text-slate-900 font-mono truncate">
                  {data ? data.code : "Chi tiết affiliate"}
                </h1>
                {data && (
                  <button onClick={startEdit} className="text-slate-400 hover:text-indigo-600 transition-colors" title="Sửa mã ref">
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            )}
            <p className="text-[13px] text-slate-500 mt-0.5">Thống kê giới thiệu của tài khoản</p>
            {err && <p className="text-[12px] text-red-600 mt-1">{err}</p>}
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
        <AffiliateStatsView data={data} moneyMode="ledger" />
      )}
    </div>
  );
}
