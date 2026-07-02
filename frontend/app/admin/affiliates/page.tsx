"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { useAdminAffiliates } from "@/hooks/use-affiliate";
import { Card, Spinner } from "@/components/ui";
import { SearchInput, Pagination } from "@/components/admin";
import { vnd } from "@/lib/utils";

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
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">Affiliate</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Hiệu suất giới thiệu theo từng tài khoản</p>
        </div>
        <SearchInput value={search} onChange={onSearch} placeholder="Tìm theo email…" />
      </div>

      {isLoading || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
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
