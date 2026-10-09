"use client";

/** /admin/promotions — every campaign on one screen: what it gives, who can
 *  use it, how much of it is used, what needs attention. Server-paged; the
 *  filters live in the URL (History API) so a view can be shared/reloaded. */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { formatLedgerMoney } from "@/lib/money";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { AdminPromotion } from "@/lib/types";
import { Banner, Button, Card, Pagination, Select, Skeleton, Tag } from "@/components/ui";
import { Layers, Pause, Plus, RefreshCw, Search, Tag as TagIcon, X } from "@/components/Icons";
import {
  DEFAULT_LIST, LIST_CHIPS, PER_PAGE, PROMOTIONS_KEY, SORTS, STATE_META, attentionLabel, compactVnd, conditionChips,
  describeOffer, describeWindow, parsePromoListUrl, promoListQuery, promoListSearch, usageRatio, windowHint,
  type PromoListFilters,
} from "../model";
import { RowMenu, usePromotionActions } from "./shared";
import { BulkCodesDialog } from "./BulkCodesDialog";

const money = (n: number) => formatLedgerMoney(n, "vi");
const num = (n: number) => n.toLocaleString("vi-VN");
const GRID = "lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_170px_150px]";

function usePromoListUrl() {
  const searchParams = useSearchParams();
  const filters = React.useMemo(() => parsePromoListUrl(new URLSearchParams(searchParams.toString())), [searchParams]);
  const setFilters = React.useCallback((patch: Partial<PromoListFilters>) => {
    const current = new URLSearchParams(window.location.search);
    const merged = { ...parsePromoListUrl(current), ...patch };
    if (!("page" in patch)) merged.page = 1;
    const qs = promoListSearch(merged, current);
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);
  return { filters, setFilters };
}

function Bar({ ratio }: { ratio: number | null }) {
  if (ratio == null) return null;
  return (
    <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-raised" aria-hidden>
      <span className={cn("block h-full rounded-full", ratio >= 1 ? "bg-bad" : ratio >= 0.85 ? "bg-warn" : "bg-iris")} style={{ width: `${Math.max(2, ratio * 100)}%` }} />
    </span>
  );
}

function Usage({ p }: { p: AdminPromotion }) {
  if (p.uses === 0) {
    return <p className="text-[12px] text-faint">Chưa dùng{p.usage_limit != null ? ` · giới hạn ${num(p.usage_limit)} lượt` : ""}</p>;
  }
  return (
    <div className="min-w-0 space-y-1.5 text-[12px]">
      <div>
        <span className="text-faint">Lượt </span>
        <span className="font-mono tabular text-fg">{num(p.uses)}</span>
        <span className="text-faint"> / {p.usage_limit != null ? num(p.usage_limit) : "∞"}</span>
        <Bar ratio={usageRatio(p.uses, p.usage_limit)} />
      </div>
      <div>
        <span className="text-faint">{p.budget_amount != null ? "Ngân sách " : "Đã giảm "}</span>
        <span className="font-mono tabular text-fg">{compactVnd(p.discount_given)}</span>
        {p.budget_amount != null && <span className="text-faint"> / {compactVnd(p.budget_amount)}</span>}
        <Bar ratio={usageRatio(p.discount_given, p.budget_amount)} />
      </div>
      {p.code_count > 0 && <p className="text-faint">Mã 1 lần: {num(p.codes_redeemed)} / {num(p.code_count)}</p>}
    </div>
  );
}

export function AdminPromotionsConsole() {
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const { filters, setFilters } = usePromoListUrl();
  const [search, setSearch] = React.useState(filters.q);
  const debounced = useDebounce(search, 300);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (debounced.trim() !== filters.q.trim()) setFilters({ q: debounced }); }, [debounced, filters.q, setFilters]);

  // "/" jumps to search from anywhere on the page that is not a text field.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const query = promoListQuery(filters);
  const list = useQuery({
    queryKey: [...PROMOTIONS_KEY, "list", query],
    queryFn: () => api.adminPromotions(query),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({ queryKey: ["admin", "categories"], queryFn: api.adminCategories });
  const categoryName = React.useMemo(() => {
    const byId = new Map((categories.data?.items ?? []).map((c) => [c.id, c.name]));
    return (id: number) => byId.get(id);
  }, [categories.data]);

  const { act, dialogs, pending } = usePromotionActions({ onDuplicated: (p) => router.push(`/admin/promotions/${p.id}`) });

  const data = list.data;
  const rows = data?.items ?? [];
  const counts = data?.counts;
  const filtered = filters.q.trim() !== "" || filters.chip !== "all";
  const start = data && data.total ? (data.page - 1) * data.per_page + 1 : 0;
  const end = data ? Math.min(data.page * data.per_page, data.total) : 0;

  return (
    <div className="animate-rise space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-[18px] font-semibold tracking-tight text-fg">Khuyến mãi</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            Mã giảm giá áp dụng khi thanh toán. Sàn chịu phần giảm: người bán vẫn nhận đủ giá gốc (trừ phí sàn).
            Giờ hiển thị theo giờ Việt Nam (GMT+7).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setBulkOpen(true)}><Layers size={14} /> Tạo hàng loạt mã dùng 1 lần</Button>
          <Link href="/admin/promotions/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-iris px-4 text-[13px] font-medium text-white transition-colors hover:bg-iris-hi">
            <Plus size={14} /> Tạo chiến dịch
          </Link>
        </div>
      </div>

      <Card className="grid grid-cols-2 divide-line p-0 sm:grid-cols-4 sm:divide-x">
        {[
          {
            label: "Đang chạy", value: counts ? num(counts.running) : null,
            sub: counts && counts.attention > 0 ? `${num(counts.attention)} cần chú ý` : null,
          },
          { label: "Lượt dùng 30 ngày", value: data ? num(data.totals_30d.uses) : null },
          { label: "Đã giảm 30 ngày", value: data ? money(data.totals_30d.discount) : null },
          { label: "Doanh số từ đơn có mã", value: data ? money(data.totals_30d.gmv) : null, sub: "30 ngày" },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3">
            <p className="text-[11.5px] text-muted">{s.label}</p>
            {s.value == null
              ? <Skeleton className="mt-1.5 h-5 w-16" />
              : <p className="mt-0.5 font-mono text-[17px] font-semibold tabular text-fg">{s.value}</p>}
            {s.sub && <p className={cn("text-[11.5px]", s.label === "Đang chạy" ? "text-warn" : "text-faint")}>{s.sub}</p>}
          </div>
        ))}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm mã hoặc tên chiến dịch"
            aria-label="Tìm chiến dịch"
            className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-8 text-[13px] text-fg placeholder:text-placeholder focus:border-iris"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Xoá tìm kiếm" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg">
              <X size={13} />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line px-1 font-mono text-[10.5px] text-faint">/</kbd>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc theo trạng thái">
          {LIST_CHIPS.map((c) => {
            const n = counts?.[c.key];
            const on = filters.chip === c.key;
            return (
              <Button key={c.key} size="sm" variant={on ? "primary" : "secondary"} aria-pressed={on} onClick={() => setFilters({ chip: c.key })}>
                {c.label}
                {n != null && <span className={cn("font-mono tabular text-[11.5px]", on ? "opacity-80" : c.key === "attention" && n > 0 ? "text-warn" : "text-faint")}>{num(n)}</span>}
              </Button>
            );
          })}
        </div>
        <Select value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as PromoListFilters["sort"] })} aria-label="Sắp xếp" className="h-9 w-auto sm:ml-auto">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
      </div>

      {list.isError ? (
        <Banner
          tone="bad"
          title="Không tải được danh sách khuyến mãi"
          action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw size={13} /> Thử lại</Button>}
        >
          {apiErrorMessage(list.error)}
        </Banner>
      ) : list.isPending ? (
        <Card className="space-y-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</Card>
      ) : rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <TagIcon size={22} className="text-faint" />
          <p className="text-[13.5px] font-medium text-fg">{filtered ? "Không có chiến dịch khớp bộ lọc" : "Chưa có chiến dịch nào"}</p>
          <p className="max-w-sm text-[12.5px] text-muted">
            {filtered ? "Đổi từ khoá hoặc chọn bộ lọc khác." : "Tạo mã đầu tiên, ví dụ giảm 10% cho đơn đầu tiên của khách mới."}
          </p>
          {filtered
            ? <Button className="mt-2" variant="secondary" onClick={() => { setSearch(""); setFilters({ ...DEFAULT_LIST }); }}>Xoá bộ lọc</Button>
            : <Link href="/admin/promotions/new" className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-iris px-4 text-[13px] font-medium text-white hover:bg-iris-hi"><Plus size={14} /> Tạo chiến dịch</Link>}
        </Card>
      ) : (
        <Card className={cn("overflow-hidden p-0 transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <div className={cn("hidden gap-4 border-b border-line bg-raised px-4 py-2 text-[11.5px] font-medium text-muted lg:grid", GRID)}>
            <span>Mã · tên</span><span>Ưu đãi · điều kiện</span><span>Thời gian</span><span>Sử dụng</span><span className="text-right">Trạng thái</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((p) => {
              const meta = STATE_META[p.state];
              const warn = attentionLabel(p.attention_reason, p.budget_eta_days);
              const hint = windowHint(p);
              const busy = pending?.p.id === p.id;
              return (
                <li key={p.id} className={cn("grid gap-3 px-4 py-3 lg:items-center lg:gap-4", GRID)}>
                  <Link href={`/admin/promotions/${p.id}`} className="group min-w-0">
                    <span className="block font-mono text-[13.5px] font-semibold text-fg group-hover:text-iris-hi">{p.code}</span>
                    <span className="block truncate text-[12px] text-muted">{p.name}</span>
                    {p.affiliate_account_id != null && (
                      <span className="mt-0.5 block truncate text-[11.5px] text-iris-hi" title={p.affiliate_email ?? undefined}>KOL · {p.affiliate_email ?? `#${p.affiliate_account_id}`}</span>
                    )}
                  </Link>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-fg">{describeOffer(p, money)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {conditionChips(p, money, categoryName).map((c) => <Tag key={c}>{c}</Tag>)}
                    </div>
                  </div>
                  <div className="text-[12px]">
                    <p className="text-muted">{describeWindow(p)}</p>
                    {hint && <p className={cn(hint.includes("vẫn bật") ? "text-bad" : "text-faint")}>{hint}</p>}
                  </div>
                  <Usage p={p} />
                  <div className="flex items-center justify-between gap-2 lg:flex-col lg:items-end">
                    <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                      <Tag tone={meta.tone}>{meta.label}</Tag>
                      {warn && <Tag tone="warn">{warn}</Tag>}
                    </div>
                    <div className="flex items-center gap-1">
                      {p.archived_at == null && (p.state === "running" || p.state === "scheduled" || p.state === "paused") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy}
                          onClick={() => act(p.is_active ? "pause" : "resume", p)}
                          aria-label={p.is_active ? `Tạm dừng ${p.code}` : `Bật lại ${p.code}`}
                        >
                          {p.is_active ? <><Pause size={13} /> Tạm dừng</> : <><RefreshCw size={13} /> Bật lại</>}
                        </Button>
                      )}
                      <RowMenu promotion={p} onAction={(a) => (a === "edit" ? router.push(`/admin/promotions/${p.id}`) : act(a, p))} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12px] text-muted">
            <span>
              {start}–{end} / {num(data!.total)} chiến dịch
              {filters.chip !== "archived" && <> · Ẩn chiến dịch đã lưu trữ</>}
            </span>
            <Pagination page={filters.page} totalPages={Math.max(1, Math.ceil(data!.total / PER_PAGE))} onChange={(page) => setFilters({ page })} />
          </div>
        </Card>
      )}

      {dialogs}
      <BulkCodesDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  );
}
