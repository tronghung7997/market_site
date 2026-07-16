"use client";

import * as React from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import type { AccountAdminRow } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { Button, Card, Spinner } from "@/components/ui";
import { SearchInput, Pagination } from "@/components/admin";
import { cn } from "@/lib/cn";
import { SELLER_TIERS, sellerTierLabel } from "@/lib/seller-tier";

const ROLES: { key: string; label: string }[] = [
  { key: "buyer", label: "Người mua" },
  { key: "seller", label: "Người bán" },
  { key: "admin", label: "Quản trị" },
];

function sameRoles(a: string[], b: string[]) {
  const sa = [...a].sort().join(",");
  const sb = [...b].sort().join(",");
  return sa === sb;
}

export default function AdminAccountsPage() {
  const { account: me } = useAuth();
  const [search, setSearch] = React.useState("");
  const [applied, setApplied] = React.useState("");
  const [page, setPage] = React.useState(1);
  const perPage = 20;

  const [data, setData] = React.useState<{ items: AccountAdminRow[]; total: number } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [draft, setDraft] = React.useState<Record<number, string[]>>({});
  const [savingId, setSavingId] = React.useState<number | null>(null);
  const [tierSavingId, setTierSavingId] = React.useState<number | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminAccounts({ search: applied || undefined, page, per_page: perPage });
      setData(res);
      setDraft(Object.fromEntries(res.items.map((u) => [u.id, u.roles])));
    } finally {
      setLoading(false);
    }
  }, [applied, page]);
  React.useEffect(() => { load(); }, [load]);

  const onSearch = (val: string) => { setSearch(val); setApplied(val); setPage(1); };

  const toggle = (row: AccountAdminRow, role: string) => {
    setErr(null);
    setDraft((d) => {
      const cur = d[row.id] ?? row.roles;
      const next = cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role];
      return { ...d, [row.id]: next };
    });
  };

  const save = async (row: AccountAdminRow) => {
    const roles = draft[row.id] ?? row.roles;
    setSavingId(row.id); setErr(null);
    try {
      const updated = await api.adminUpdateRoles(row.id, roles);
      setData((d) => d ? { ...d, items: d.items.map((u) => u.id === row.id ? updated : u) } : d);
      setDraft((dr) => ({ ...dr, [row.id]: updated.roles }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cập nhật vai trò thất bại");
      setDraft((dr) => ({ ...dr, [row.id]: row.roles })); // revert
    } finally {
      setSavingId(null);
    }
  };

  const changeTier = async (row: AccountAdminRow, tier: string) => {
    setTierSavingId(row.id); setErr(null);
    try {
      const updated = await api.adminUpdateSellerTier(row.id, tier);
      setData((d) => d ? { ...d, items: d.items.map((u) => u.id === row.id ? updated : u) } : d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cập nhật cấp độ thất bại");
    } finally {
      setTierSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">Tài khoản</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Quản lý vai trò người dùng (người mua / người bán / quản trị)</p>
        </div>
        <SearchInput value={search} onChange={onSearch} placeholder="Tìm theo email…" />
      </div>

      {err && <p className="text-[13px] text-red-600">{err}</p>}

      {loading || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-5 py-2.5 font-medium">Email</th>
                    <th className="px-5 py-2.5 font-medium">Vai trò</th>
                    <th className="px-5 py-2.5 font-medium">Cấp độ người bán</th>
                    <th className="px-5 py-2.5 font-medium w-24" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => {
                    const roles = draft[row.id] ?? row.roles;
                    const dirty = !sameRoles(roles, row.roles);
                    const isSelf = me?.id === row.id;
                    return (
                      <tr key={row.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-5 py-3 text-slate-700">
                          {row.email}
                          {isSelf && <span className="ml-2 text-[11px] text-slate-400">(bạn)</span>}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {ROLES.map((r) => {
                              const on = roles.includes(r.key);
                              return (
                                <button
                                  key={r.key}
                                  onClick={() => toggle(row, r.key)}
                                  className={cn(
                                    "px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors",
                                    on
                                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                      : "bg-white border-slate-200 text-slate-400 hover:border-slate-300",
                                  )}
                                >
                                  {r.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {roles.includes("seller") ? (
                            <select
                              value={row.seller_tier}
                              disabled={tierSavingId === row.id}
                              onChange={(e) => changeTier(row, e.target.value)}
                              className="h-8 rounded-lg bg-white border border-slate-200 px-2 text-[12px] text-slate-700 disabled:opacity-50"
                            >
                              {SELLER_TIERS.map((t) => (
                                <option key={t} value={t}>{sellerTierLabel(t)}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {dirty && (
                            <Button size="sm" disabled={savingId === row.id} onClick={() => save(row)}>
                              {savingId === row.id ? "…" : "Lưu"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {data.items.length === 0 && (
                    <tr><td colSpan={4} className="px-5 py-12 text-center text-slate-500">Không tìm thấy tài khoản nào.</td></tr>
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
