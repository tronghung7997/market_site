"use client";

/** Admin › Tài khoản: the directory. Every filter, the column sort and the
 *  page live in the URL (History API, like the buyer orders console); rows
 *  link to /admin/accounts/{id}. */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AccountBulkStatusResult } from "@/lib/types";
import { Button, buttonClass, Select, Spinner, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination } from "@/components/admin";
import { useToast } from "@/components/toast";
import { ChevronDown, Download, ListFilter, Search, Sliders, X } from "@/components/Icons";
import { ROLE_LABEL, TIER_VI } from "./shared";
import { AccountsTable, OPTIONAL_COLUMNS, type ColumnKey, type RowActions } from "./AccountsTable";
import {
  accountsQuery, accountsUrlSearch, activeView, DEFAULT_FILTERS, parseAccountsUrl, PER_PAGE_OPTIONS,
  SAVED_VIEWS, sortState, TIERS, toggleSort, type AccountsFilters,
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
const SORT_LABEL: Record<string, string> = {
  created: "Ngày tạo", email: "Email", last_login: "Đăng nhập", balance: "Số dư", deposited: "Đã nạp",
  spent: "Tiền mua", orders_bought: "Số đơn mua", revenue: "Doanh thu bán", orders_sold: "Số đơn bán",
  disputes: "Khiếu nại mở", risk: "Rủi ro",
};
const HIDDEN_COLUMNS_KEY = "admin-accounts:hidden-columns";

function useHiddenColumns() {
  const [hidden, setHidden] = React.useState<Set<ColumnKey>>(new Set());
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_COLUMNS_KEY);
      const keys = OPTIONAL_COLUMNS.map((c) => c.key as string);
      if (raw) setHidden(new Set((JSON.parse(raw) as string[]).filter((k) => keys.includes(k)) as ColumnKey[]));
    } catch { /* per-viewer convenience only */ }
  }, []);
  const toggle = React.useCallback((key: ColumnKey) => setHidden((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { window.localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  }), []);
  return { hidden, toggle };
}

function usePopover() {
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
  return { open, setOpen, ref };
}

const CONTROL = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[12.5px] text-fg hover:border-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40";

function ColumnsPicker({ hidden, onToggle }: { hidden: Set<ColumnKey>; onToggle: (k: ColumnKey) => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative hidden md:block">
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={CONTROL}>
        <Sliders size={13} className="text-faint" />Cột{hidden.size > 0 && <span className="font-mono text-[11px] text-faint">−{hidden.size}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-48 rounded-lg border border-line bg-card p-1 shadow-card" role="group" aria-label="Cột hiển thị">
          {OPTIONAL_COLUMNS.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-fg hover:bg-raised/60">
              <input type="checkbox" className="accent-[var(--color-iris)]" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full border border-iris/30 bg-iris-soft/60 pl-2.5 pr-1 text-[12px] text-fg">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Bỏ lọc ${label}`} className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-iris-soft hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40">
        <X size={11} />
      </button>
    </span>
  );
}

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
  const { open, setOpen, ref } = usePopover();
  const label = value.length === 0 ? "Mọi hạng" : value.map((t) => TIER_VI[t] ?? t).join(", ");
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(CONTROL, "h-11 max-w-[220px] md:h-9")}
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
  const { hidden, toggle: toggleColumn } = useHiddenColumns();
  const [filtersOpen, setFiltersOpen] = React.useState(false);

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
  const filterKey = JSON.stringify({ ...params, sort: undefined, dir: undefined });
  React.useEffect(() => { setSelected(new Set()); }, [filterKey]);
  const pageIds = items.filter((r) => r.id !== me?.id).map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: number) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelected((cur) => {
    const next = new Set(cur);
    if (allOnPage) pageIds.forEach((id) => next.delete(id)); else pageIds.forEach((id) => next.add(id));
    return next;
  });

  // Lock dialog targets: the selection (bulk) or one row (⋯ menu).
  const [lockTargets, setLockTargets] = React.useState<{ ids: number[]; label: string } | null>(null);
  const [lockReason, setLockReason] = React.useState("");
  const [bulkResult, setBulkResult] = React.useState<AccountBulkStatusResult | null>(null);
  const bulk = useMutation({
    mutationFn: ({ ids, active, reason }: { ids: number[]; active: boolean; reason?: string }) => api.adminBulkAccountStatus(ids, active, reason),
    onSuccess: (res, { active }) => {
      toast.success(`${active ? "Đã mở khóa" : "Đã khóa"} ${res.updated.length} tài khoản${res.skipped.length ? `, bỏ qua ${res.skipped.length}` : ""}`);
      setBulkResult(res.skipped.length ? res : null);
      if (!res.skipped.length) setLockTargets(null);
      else setLockTargets((cur) => cur ?? { ids: [], label: "" });
      setLockReason("");
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["admin", "accounts"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Cập nhật thất bại")),
  });

  const actions: RowActions = {
    onCopyEmail: (row) => {
      if (!navigator.clipboard) { toast.error("Trình duyệt chặn sao chép."); return; }
      navigator.clipboard.writeText(row.email).then(() => toast.success(`Đã sao chép ${row.email}`), () => toast.error("Trình duyệt chặn sao chép."));
    },
    onLock: (row) => { setBulkResult(null); setLockTargets({ ids: [row.id], label: row.email }); },
    onUnlock: (row) => bulk.mutate({ ids: [row.id], active: true }),
  };

  const exportParams = { ...params, page: undefined, per_page: undefined };
  const exportHref = selected.size > 0
    ? api.adminAccountsExportUrl({ ...exportParams, ids: [...selected] })
    : api.adminAccountsExportUrl(exportParams);

  const sort = sortState(filters);
  const sortIsDefault = sort.key === "created" && sort.dir === "desc";
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.q) chips.push({ key: "q", label: `“${filters.q}”`, clear: () => { setSearchDraft(""); setFilters({ q: "" }); } });
  if (filters.role) chips.push({ key: "role", label: `Vai trò: ${ROLE_LABEL[filters.role] ?? filters.role}`, clear: () => setFilters({ role: "" }) });
  for (const t of filters.tier) chips.push({ key: `tier-${t}`, label: `Hạng: ${TIER_VI[t] ?? t}`, clear: () => setFilters({ tier: filters.tier.filter((x) => x !== t) }) });
  if (filters.status) chips.push({ key: "status", label: STATUS_FILTERS.find((s) => s.key === filters.status)?.label ?? filters.status, clear: () => setFilters({ status: "" }) });
  if (!sortIsDefault) chips.push({ key: "sort", label: `Sắp xếp: ${SORT_LABEL[sort.key] ?? sort.key} ${sort.dir === "asc" ? "↑" : "↓"}`, clear: () => setFilters({ sort: DEFAULT_FILTERS.sort, dir: "" }) });
  const filterCount = (filters.role ? 1 : 0) + filters.tier.length + (filters.status ? 1 : 0);
  const reset = () => { setSearchDraft(""); setFilters({ ...DEFAULT_FILTERS, perPage: filters.perPage }); };
  const onSort = (key: string) => setFilters(toggleSort(filters, key));

  return (
    <div className="space-y-3">
      <div className="-mt-2 flex items-center gap-3">
        <div className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 py-0.5" role="tablist" aria-label="Chế độ xem">
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
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
                  on ? "bg-iris-soft text-iris-hi" : "text-muted hover:bg-raised/60 hover:text-fg",
                  v.key === "risky" && !on && (count ?? 0) > 0 && "text-bad",
                )}
              >
                {v.label}
                {count !== undefined && <span className={cn("rounded px-1 font-mono text-[11px] tabular-nums", on ? "bg-card/70" : "bg-raised/70")}>{count.toLocaleString("vi-VN")}</span>}
              </button>
            );
          })}
        </div>
        <a href={exportHref} download className={cn(buttonClass({ variant: "secondary", size: "sm" }), "hidden shrink-0 sm:inline-flex")}>
          <Download size={14} />{selected.size > 0 ? `Xuất CSV (${selected.size})` : "Xuất CSV"}
        </a>
      </div>

      <div className="rounded-card border border-line bg-card p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-[240px] md:max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={searchRef}
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Email, shop, SĐT, ORD-…, IP, #id"
              aria-label="Tìm tài khoản"
              aria-keyshortcuts="/"
              className="h-11 w-full rounded-lg border border-line bg-surface pl-9 pr-9 text-[13px] text-fg placeholder:text-faint focus:border-iris focus:outline-none focus:ring-2 focus:ring-iris/30 md:h-9"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[10.5px] text-faint md:block">/</kbd>
          </div>
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="accounts-filter-controls"
            onClick={() => setFiltersOpen((o) => !o)}
            className={cn(CONTROL, "h-11 md:hidden")}
          >
            <ListFilter size={14} />Bộ lọc{filterCount > 0 && <span className="rounded bg-iris-soft px-1 font-mono text-[11px] text-iris-hi">{filterCount}</span>}
          </button>
          <div id="accounts-filter-controls" className={cn("w-full flex-wrap items-center gap-2 md:flex md:w-auto", filtersOpen ? "flex" : "hidden")}>
            <Select value={filters.role} onChange={(e) => setFilters({ role: e.target.value })} aria-label="Vai trò" className="h-11 w-full text-[12.5px] sm:w-auto md:h-9">
              {ROLE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select>
            <TierPicker value={filters.tier} onChange={(tier) => setFilters({ tier })} />
            <Select value={filters.status} onChange={(e) => setFilters({ status: e.target.value })} aria-label="Trạng thái" className="h-11 w-full text-[12.5px] sm:w-auto md:h-9">
              {STATUS_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select>
            <Select
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => { const [key, dir] = e.target.value.split(":"); setFilters(key === "created" ? { sort: dir === "asc" ? "oldest" : "newest", dir: "" } : { sort: key, dir: dir as "asc" | "desc" }); }}
              aria-label="Sắp xếp"
              className="h-11 w-full text-[12.5px] sm:w-auto md:hidden"
            >
              {Object.entries(SORT_LABEL).flatMap(([key, label]) => [
                <option key={`${key}:desc`} value={`${key}:desc`}>{label} ↓</option>,
                <option key={`${key}:asc`} value={`${key}:asc`}>{label} ↑</option>,
              ])}
            </Select>
            <ColumnsPicker hidden={hidden} onToggle={toggleColumn} />
          </div>
          <span className="ml-auto whitespace-nowrap text-[12px] text-muted" aria-live="polite">
            {query.data ? <><span className="font-mono font-medium tabular-nums text-fg">{query.data.total.toLocaleString("vi-VN")}</span> tài khoản</> : ""}
            {query.isFetching && query.data ? <span className="text-faint"> · đang tải…</span> : ""}
          </span>
        </div>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
            {chips.map((c) => <Chip key={c.key} label={c.label} onRemove={c.clear} />)}
            <button type="button" onClick={reset} className="ml-1 rounded px-1.5 text-[12px] font-medium text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40">Xóa tất cả</button>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-card border border-iris/30 bg-iris-soft/60 px-3 py-2 backdrop-blur">
          <span className="text-[12.5px] font-medium text-fg">Đã chọn {selected.size}</span>
          <Button size="sm" variant="danger" onClick={() => { setBulkResult(null); setLockTargets({ ids: [...selected], label: `${selected.size} tài khoản` }); }}>Khóa…</Button>
          <Button size="sm" variant="secondary" loading={bulk.isPending} onClick={() => bulk.mutate({ ids: [...selected], active: true })}>Mở khóa</Button>
          <a href={exportHref} download className={buttonClass({ variant: "secondary", size: "sm" })}><Download size={14} />Xuất CSV</a>
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
            {chips.length > 0 && <Button size="sm" variant="secondary" className="mt-3" onClick={reset}>Xóa bộ lọc</Button>}
          </div>
        ) : (
          <AccountsTable
            items={items}
            meId={me?.id}
            selected={selected}
            onToggle={toggle}
            allOnPage={allOnPage}
            onToggleAll={toggleAll}
            hidden={hidden}
            actions={actions}
            filters={filters}
            onSort={onSort}
          />
        )}
      </div>

      {query.data && query.data.total > 0 && (
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

      <Dialog open={lockTargets !== null} onOpenChange={(o) => { if (!o) { setLockTargets(null); setBulkResult(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-fg">{bulkResult ? "Một số tài khoản bị bỏ qua" : `Khóa ${lockTargets?.label ?? ""}`}</DialogTitle>
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
              <Button variant="secondary" onClick={() => { setLockTargets(null); setBulkResult(null); }}>Đóng</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setLockTargets(null)} disabled={bulk.isPending}>Huỷ</Button>
                <Button variant="danger" loading={bulk.isPending} onClick={() => lockTargets && bulk.mutate({ ids: lockTargets.ids, active: false, reason: lockReason.trim() || undefined })}>Khóa</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
