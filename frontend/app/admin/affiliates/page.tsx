"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
    <div className="w-full mx-auto max-w-[1100px] px-6 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <h1 className="font-serif text-[24px] tracking-tight">Affiliate</h1>
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder="Tìm theo email…"
        />
      </div>

      {isLoading || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-muted border-b border-default bg-slate-50">
                    <th className="py-3 px-4 font-medium">Email</th>
                    <th className="py-3 px-4 font-medium">Mã</th>
                    <th className="py-3 px-4 font-medium text-right">Nhấp</th>
                    <th className="py-3 px-4 font-medium text-right">Đăng ký</th>
                    <th className="py-3 px-4 font-medium text-right">Đơn</th>
                    <th className="py-3 px-4 font-medium text-right">Hoa hồng</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/admin/affiliates/${row.id}`)}
                      className="border-b border-default last:border-0 cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-3 px-4">{row.email}</td>
                      <td className="py-3 px-4 font-mono text-[12px] text-iris-hi">{row.affiliate_code}</td>
                      <td className="py-3 px-4 text-right tabular-nums">{row.clicks}</td>
                      <td className="py-3 px-4 text-right tabular-nums">{row.signups}</td>
                      <td className="py-3 px-4 text-right tabular-nums">{row.orders}</td>
                      <td className="py-3 px-4 text-right tabular-nums font-medium">{vnd(row.commission)}</td>
                    </tr>
                  ))}
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted">Không có kết quả.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Pagination
            page={page}
            perPage={perPage}
            total={data.total}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
