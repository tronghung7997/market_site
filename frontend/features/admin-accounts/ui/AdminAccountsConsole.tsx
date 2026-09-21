"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { AccountAdminRow, AccountsSummary } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Button, Select, Spinner, Tag } from "@/components/ui";
import { SearchInput, Pagination } from "@/components/admin";
import { ChevronRight, Shield, ShieldCheck, Store, Users } from "@/components/Icons";
import { AccountDetailPanel } from "./AccountDetailPanel";
import { AccountAvatar, AccountFlags, ROLE_LABEL, TIER_VI, relativeTime } from "./shared";

const PER_PAGE = 20;
const ROLE_FILTERS = [
  { key: "", label: "Tất cả" },
  { key: "buyer", label: "Người mua" },
  { key: "seller", label: "Người bán" },
  { key: "admin", label: "Quản trị" },
];
const STATUS_FILTERS = [
  { key: "", label: "Mọi trạng thái" },
  { key: "active", label: "Đang hoạt động" },
  { key: "locked", label: "Đã khóa" },
  { key: "unverified", label: "Chưa xác minh email" },
  { key: "2fa", label: "Đã bật 2FA" },
  { key: "internal", label: "Seller nội bộ" },
];
const SORTS = [
  { key: "newest", label: "Mới tạo trước" },
  { key: "oldest", label: "Cũ nhất trước" },
  { key: "last_login", label: "Đăng nhập gần đây" },
  { key: "email", label: "Email A→Z" },
];

function StatTile({ icon: Icon, label, value, sub, tone = "neutral", active, onClick }: {
  icon: typeof Users; label: string; value: number; sub?: string;
  tone?: "neutral" | "iris" | "good" | "warn" | "bad"; active?: boolean; onClick?: () => void;
}) {
  const iconTone = { neutral: "bg-raised text-muted", iris: "bg-iris-soft text-iris", good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad" }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-card border bg-card px-4 py-3 text-left shadow-card transition-colors",
        onClick ? "hover:border-line-2" : "cursor-default",
        active ? "border-iris ring-1 ring-iris/30" : "border-line",
      )}
    >
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", iconTone)}><Icon size={17} /></span>
      <span className="min-w-0">
        <span className="block text-[12px] text-muted">{label}</span>
        <span className="block font-mono text-[18px] font-semibold leading-tight tabular-nums text-fg">{value.toLocaleString("vi-VN")}</span>
        {sub && <span className="block text-[11px] text-faint">{sub}</span>}
      </span>
    </button>
  );
}

/** Admin › Tài khoản: directory with filters, stats and a per-account detail panel. */
export function AdminAccountsConsole() {
  const { account: me } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [applied, setApplied] = React.useState("");
  const [role, setRole] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [sort, setSort] = React.useState("newest");
  const [page, setPage] = React.useState(1);
  const [openId, setOpenId] = React.useState<number | null>(null);

  const params = { search: applied || undefined, role: role || undefined, status: status || undefined, sort, page, per_page: PER_PAGE };
  const query = useQuery({ queryKey: ["admin", "accounts", params], queryFn: () => api.adminAccounts(params), placeholderData: (prev) => prev });
  const summary: AccountsSummary | undefined = query.data?.summary;
  const items = query.data?.items ?? [];
  const openRow = items.find((r) => r.id === openId) ?? null;

  /** Patch one row everywhere it is cached (list pages share the same shape). */
  const patchRow = (updated: AccountAdminRow) => {
    queryClient.setQueriesData<{ items: AccountAdminRow[] } | undefined>({ queryKey: ["admin", "accounts"] }, (old) =>
      old ? { ...old, items: old.items.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) } : old,
    );
    void queryClient.invalidateQueries({ queryKey: ["admin", "accounts"] });
  };

  const setStatusFilter = (next: string) => { setStatus((cur) => (cur === next ? "" : next)); setPage(1); };
  const setRoleFilter = (next: string) => { setRole(next); setPage(1); };
  const hasFilters = Boolean(applied || role || status);

  return (
    <div className="space-y-5">
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[13px] text-muted">Vai trò, hạng người bán, khóa/mở khóa, ví và lịch sử đăng nhập của từng người dùng. Bấm vào một dòng để xem chi tiết.</p>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setApplied(v); setPage(1); }} placeholder="Tìm theo email…" />
      </div>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={Users} label="Tổng tài khoản" value={summary.all} sub={summary.new_7d > 0 ? `+${summary.new_7d} trong 7 ngày` : "Không có tài khoản mới tuần này"} tone="iris" active={!status && !role} onClick={() => { setRole(""); setStatus(""); setPage(1); }} />
          <StatTile icon={Store} label="Người bán" value={summary.sellers} sub={`${summary.internal} nội bộ`} tone="good" active={role === "seller" && !status} onClick={() => { setRole("seller"); setStatus(""); setPage(1); }} />
          <StatTile icon={Shield} label="Đã khóa" value={summary.locked} tone="bad" active={status === "locked"} onClick={() => setStatusFilter("locked")} />
          <StatTile icon={ShieldCheck} label="Chưa xác minh email" value={summary.unverified} sub={`${summary.twofa} đã bật 2FA`} tone="warn" active={status === "unverified"} onClick={() => setStatusFilter("unverified")} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-card p-0.5" role="tablist" aria-label="Lọc theo vai trò">
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={role === f.key}
              onClick={() => setRoleFilter(f.key)}
              className={cn("rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors", role === f.key ? "bg-iris text-surface" : "text-muted hover:text-fg")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Trạng thái" className="h-9 w-auto min-w-[180px] text-[12.5px]">
          {STATUS_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label="Sắp xếp" className="h-9 w-auto min-w-[170px] text-[12.5px]">
          {SORTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setApplied(""); setRole(""); setStatus(""); setPage(1); }}>Bỏ lọc</Button>
        )}
        <span className="ml-auto text-[12px] text-faint">
          {query.data ? `${query.data.total.toLocaleString("vi-VN")} tài khoản` : ""}
          {query.isFetching && query.data ? " · đang tải…" : ""}
        </span>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        {query.isPending ? (
          <div className="grid place-items-center py-20"><Spinner /></div>
        ) : query.isError ? (
          <div className="px-5 py-12 text-center text-[13px] text-bad">Không tải được danh sách tài khoản. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void query.refetch()}>Thử lại</Button></div>
        ) : items.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[13.5px] font-medium text-fg">Không có tài khoản nào khớp.</p>
            <p className="mt-1 text-[12.5px] text-muted">Thử bỏ bớt bộ lọc hoặc tìm theo một phần email.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-raised/40 text-left text-[12px] text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Tài khoản</th>
                  <th className="px-3 py-2.5 font-medium">Vai trò</th>
                  <th className="px-3 py-2.5 font-medium">Hạng người bán</th>
                  <th className="px-3 py-2.5 font-medium">Đăng nhập gần nhất</th>
                  <th className="px-3 py-2.5 font-medium">Tạo lúc</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((row) => {
                  const isSelf = me?.id === row.id;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setOpenId(row.id)}
                      className={cn("cursor-pointer transition-colors hover:bg-raised/40", !row.is_active && "bg-bad-soft/20", openId === row.id && "bg-iris-soft/40")}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <AccountAvatar email={row.email} locked={!row.is_active} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={cn("truncate font-medium", row.is_active ? "text-fg" : "text-muted line-through decoration-bad/50")}>{row.email}</span>
                              {isSelf && <span className="shrink-0 text-[11px] text-faint">(bạn)</span>}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
                              <span className="font-mono">#{row.id}</span>
                              <AccountFlags row={row} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {/* Everyone is a buyer; only say so when it is the whole story. */}
                          {(row.roles.length === 1 ? row.roles : row.roles.filter((r) => r !== "buyer")).map((r) => (
                            <Tag key={r} tone={r === "admin" ? "iris" : r === "seller" ? "good" : "neutral"}>{ROLE_LABEL[r] ?? r}</Tag>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted">
                        {row.roles.includes("seller") ? <Tag tone={row.seller_tier === "enterprise" || row.seller_tier === "trusted" ? "good" : "neutral"}>{TIER_VI[row.seller_tier] ?? row.seller_tier}</Tag> : <span className="text-faint">—</span>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted">{relativeTime(row.last_login_at)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted">{formatDate(row.created_at, "vi")}</td>
                      <td className="px-3 py-3 text-right">
                        <span className="inline-grid h-7 w-7 place-items-center rounded-md text-faint transition-colors group-hover:text-fg"><ChevronRight size={15} /></span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {query.data && query.data.total > PER_PAGE && (
        <Pagination page={page} perPage={PER_PAGE} total={query.data.total} onPageChange={setPage} />
      )}

      <AccountDetailPanel row={openRow} isSelf={openRow ? me?.id === openRow.id : false} onClose={() => setOpenId(null)} onUpdated={patchRow} />
    </div>
  );
}
