"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, Wallet as WalletIcon } from "lucide-react";
import { api, vnd } from "@/lib/api";
import type { FundOverview } from "@/lib/types";
import { useAdminAffiliates } from "@/hooks/use-affiliate";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { SearchInput, Pagination } from "@/components/admin";

function FundPanel() {
  const [fund, setFund] = React.useState<FundOverview | null>(null);
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.adminFund().then(setFund).catch(() => {});
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const topup = async () => {
    const n = Number(amount);
    if (!n || n <= 0) return;
    setBusy(true); setMsg(null);
    try {
      const next = await api.adminFundTopup(n, note.trim() || undefined);
      setFund(next);
      setAmount(""); setNote("");
      setMsg(`Đã nạp ${vnd(n)} vào quỹ`);
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Nạp quỹ thất bại");
    } finally {
      setBusy(false);
    }
  };

  const balance = fund?.balance ?? 0;
  const negative = balance < 0;

  return (
    <Card className="p-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr] items-center">
        <div>
          <div className="flex items-center gap-2 text-[12px] text-slate-500 mb-1">
            <WalletIcon size={14} /> Quỹ affiliate
          </div>
          <div className={`font-mono text-[30px] font-semibold tabular-nums leading-none ${negative ? "text-red-600" : "text-slate-900"}`}>
            {vnd(balance)}
          </div>
          <div className="flex gap-4 mt-2 text-[12px] text-slate-500">
            <span>Đã nạp: <span className="font-medium text-slate-700">{vnd(fund?.total_topped_up ?? 0)}</span></span>
            <span>Đã chi: <span className="font-medium text-slate-700">{vnd(fund?.total_paid_out ?? 0)}</span></span>
          </div>
          {negative && (
            <p className="mt-2 text-[12px] text-red-600">Quỹ đang âm — hoa hồng vẫn được trả nhưng bạn nên nạp thêm.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input type="number" min={1} placeholder="Số tiền nạp" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Button disabled={busy || !amount} onClick={topup}>{busy ? "…" : "Nạp quỹ"}</Button>
          </div>
          <Input placeholder="Ghi chú (tuỳ chọn), vd: Ngân sách Q3" value={note} onChange={(e) => setNote(e.target.value)} />
          {msg && <p className="text-[12px] text-emerald-600">{msg}</p>}
        </div>
      </div>
    </Card>
  );
}

export default function AdminAffiliatesPage() {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const perPage = 20;

  const { data, isLoading } = useAdminAffiliates({
    search: appliedSearch || undefined,
    page,
    per_page: perPage,
  });

  const onSearch = (val: string) => {
    setSearch(val);
    setAppliedSearch(val);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[18px] font-semibold text-slate-900">Affiliate</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">Quỹ hoa hồng & hiệu suất giới thiệu theo tài khoản</p>
      </div>

      <FundPanel />

      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-[14px] font-semibold text-slate-900">Danh sách affiliate</h2>
        <SearchInput value={search} onChange={onSearch} placeholder="Tìm theo email…" />
      </div>

      {isLoading || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-5 py-2.5 font-medium">Email</th>
                    <th className="px-5 py-2.5 font-medium">Mã</th>
                    <th className="px-5 py-2.5 font-medium text-right">Nhấp</th>
                    <th className="px-5 py-2.5 font-medium text-right">Đăng ký</th>
                    <th className="px-5 py-2.5 font-medium text-right">Đơn</th>
                    <th className="px-5 py-2.5 font-medium text-right">Hoa hồng</th>
                    <th className="px-5 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/admin/affiliates/${row.id}`)}
                      className="group border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-5 py-2.5 text-slate-700">{row.email}</td>
                      <td className="px-5 py-2.5 font-mono text-[12px] text-indigo-600">{row.affiliate_code}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{row.clicks.toLocaleString("vi-VN")}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{row.signups.toLocaleString("vi-VN")}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{row.orders.toLocaleString("vi-VN")}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-medium">{vnd(row.commission)}</td>
                      <td className="px-5 py-2.5 text-slate-300 group-hover:text-indigo-500 transition-colors">
                        <ArrowRight size={14} />
                      </td>
                    </tr>
                  ))}
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-slate-500">Không tìm thấy affiliate nào.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Pagination page={page} perPage={perPage} total={data.total} onPageChange={setPage} />
        </motion.div>
      )}
    </div>
  );
}
