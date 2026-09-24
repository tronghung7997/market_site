"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, MoreHorizontal, Search, TriangleAlert, X } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { queryKeys } from "@/lib/query-keys";
import { productPath } from "@/lib/routes";
import { SERVICE_LABELS } from "@/lib/labels";
import { STRATEGY_INFO } from "@/lib/pricing-config";
import { Banner, Button, Card, Monogram, Pagination, Select, Tag } from "@/components/ui";
import { ConfirmModal, FacetSelect } from "@/components/admin";
import type { AdminProduct, AdminProductBulkAction, CategoryAdminRow } from "@/lib/types";
import {
  BULK_ACTION_LABELS, PAGE_SIZES, SORT_OPTIONS, STATUS_TABS, activeFilterCount, bulkResultMessage,
  listQueryToParams, parseListQuery, sortParams, statusActionsFor, statusMeta, updateQuery,
  type ProductListQuery, type SortKey,
} from "../model";

const LIST_KEY = ["admin", "products", "console"] as const;

function StatusPill({ status }: { status: string }) {
  const meta = statusMeta(status);
  return <Tag tone={meta.tone}>{meta.label}</Tag>;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Danh mục dạng cây phẳng "Cha › Con" cho ô chọn. */
function categoryOptions(rows: CategoryAdminRow[]) {
  const byParent = new Map<number | null, CategoryAdminRow[]>();
  for (const row of rows) {
    const list = byParent.get(row.parent_id) ?? [];
    list.push(row);
    byParent.set(row.parent_id, list);
  }
  const out: { id: number; label: string }[] = [];
  const walk = (parent: number | null, prefix: string) => {
    for (const row of (byParent.get(parent) ?? []).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) {
      const label = prefix ? `${prefix} › ${row.name}` : row.name;
      out.push({ id: row.id, label: row.is_active ? label : `${label} (ẩn)` });
      walk(row.id, label);
    }
  };
  walk(null, "");
  return out;
}

/* ─── Menu thao tác một dòng ───
   Định vị `fixed` theo nút bấm: bảng cuộn ngang (overflow) sẽ cắt mất menu
   absolute ở các dòng cuối. Gần đáy màn hình thì lật lên trên. */
function RowMenu({ product, onAction }: {
  product: AdminProduct;
  onAction: (action: Exclude<AdminProductBulkAction, "set_category">, product: AdminProduct) => void;
}) {
  const [pos, setPos] = React.useState<{ right: number; top?: number; bottom?: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const open = pos != null;
  const toggle = () => {
    if (open) { setPos(null); return; }
    const rect = buttonRef.current!.getBoundingClientRect();
    const right = window.innerWidth - rect.right;
    setPos(rect.bottom + 240 > window.innerHeight
      ? { right, bottom: window.innerHeight - rect.top + 4 }
      : { right, top: rect.bottom + 4 });
  };
  React.useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && (menuRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node))) return;
      setPos(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Thao tác cho ${product.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg"
      >
        <MoreHorizontal size={16} />
      </button>
      {/* Portal: vùng nội dung admin có transform (animate-rise) nên `fixed`
          bên trong sẽ bám theo nó chứ không theo màn hình. */}
      {pos && createPortal(
        <div ref={menuRef} role="menu" style={pos} onClick={(e) => e.stopPropagation()} className="fixed z-50 w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-card-lg">
          <Link href={`/admin/products/${product.id}`} role="menuitem" className="block px-3 py-2 text-[13px] hover:bg-raised">
            Mở trang quản lý
          </Link>
          <Link href={productPath(product)} target="_blank" role="menuitem" className="flex items-center justify-between px-3 py-2 text-[13px] hover:bg-raised">
            Xem trên chợ <ExternalLink size={12} className="text-faint" />
          </Link>
          <div className="my-1 h-px bg-line" />
          {statusActionsFor(product.status).map((a) => (
            <button
              key={a.action}
              type="button"
              role="menuitem"
              onClick={() => { setPos(null); onAction(a.action, product); }}
              className={cn("block w-full px-3 py-2 text-left text-[13px] hover:bg-raised", a.danger && "text-bad")}
            >
              {a.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function AdminProductsConsole() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const apiErrorMessage = useApiErrorMessage();

  const query = React.useMemo(() => parseListQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const setQuery = React.useCallback((patch: Partial<ProductListQuery>) => {
    const qs = listQueryToParams(updateQuery(query, patch)).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, query, router]);

  // Ô tìm kiếm gõ tự do, đẩy lên URL sau 300ms.
  const [searchText, setSearchText] = React.useState(query.q);
  const debouncedSearch = useDebounce(searchText, 300);
  React.useEffect(() => {
    if (debouncedSearch.trim() !== query.q) setQuery({ q: debouncedSearch.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  React.useEffect(() => { setSearchText(query.q); }, [query.q]);

  const { sortBy, sortDir } = sortParams(query.sort);
  const listQ = useQuery({
    queryKey: [...LIST_KEY, query],
    queryFn: () => api.adminProducts({
      search: query.q, status: query.status, seller: query.seller ?? undefined,
      provider: query.provider ?? undefined, serviceType: query.service ?? undefined,
      categoryId: query.categoryId ?? undefined, sortBy, sortDir, page: query.page, perPage: query.size,
    }),
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
  const categoriesQ = useQuery({ queryKey: queryKeys.adminCategories(), queryFn: api.adminCategories, staleTime: 60_000 });
  const cats = React.useMemo(() => categoryOptions(categoriesQ.data?.items ?? []), [categoriesQ.data]);

  const data = listQ.data;
  const items = React.useMemo(() => data?.items ?? [], [data]);
  const counts = data?.counts;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  const facet = (list: { key: string; count: number }[] | undefined, selected: string | null, label?: (k: string) => string) => {
    const options = (list ?? []).map((f) => ({ key: f.key, label: label ? label(f.key) : f.key, count: f.count }));
    if (selected && !options.some((o) => o.key === selected)) options.push({ key: selected, label: label ? label(selected) : selected, count: 0 });
    return options;
  };

  // ── Chọn nhiều ──
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  React.useEffect(() => { setSelected(new Set()); }, [query]);
  const pageIds = items.map((p) => p.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(pageIds));
  const toggleOne = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── Chạy thao tác ──
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: "good" | "warn" | "bad"; text: string } | null>(null);
  const [confirm, setConfirm] = React.useState<{ action: AdminProductBulkAction; ids: number[]; title: string } | null>(null);
  const [reason, setReason] = React.useState("");
  const [targetCategory, setTargetCategory] = React.useState<number | "">("");

  const run = async (action: AdminProductBulkAction, ids: number[], extra: { reason?: string; category_id?: number } = {}) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.adminBulkProducts({ ids, action, ...extra });
      setNotice(bulkResultMessage(result, action));
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "action-items"] });
    } catch (e) {
      setNotice({ tone: "bad", text: apiErrorMessage(e, "Không thực hiện được thao tác") });
    } finally {
      setBusy(false);
      setConfirm(null);
      setReason("");
      setTargetCategory("");
    }
  };

  // Khoá và đổi danh mục cần xác nhận (kèm lý do / danh mục đích); còn lại chạy ngay.
  const request = (action: AdminProductBulkAction, ids: number[], title: string) => {
    if (action === "suspend" || action === "set_category") setConfirm({ action, ids, title });
    else void run(action, ids);
  };

  const hasFilters = activeFilterCount(query) > 0;
  const clearFilters = () => { setSearchText(""); setQuery({ q: "", seller: null, provider: null, service: null, categoryId: null }); };

  return (
    <div className="space-y-4">
      {/* ── Số liệu nhanh: bấm để lọc ── */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line shadow-card sm:grid-cols-4">
        {[
          { label: "Sản phẩm", value: counts?.all, sub: "trong bộ lọc hiện tại", tab: "all" as const },
          { label: "Đang bán", value: counts?.active, sub: "hiện trên chợ", tab: "active" as const, tone: "text-good" },
          { label: "Cần thiết lập", value: counts?.needs_setup, sub: "chưa giao được hàng", tab: "needs_setup" as const, tone: (counts?.needs_setup ?? 0) > 0 ? "text-bad" : "" },
          { label: "Doanh thu", value: counts ? vnd(counts.total_revenue) : undefined, sub: "đơn đã giao / hoàn tất", tab: null },
        ].map((cell) => {
          const body = (
            <>
              <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{cell.label}</p>
              <p className={cn("mt-1 truncate font-mono text-[19px] font-semibold tabular-nums", cell.tone)}>
                {cell.value ?? <span className="inline-block h-5 w-12 animate-pulse rounded bg-raised" />}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-faint">{cell.sub}</p>
            </>
          );
          return cell.tab ? (
            <button key={cell.label} type="button" onClick={() => setQuery({ status: cell.tab! })}
              className={cn("bg-surface px-4 py-3 text-left transition-colors hover:bg-raised/60", query.status === cell.tab && cell.tab !== "all" && "bg-iris-soft/60")}>
              {body}
            </button>
          ) : (
            <div key={cell.label} className="bg-surface px-4 py-3">{body}</div>
          );
        })}
      </div>

      <Card className="overflow-hidden p-0">
        {/* ── Tab trạng thái ── */}
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3" role="tablist" aria-label="Trạng thái">
          {STATUS_TABS.map((tab) => {
            const on = query.status === tab.key;
            const n = counts ? (counts as unknown as Record<string, number>)[tab.key] : undefined;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setQuery({ status: tab.key })}
                className={cn("relative inline-flex shrink-0 items-center gap-1.5 px-2.5 py-3 text-[13px] font-medium", on ? "text-fg" : "text-muted hover:text-fg")}
              >
                {tab.label}
                {n != null && (
                  <span className={cn("tabular-nums text-[11.5px]", tab.key === "needs_setup" && n > 0 ? "text-bad" : "text-faint")}>{n}</span>
                )}
                {on && <span className="absolute inset-x-1.5 bottom-0 h-[2px] rounded-full bg-iris" />}
              </button>
            );
          })}
        </div>

        {/* ── Thanh lọc ── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <span className="sr-only">Tìm sản phẩm</span>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Tên, mã số, email người bán, nguồn hàng…"
              className="h-9 w-full rounded-lg border border-line-2 bg-surface pl-8 pr-8 text-[13px] outline-none focus:border-iris"
            />
            {searchText && (
              <button type="button" aria-label="Xoá tìm kiếm" onClick={() => setSearchText("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-fg">
                <X size={14} />
              </button>
            )}
          </label>
          <select
            aria-label="Danh mục"
            value={query.categoryId ?? ""}
            onChange={(e) => setQuery({ categoryId: e.target.value ? Number(e.target.value) : null })}
            className={cn("h-9 max-w-[220px] rounded-lg border bg-surface px-2.5 text-[13px]", query.categoryId ? "border-iris text-iris-hi" : "border-line-2 text-muted")}
          >
            <option value="">Mọi danh mục</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <FacetSelect label="Người bán" options={facet(data?.sellers, query.seller)} value={query.seller} onChange={(v) => setQuery({ seller: v })} />
          <FacetSelect label="Nguồn hàng" options={facet(data?.providers, query.provider)} value={query.provider} onChange={(v) => setQuery({ provider: v })} />
          <FacetSelect label="Loại dịch vụ" options={facet(data?.services, query.service, (k) => SERVICE_LABELS[k] ?? k)} value={query.service} onChange={(v) => setQuery({ service: v })} />
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-muted hover:text-fg">
              <X size={13} /> Xoá lọc
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <select aria-label="Sắp xếp" value={query.sort} onChange={(e) => setQuery({ sort: e.target.value as SortKey })}
              className="h-9 rounded-lg border border-line-2 bg-surface px-2.5 text-[13px] text-muted">
              {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {notice && (
          <div className="border-b border-line px-3 py-2.5">
            <Banner tone={notice.tone} action={<button type="button" aria-label="Đóng" onClick={() => setNotice(null)}><X size={14} /></button>}>
              {notice.text}
            </Banner>
          </div>
        )}

        {/* ── Bảng ── */}
        {listQ.isError ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[13px] text-bad">Không tải được danh sách sản phẩm.</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => listQ.refetch()}>Thử lại</Button>
          </div>
        ) : (
          <div className={cn("relative overflow-x-auto transition-opacity", listQ.isFetching && !listQ.isLoading && "opacity-60")}>
            <table className="w-full min-w-[1080px] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-raised/40 text-left text-[12px] text-muted">
                  <th className="w-10 px-3 py-2">
                    <input type="checkbox" aria-label="Chọn cả trang" checked={allOnPage} onChange={toggleAll} className="h-4 w-4 accent-[var(--color-iris)]" />
                  </th>
                  <th className="px-2 py-2 font-medium">Sản phẩm</th>
                  <th className="px-3 py-2 font-medium">Người bán</th>
                  <th className="px-3 py-2 font-medium">Nguồn · giá</th>
                  <th className="px-3 py-2 text-right font-medium">Giá từ</th>
                  <th className="px-3 py-2 text-right font-medium">Tồn kho</th>
                  <th className="px-3 py-2 text-right font-medium">Đơn</th>
                  <th className="px-3 py-2 text-right font-medium">Doanh thu</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                  <th className="px-3 py-2 font-medium">Cập nhật</th>
                  <th className="w-10 px-2 py-2"><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-line/70">
                      <td colSpan={11} className="px-3 py-3"><div className="h-5 animate-pulse rounded bg-raised" style={{ width: `${[70, 55, 80, 62][i % 4]}%` }} /></td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center">
                      <p className="text-[14px] font-medium text-fg">Không có sản phẩm nào khớp.</p>
                      {hasFilters || query.status !== "all" ? (
                        <button type="button" onClick={() => { setSearchText(""); setQuery({ status: "all", q: "", seller: null, provider: null, service: null, categoryId: null }); }}
                          className="mt-2 text-[13px] font-medium text-iris hover:underline">
                          Bỏ hết bộ lọc
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ) : items.map((p) => {
                  const checked = selected.has(p.id);
                  const strategy = p.strategy_name ? STRATEGY_INFO[p.strategy_name]?.label ?? p.strategy_name : null;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => router.push(`${pathname}/${p.id}`)}
                      className={cn("cursor-pointer border-b border-line/70 transition-colors last:border-0 hover:bg-raised/50", checked && "bg-iris-soft/40")}
                    >
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Chọn ${p.title}`} checked={checked} onChange={() => toggleOne(p.id)} className="h-4 w-4 accent-[var(--color-iris)]" />
                      </td>
                      <td className="max-w-[320px] px-2 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Monogram text={p.title} className="h-9 w-9 shrink-0 text-[12px]" />
                          <div className="min-w-0">
                            <Link href={`/admin/products/${p.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-fg hover:text-iris" title={p.title}>
                              {p.title}
                            </Link>
                            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-faint">
                              <span className="font-mono">#{p.id}</span>
                              <span>·</span>
                              <span className="truncate">{p.category_name ?? "—"}</span>
                              <span>·</span>
                              <span className="shrink-0">{SERVICE_LABELS[p.service_type] ?? p.service_type}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[180px] px-3 py-2.5">
                        {p.seller_email ? (
                          <button type="button" title="Lọc theo người bán này"
                            onClick={(e) => { e.stopPropagation(); setQuery({ seller: p.seller_email }); }}
                            className="block max-w-full truncate text-left text-[12.5px] text-muted hover:text-iris">
                            {p.seller_email}
                          </button>
                        ) : <span className="text-faint">—</span>}
                      </td>
                      <td className="max-w-[190px] px-3 py-2.5">
                        <p className="truncate text-[12.5px]">{p.provider_name ?? "Kho người bán"}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-faint">
                          {strategy && <span className="truncate">{strategy}</span>}
                          {p.demo_mode && <Tag tone="iris">Demo</Tag>}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{p.price_from > 0 ? vnd(p.price_from) : <span className="text-faint">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                        {p.stock_count == null ? (
                          <span className="text-[12px] text-faint" title="Sản phẩm cấp hàng theo đơn — không có tồn kho">Theo đơn</span>
                        ) : (
                          <span className={cn("font-mono", p.stock_count === 0 ? "text-bad" : p.stock_count < 10 ? "text-warn" : "")}>{p.stock_count}</span>
                        )}
                        <p className="text-[11px] text-faint">{p.variant_count} gói</p>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{p.order_count}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{vnd(p.revenue)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <StatusPill status={p.status} />
                          {p.needs_setup && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-bad" title={p.needs_setup_reason ?? undefined}>
                              <TriangleAlert size={11} /> Cần thiết lập
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-faint">{fmtDate(p.updated_at)}</td>
                      <td className="px-2 py-2.5">
                        <RowMenu product={p} onAction={(action, product) => request(action, [product.id], product.title)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Chân bảng ── */}
        {data && data.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2.5 text-[12.5px] text-muted">
            <div className="flex items-center gap-2">
              <span>
                {(data.page - 1) * data.per_page + 1}–{Math.min(data.page * data.per_page, data.total)} / {data.total} sản phẩm
              </span>
              <Select aria-label="Số dòng mỗi trang" value={query.size} onChange={(e) => setQuery({ size: Number(e.target.value) })} className="h-8 w-auto py-0 text-[12.5px]">
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / trang</option>)}
              </Select>
            </div>
            <Pagination page={query.page} totalPages={totalPages} onChange={(page) => setQuery({ page })} />
          </div>
        )}
      </Card>

      {/* ── Thanh thao tác hàng loạt ── */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-line bg-ink-panel px-3 py-2.5 text-white shadow-card-lg">
          <span className="px-1 text-[13px] font-medium tabular-nums">Đã chọn {selected.size}</span>
          <span className="h-5 w-px bg-white/15" />
          {(["activate", "pause", "draft"] as const).map((action) => (
            <button key={action} type="button" disabled={busy} onClick={() => request(action, [...selected], `${selected.size} sản phẩm`)}
              className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-white/90 transition-colors hover:bg-white/10 disabled:opacity-50">
              {BULK_ACTION_LABELS[action]}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => request("set_category", [...selected], `${selected.size} sản phẩm`)}
            className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-white/90 transition-colors hover:bg-white/10 disabled:opacity-50">
            Đổi danh mục…
          </button>
          <button type="button" disabled={busy} onClick={() => request("suspend", [...selected], `${selected.size} sản phẩm`)}
            className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-red-300 transition-colors hover:bg-white/10 disabled:opacity-50">
            Khoá…
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto h-8 rounded-lg px-2.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white">
            Bỏ chọn
          </button>
        </div>
      )}

      <ConfirmModal
        isOpen={confirm != null}
        onClose={() => { setConfirm(null); setReason(""); setTargetCategory(""); }}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.action === "set_category") {
            if (targetCategory !== "") void run("set_category", confirm.ids, { category_id: Number(targetCategory), reason: reason.trim() || undefined });
          } else {
            void run(confirm.action, confirm.ids, { reason: reason.trim() || undefined });
          }
        }}
        title={confirm?.action === "suspend" ? `Khoá ${confirm.title}?` : `Chuyển danh mục cho ${confirm?.title ?? ""}`}
        description={confirm?.action === "suspend"
          ? "Sản phẩm bị khoá biến mất khỏi chợ và người bán không tự mở lại được. Đơn đang chạy không bị ảnh hưởng."
          : "Sản phẩm sẽ hiện trong danh mục mới ngay lập tức."}
        confirmText={confirm?.action === "suspend" ? "Khoá" : "Chuyển"}
        variant={confirm?.action === "suspend" ? "danger" : "primary"}
        isLoading={busy}
        confirmDisabled={confirm?.action === "set_category" && targetCategory === ""}
      >
        <div className="space-y-3">
          {confirm?.action === "set_category" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-muted">Danh mục mới</span>
              <Select value={targetCategory} onChange={(e) => setTargetCategory(e.target.value ? Number(e.target.value) : "")}>
                <option value="">— Chọn danh mục —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted">Lý do {confirm?.action === "suspend" ? "(ghi vào lịch sử sản phẩm)" : "(không bắt buộc)"}</span>
            <textarea
              value={reason}
              maxLength={500}
              rows={2}
              onChange={(e) => setReason(e.target.value)}
              placeholder={confirm?.action === "suspend" ? "VD: Bán tài khoản vi phạm chính sách" : ""}
              className="rounded-lg border border-line-2 bg-surface px-3 py-2 text-[13px] outline-none focus:border-iris"
            />
          </label>
        </div>
      </ConfirmModal>
    </div>
  );
}
