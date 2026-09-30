"use client";

/** Admin › Tài khoản: the directory. Every filter lives in the URL (History
 *  API, like the buyer orders console); rows link to /admin/accounts/{id}. */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AccountBulkStatusResult } from "@/lib/types";
import { Button, Select, Spinner, Tag, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination } from "@/components/admin";
import { useToast } from "@/components/toast";
import { ChevronDown, Download, Search, X } from "@/components/Icons";
import { AccountAvatar, AccountFlags, ROLE_LABEL, TIER_VI, relativeTime } from "./shared";
import {
  accountsQuery, accountsUrlSearch, activeView, DEFAULT_FILTERS, lockLine, parseAccountsUrl, PER_PAGE_OPTIONS, RISK_FLAG_LABEL,
  SAVED_VIEWS, TIERS, type AccountsFilters,
} from "../model";

const STATUS_FILTERS = [
  { key: "", label: "Mọi trạng thái" },
  { key: "active", label: "Đang hoạt động" },
  { key: "locked", label: "Đã khóa" },
  { key: "unverified", label: "Chưa xác minh email" },
  { key: "risky", label: "Đáng ngờ" },
  { key: "new_7d", label: "Mới 7 ngày" },
  { key: "2fa", label: "Đã bật 2FA" },
  { key: "internal", label: "Seller nội bộ" },
];
const ROLE_FILTERS = [
  { key: "", label: "Mọi vai trò" },
  { key: "buyer", label: "Người mua" },
  { key: "seller", label: "Người bán" },
  { key: "admin", label: "Quản trị" },
];
const SORTS = [
  { key: "newest", label: "Mới tạo trước" },
  { key: "oldest", label: "Cũ nhất trước" },
  { key: "last_login", label: "Đăng nhập gần đây" },
  { key: "balance", label: "Số dư cao nhất" },
  { key: "email", label: "Email A→Z" },
];

function useAccountsUrl() {
  const searchParams = useSearchParams();
  const filters = React.useMemo(() => parseAccountsUrl(new URLSearchParams(searchParams.toString())), [searchParams]);
  const setFilters = React.useCallback((patch: Partial<AccountsFilters>) => {
    const current = new URLSearchParams(window.location.search);
    const merged = { ...parseAccountsUrl(current), ...patch };
    // Any filter change starts from page 1 unless the page itself is what changed.
    if (!("page" in patch)) merged.page = 1;
    const qs = accountsUrlSearch(merged, current);
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);
  return { filters, setFilters };
}

function TierPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const label = value.length === 0 ? "Mọi hạng" : value.map((t) => TIER_VI[t] ?? t).join(", ");
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[12.5px] text-fg hover:border-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40"
      >
        <span className="truncate">{label}</span><ChevronDown size={13} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" aria-label="Hạng người bán" className="absolute left-0 top-10 z-20 w-48 rounded-lg border border-line bg-card p-1 shadow-card">
          {TIERS.map((t) => {
            const on = value.includes(t);
            return (
              <label key={t} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-fg hover:bg-raised/60">
                <input type="checkbox" className="accent-[var(--color-iris)]" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])} />
                {TIER_VI[t]}
              </label>
            );
          })}
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[12px] text-muted hover:bg-raised/60">Bỏ chọn hạng</button>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminAccountsConsole() {
  const { account: me } = useAuth();
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const { filters, setFilters } = useAccountsUrl();

  const [searchDraft, setSearchDraft] = React.useState(filters.q);
  React.useEffect(() => { setSearchDraft(filters.q); }, [filters.q]);
  React.useEffect(() => {
    if (searchDraft === filters.q) return;
    const t = setTimeout(() => setFilters({ q: searchDraft }), 300);
    return () => clearTimeout(t);
  }, [searchDraft, filters.q, setFilters]);

  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (document.querySelector("[role='dialog']")) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const params = accountsQuery(filters);
  const query = useQuery({ queryKey: ["admin", "accounts", params], queryFn: () => api.adminAccounts(params), placeholderData: (prev) => prev });
  const summary = query.data?.summary;
  const items = React.useMemo(() => query.data?.items ?? [], [query.data]);
  const view = activeView(filters);

  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const filterKey = JSON.stringify(params);
  React.useEffect(() => { setSelected(new Set()); }, [filterKey]);
  const pageIds = items.filter((r) => r.id !== me?.id).map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: number) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const [lockOpen, setLockOpen] = React.useState(false);
  const [lockReason, setLockReason] = React.useState("");
  const [bulkResult, setBulkResult] = React.useState<AccountBulkStatusResult | null>(null);
  const bulk = useMutation({
    mutationFn: ({ active, reason }: { active: boolean; reason?: string }) => api.adminBulkAccountStatus([...selected], active, reason),
    onSuccess: (res, { active }) => {
      toast.success(`${active ? "Đã mở khóa" : "Đã khóa"} ${res.updated.length} tài khoản${res.skipped.length ? `, bỏ qua ${res.skipped.length}` : ""}`);
      setBulkResult(res.skipped.length ? res : null);
      setLockOpen(res.skipped.length > 0);
      setLockReason("");
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["admin", "accounts"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Cập nhật hàng loạt thất bại")),
  });

  const exportHref = selected.size > 0
    ? api.adminAccountsExportUrl({ ...params, page: undefined, per_page: undefined, ids: [...selected] })
    : api.adminAccountsExportUrl({ ...params, page: undefined, per_page: undefined });

  const hasFilters = Boolean(filters.q || filters.role || filters.status || filters.tier.length || filters.sort !== DEFAULT_FILTERS.sort);

  return (
    <div className="space-y-4">
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-md">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Email, tên shop, SĐT, mã đơn ORD-…, IP, #id"
            aria-label="Tìm tài khoản"
            aria-keyshortcuts="/"
            className="h-9 w-full rounded-lg border border-line bg-card pl-9 pr-10 text-[13px] text-fg placeholder:text-faint focus:border-iris focus:outline-none focus:ring-2 focus:ring-iris/30"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[10.5px] text-faint">/</kbd>
        </div>
        <a href={exportHref} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[12.5px] font-medium text-fg hover:border-line-2" download>
          <Download size={14} />{selected.size > 0 ? `Xuất CSV (${selected.size} đã chọn)` : "Xuất CSV theo bộ lọc"}
        </a>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Chế độ xem">
        {SAVED_VIEWS.map((v) => {
          const count = summary ? v.count(summary) : undefined;
          const on = view === v.key;
          return (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setFilters({ role: v.role, status: v.status, tier: [] })}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
                on ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-card text-muted hover:text-fg",
                v.key === "risky" && !on && (count ?? 0) > 0 && "text-bad",
              )}
            >
              {v.label}
              {count !== undefined && <span className="font-mono text-[11px] tabular-nums">{count.toLocaleString("vi-VN")}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filters.role} onChange={(e) => setFilters({ role: e.target.value })} aria-label="Vai trò" className="h-9 w-auto min-w-[140px] text-[12.5px]">
          {ROLE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
        <TierPicker value={filters.tier} onChange={(tier) => setFilters({ tier })} />
        <Select value={filters.status} onChange={(e) => setFilters({ status: e.target.value })} aria-label="Trạng thái" className="h-9 w-auto min-w-[170px] text-[12.5px]">
          {STATUS_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
        <Select value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value })} aria-label="Sắp xếp" className="h-9 w-auto min-w-[160px] text-[12.5px]">
          {SORTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
        {hasFilters && <Button size="sm" variant="ghost" onClick={() => { setSearchDraft(""); setFilters({ ...DEFAULT_FILTERS, perPage: filters.perPage }); }}>Bỏ lọc</Button>}
        <span className="ml-auto text-[12px] text-faint">
          {query.data ? `${query.data.total.toLocaleString("vi-VN")} tài khoản` : ""}
          {query.isFetching && query.data ? " · đang tải…" : ""}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-card border border-iris/30 bg-iris-soft/60 px-3 py-2 backdrop-blur">
          <span className="text-[12.5px] font-medium text-fg">Đã chọn {selected.size}</span>
          <Button size="sm" variant="danger" onClick={() => { setBulkResult(null); setLockOpen(true); }}>Khóa…</Button>
          <Button size="sm" variant="secondary" loading={bulk.isPending} onClick={() => bulk.mutate({ active: true })}>Mở khóa</Button>
          <a href={exportHref} download className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[12.5px] font-medium text-fg hover:border-line-2"><Download size={14} />Xuất CSV</a>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}><X size={13} />Bỏ chọn</Button>
        </div>
      )}

      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        {query.isPending ? (
          <div className="grid place-items-center py-20"><Spinner /></div>
        ) : query.isError && !query.data ? (
          <div className="px-5 py-12 text-center text-[13px] text-bad">Không tải được danh sách tài khoản. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void query.refetch()}>Thử lại</Button></div>
        ) : items.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[13.5px] font-medium text-fg">Không có tài khoản nào khớp.</p>
            <p className="mt-1 text-[12.5px] text-muted">Thử bỏ bớt bộ lọc, hoặc tìm theo email, #id, mã đơn ORD-… hay IP.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-[13px]">
              <thead className="bg-raised/40 text-left text-[12px] text-muted">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Chọn cả trang"
                      className="accent-[var(--color-iris)]"
                      checked={allOnPage}
                      onChange={() => setSelected((cur) => {
                        const next = new Set(cur);
                        if (allOnPage) pageIds.forEach((id) => next.delete(id)); else pageIds.forEach((id) => next.add(id));
                        return next;
                      })}
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Tài khoản</th>
                  <th className="px-3 py-2.5 font-medium">Vai trò · hạng</th>
                  <th className="px-3 py-2.5 text-right font-medium">Số dư</th>
                  <th className="px-3 py-2.5 text-right font-medium">Đơn mua / bán</th>
                  <th className="px-3 py-2.5 font-medium">Rủi ro</th>
                  <th className="px-3 py-2.5 font-medium">Hoạt động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((row) => {
                  const isSelf = me?.id === row.id;
                  const lock = lockLine(row);
                  const flags = row.risk_flags ?? [];
                  return (
                    <tr key={row.id} className={cn("relative transition-colors hover:bg-raised/40 focus-within:bg-raised/40", !row.is_active && "bg-bad-soft/20", selected.has(row.id) && "bg-iris-soft/40")}>
                      <td className="relative z-[1] px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Chọn ${row.email}`}
                          className="accent-[var(--color-iris)]"
                          disabled={isSelf}
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <AccountAvatar email={row.email} locked={!row.is_active} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              {/* The link's ::after covers the row, so the whole row opens the account. */}
                              <Link
                                href={`/admin/accounts/${row.id}`}
                                className={cn(
                                  "min-w-0 truncate font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-iris/50",
                                  row.is_active ? "text-fg" : "text-muted line-through decoration-bad/50",
                                )}
                              >
                                {row.email}
                              </Link>
                              {isSelf && <span className="shrink-0 text-[11px] text-faint">(bạn)</span>}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
                              {row.shop_name && <span className="truncate text-muted">{row.shop_name}</span>}
                              <span className="font-mono">#{row.id}</span>
                              <AccountFlags row={row} />
                            </div>
                            {lock && <div className="mt-0.5 max-w-[320px] truncate text-[11.5px] text-bad" title={lock}>{lock}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(row.roles.length === 1 ? row.roles : row.roles.filter((r) => r !== "buyer")).map((r) => (
                            <Tag key={r} tone={r === "admin" ? "iris" : r === "seller" ? "good" : "neutral"}>{ROLE_LABEL[r] ?? r}</Tag>
                          ))}
                          {row.roles.includes("seller") && <Tag tone={row.seller_tier === "enterprise" || row.seller_tier === "trusted" ? "good" : "neutral"}>{TIER_VI[row.seller_tier] ?? row.seller_tier}</Tag>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-fg">{row.available_balance === undefined ? "—" : vnd(row.available_balance)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-muted">{row.orders_bought ?? 0} / {row.orders_sold ?? 0}</td>
                      <td className="px-3 py-3">
                        {flags.length === 0 ? <span className="text-faint">—</span> : (
                          <div className="flex flex-wrap gap-1">{flags.map((f) => <Tag key={f} tone="bad">{RISK_FLAG_LABEL[f] ?? f}</Tag>)}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted">{relativeTime(row.last_login_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {query.data && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            Mỗi trang
            <Select value={String(filters.perPage)} onChange={(e) => setFilters({ perPage: Number(e.target.value) })} className="h-8 w-auto text-[12.5px]">
              {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
          {query.data.total > filters.perPage && (
            <Pagination page={filters.page} perPage={filters.perPage} total={query.data.total} onPageChange={(page) => setFilters({ page })} />
          )}
        </div>
      )}

      <Dialog open={lockOpen} onOpenChange={(o) => { if (!o) { setLockOpen(false); setBulkResult(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-fg">{bulkResult ? "Một số tài khoản bị bỏ qua" : `Khóa ${selected.size} tài khoản`}</DialogTitle>
            <DialogDescription className="text-[12.5px] text-muted">
              {bulkResult ? "Các tài khoản dưới đây không được cập nhật." : "Khóa đăng xuất mọi thiết bị ngay và chặn đăng nhập lại. Lý do được ghi vào nhật ký và hiện trên hồ sơ."}
            </DialogDescription>
          </DialogHeader>
          {bulkResult ? (
            <ul className="max-h-60 space-y-1 overflow-y-auto text-[12.5px]">
              {bulkResult.skipped.map((s) => (
                <li key={s.id} className="flex gap-2"><Link href={`/admin/accounts/${s.id}`} className="font-mono text-iris-hi hover:underline">#{s.id}</Link><span className="text-muted">{s.reason}</span></li>
              ))}
            </ul>
          ) : (
            <Textarea value={lockReason} onChange={(e) => setLockReason(e.target.value)} maxLength={500} placeholder="Lý do khóa — vd: clone farm, lừa đảo…" className="min-h-[72px] text-[12.5px]" aria-label="Lý do khóa" />
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {bulkResult ? (
              <Button variant="secondary" onClick={() => { setLockOpen(false); setBulkResult(null); }}>Đóng</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setLockOpen(false)} disabled={bulk.isPending}>Huỷ</Button>
                <Button variant="danger" loading={bulk.isPending} onClick={() => bulk.mutate({ active: false, reason: lockReason.trim() || undefined })}>Khóa</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
