"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { CategoryAdminListResponse, CategoryAdminRow, FeeConfigAdmin } from "@/lib/types";
import { Button, Spinner, Switch, Tag } from "@/components/ui";
import { SearchInput } from "@/components/admin";
import { useToast } from "@/components/toast";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, Layers, Package, Plus } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import { buildTree, flattenTree, matchesFilter, pathTo, type CategoryNode, type StatusFilter } from "../model";
import { CategoryDetailPanel, type PanelMode } from "./CategoryDetailPanel";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "", label: "Tất cả" },
  { key: "active", label: "Đang hiển thị" },
  { key: "hidden", label: "Đã ẩn" },
  { key: "empty", label: "Chưa có sản phẩm" },
];

function StatTile({ icon: Icon, label, value, sub, tone = "neutral", active, onClick }: {
  icon: typeof Layers; label: string; value: number; sub?: string;
  tone?: "neutral" | "iris" | "good" | "warn" | "bad"; active?: boolean; onClick?: () => void;
}) {
  const iconTone = { neutral: "bg-raised text-muted", iris: "bg-iris-soft text-iris", good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad" }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full min-h-[72px] items-center gap-3 rounded-card border bg-card px-4 py-3 text-left shadow-card transition-colors",
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

/** "Phí sàn 8% · Giữ ≥ 3 ngày · HH 5%" — what this category overrides, muted when it inherits. */
function FeeSummary({ row, fees }: { row: CategoryAdminRow; fees: FeeConfigAdmin | undefined }) {
  const feeOverride = fees?.category_fee_percent[String(row.id)];
  const escrowOverride = fees?.category_escrow_min_days[String(row.id)];
  const parts: React.ReactNode[] = [];
  if (feeOverride != null) parts.push(<span key="fee" className="font-medium text-fg">Phí sàn {feeOverride}%</span>);
  if (escrowOverride != null) parts.push(<span key="escrow" className="font-medium text-fg">Giữ ≥ {escrowOverride} ngày</span>);
  if (row.commission_rate != null) parts.push(<span key="comm" className="font-medium text-fg">Hoa hồng {row.commission_rate}%</span>);
  if (parts.length === 0) {
    return <span className="text-[12px] text-faint">Theo mặc định{fees ? ` (${fees.platform_fee_percent}%)` : ""}</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-[12px] text-muted">
      {parts.map((p, i) => <React.Fragment key={i}>{i > 0 && <span className="text-line-2">·</span>}{p}</React.Fragment>)}
    </span>
  );
}

function ProductCount({ row }: { row: CategoryAdminRow }) {
  const branch = row.child_count > 0 && row.branch_product_count !== row.product_count;
  return (
    <span className="block text-[12.5px] tabular-nums">
      {row.product_count === 0 ? (
        <span className="text-faint">{branch ? "—" : "Chưa có"}</span>
      ) : (
        <>
          <span className="font-medium text-fg">{row.active_product_count}</span>
          <span className="text-muted"> đang bán</span>
          {row.active_product_count !== row.product_count && <span className="text-faint"> / {row.product_count}</span>}
        </>
      )}
      {branch && (
        <span className="block text-[11.5px] text-faint">
          Cả nhánh: {row.branch_active_product_count}{row.branch_active_product_count !== row.branch_product_count ? ` / ${row.branch_product_count}` : ""}
        </span>
      )}
    </span>
  );
}

/** Admin › Danh mục: tree with counts, fee overrides, visibility, ordering and a detail panel. */
export function AdminCategoriesConsole() {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("");
  const [collapsed, setCollapsed] = React.useState<Set<number>>(() => new Set());
  const [panel, setPanel] = React.useState<PanelMode | null>(null);

  const query = useQuery({ queryKey: queryKeys.adminCategories(), queryFn: api.adminCategories });
  const fees = useQuery({ queryKey: queryKeys.adminFeeConfig(), queryFn: api.adminFeeConfig, staleTime: 60_000 });
  const rows = React.useMemo(() => query.data?.items ?? [], [query.data]);
  const summary = query.data?.summary;
  const tree = React.useMemo(() => buildTree(rows), [rows]);
  const filtering = Boolean(search.trim() || status);

  /** Tree mode hides collapsed branches; filter mode is a flat list with the path shown per row. */
  const visible: CategoryNode[] = React.useMemo(() => {
    const all = flattenTree(tree);
    if (filtering) return all.filter((n) => matchesFilter(n, status, search.trim()));
    const hiddenUnder = new Set<number>();
    return all.filter((n) => {
      if (n.parent_id != null && (collapsed.has(n.parent_id) || hiddenUnder.has(n.parent_id))) { hiddenUnder.add(n.id); return false; }
      return true;
    });
  }, [tree, filtering, status, search, collapsed]);

  const patchRow = (id: number, patch: Partial<CategoryAdminRow>) =>
    queryClient.setQueryData<CategoryAdminListResponse>(queryKeys.adminCategories(), (old) =>
      old ? { ...old, items: old.items.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : old,
    );
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminCategories() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.categoriesTree() });
  };

  const toggleActive = useMutation({
    mutationFn: ({ row, next }: { row: CategoryAdminRow; next: boolean }) => api.updateCategory(row.id, { is_active: next }),
    onMutate: ({ row, next }) => patchRow(row.id, { is_active: next }),
    onSuccess: (_, { row, next }) => { toast.success(next ? `Đã hiển thị "${row.name}"` : `Đã ẩn "${row.name}" khỏi cửa hàng`); refresh(); },
    onError: (e, { row, next }) => { patchRow(row.id, { is_active: !next }); toast.error(apiErrorMessage(e, "Không đổi được trạng thái")); },
  });

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.reorderCategories(ids),
    onMutate: (ids) => ids.forEach((id, idx) => patchRow(id, { sort_order: idx })),
    onSuccess: () => refresh(),
    onError: (e) => { toast.error(apiErrorMessage(e, "Không sắp xếp được")); refresh(); },
  });
  const move = (node: CategoryNode, dir: -1 | 1) => {
    const siblings = (node.parent_id == null ? tree : flattenTree(tree).find((n) => n.id === node.parent_id)?.children ?? []).map((n) => n.id);
    const idx = siblings.indexOf(node.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= siblings.length) return;
    [siblings[idx], siblings[target]] = [siblings[target], siblings[idx]];
    reorder.mutate(siblings);
  };

  const toggleCollapse = (id: number) => setCollapsed((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const parentsWithChildren = React.useMemo(() => flattenTree(tree).filter((n) => n.children.length > 0).map((n) => n.id), [tree]);
  const allCollapsed = parentsWithChildren.length > 0 && parentsWithChildren.every((id) => collapsed.has(id));

  const siblingIndex = (node: CategoryNode) => {
    const siblings = node.parent_id == null ? tree : flattenTree(tree).find((n) => n.id === node.parent_id)?.children ?? [];
    return { idx: siblings.findIndex((n) => n.id === node.id), count: siblings.length };
  };
  const byId = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const hiddenByAncestor = (node: CategoryNode) => pathTo(rows, node.parent_id).some((p) => !p.is_active);

  return (
    <div className="space-y-5">
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[13px] text-muted">Cây danh mục của cửa hàng: thứ tự hiển thị, tên hai ngôn ngữ, phí sàn và hoa hồng riêng. Bấm vào một dòng để sửa.</p>
        <div className="flex items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm theo tên hoặc slug…" />
          <Button onClick={() => setPanel({ kind: "create", parentId: null })}><Plus size={15} /> Thêm danh mục</Button>
        </div>
      </div>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={Layers} label="Tổng danh mục" value={summary.total} sub={`${summary.roots} cấp gốc`} tone="iris" active={!status} onClick={() => setStatus("")} />
          <StatTile icon={Eye} label="Đang hiển thị" value={summary.active} tone="good" active={status === "active"} onClick={() => setStatus((s) => (s === "active" ? "" : "active"))} />
          <StatTile icon={EyeOff} label="Đã ẩn" value={summary.hidden} sub={summary.hidden > 0 ? "Không xuất hiện ở cửa hàng" : undefined} tone={summary.hidden > 0 ? "warn" : "neutral"} active={status === "hidden"} onClick={() => setStatus((s) => (s === "hidden" ? "" : "hidden"))} />
          <StatTile icon={Package} label="Chưa có sản phẩm" value={summary.empty} sub="Tính cả danh mục con" tone={summary.empty > 0 ? "bad" : "neutral"} active={status === "empty"} onClick={() => setStatus((s) => (s === "empty" ? "" : "empty"))} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-card p-0.5" role="tablist" aria-label="Lọc theo trạng thái">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={status === f.key}
              onClick={() => setStatus(f.key)}
              className={cn("rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors", status === f.key ? "bg-iris text-surface" : "text-muted hover:text-fg")}
            >
              {f.label}
            </button>
          ))}
        </div>
        {!filtering && parentsWithChildren.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parentsWithChildren))}>
            {allCollapsed ? "Mở rộng tất cả" : "Thu gọn tất cả"}
          </Button>
        )}
        {filtering && <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setStatus(""); }}>Bỏ lọc</Button>}
        <span className="ml-auto text-[12px] text-faint">
          {query.data ? (filtering ? `${visible.length} / ${rows.length} danh mục` : `${rows.length} danh mục`) : ""}
          {query.isFetching && query.data ? " · đang tải…" : ""}
        </span>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        {query.isPending ? (
          <div className="grid place-items-center py-20"><Spinner /></div>
        ) : query.isError ? (
          <div className="px-5 py-12 text-center text-[13px] text-bad">Không tải được danh mục. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void query.refetch()}>Thử lại</Button></div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[13.5px] font-medium text-fg">Chưa có danh mục nào.</p>
            <p className="mt-1 text-[12.5px] text-muted">Tạo danh mục gốc trước, rồi thêm danh mục con bên trong.</p>
            <Button className="mt-4" onClick={() => setPanel({ kind: "create", parentId: null })}><Plus size={15} /> Thêm danh mục</Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[13.5px] font-medium text-fg">Không có danh mục nào khớp.</p>
            <p className="mt-1 text-[12.5px] text-muted">Thử từ khoá khác hoặc bỏ bộ lọc trạng thái.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-raised/40 text-left text-[12px] text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Danh mục</th>
                  <th className="w-[160px] px-3 py-2.5 font-medium">Sản phẩm</th>
                  <th className="w-[230px] px-3 py-2.5 font-medium">Phí & hoa hồng</th>
                  <th className="w-[110px] px-3 py-2.5 font-medium">Hiển thị</th>
                  <th className="w-[124px] px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((node) => {
                  const { idx, count } = siblingIndex(node);
                  const isOpen = !collapsed.has(node.id);
                  const ancestorHidden = hiddenByAncestor(node);
                  const path = filtering ? pathTo(rows, node.parent_id) : [];
                  return (
                    <tr
                      key={node.id}
                      onClick={() => setPanel({ kind: "edit", id: node.id })}
                      className={cn(
                        "group cursor-pointer transition-colors hover:bg-raised/40",
                        !node.is_active && "bg-raised/30",
                        panel?.kind === "edit" && panel.id === node.id && "bg-iris-soft/40",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2" style={{ paddingLeft: filtering ? 0 : node.depth * 26 }}>
                          {!filtering && (
                            node.children.length > 0 ? (
                              <button
                                type="button"
                                aria-label={isOpen ? "Thu gọn" : "Mở rộng"}
                                aria-expanded={isOpen}
                                onClick={(e) => { e.stopPropagation(); toggleCollapse(node.id); }}
                                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-fg"
                              >
                                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </button>
                            ) : (
                              <span className={cn("h-6 w-6 shrink-0", node.depth > 0 && "relative")}>
                                {node.depth > 0 && <span aria-hidden className="absolute left-1/2 top-1/2 h-px w-3 -translate-y-1/2 bg-line-2" />}
                              </span>
                            )
                          )}
                          <ProductCover coverId={categoryCoverId(node)} title={node.name} className={cn("h-8 w-8 shrink-0 rounded-md", !node.is_active && "opacity-50 grayscale")} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {path.length > 0 && (
                                <span className="min-w-0 truncate text-[12px] text-faint">{path.map((p) => p.name).join(" › ")} ›</span>
                              )}
                              <span className={cn("min-w-0 truncate font-medium", node.is_active ? "text-fg" : "text-muted")}>{node.name}</span>
                              {!node.is_active && <Tag tone="neutral">Đã ẩn</Tag>}
                              {node.is_active && ancestorHidden && <Tag tone="warn">Cha đang ẩn</Tag>}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
                              <span className="font-mono">{node.slug}</span>
                              {node.name_en ? <span>EN: {node.name_en}</span> : <span className="text-warn">Chưa có tên EN</span>}
                              {node.child_count > 0 && <span>{node.child_count} danh mục con</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-middle"><ProductCount row={node} /></td>
                      <td className="px-3 py-2.5 align-middle"><FeeSummary row={node} fees={fees.data} /></td>
                      <td className="px-3 py-2.5 align-middle" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={node.is_active}
                          disabled={toggleActive.isPending && toggleActive.variables?.row.id === node.id}
                          onChange={(next) => toggleActive.mutate({ row: node, next })}
                          label={node.is_active ? `Ẩn ${node.name}` : `Hiển thị ${node.name}`}
                        />
                      </td>
                      <td className="px-3 py-2.5 align-middle" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                          {!filtering && (
                            <>
                              <button type="button" aria-label="Chuyển lên" disabled={idx <= 0 || reorder.isPending} onClick={() => move(node, -1)} className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"><ArrowUp size={14} /></button>
                              <button type="button" aria-label="Chuyển xuống" disabled={idx >= count - 1 || reorder.isPending} onClick={() => move(node, 1)} className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"><ArrowDown size={14} /></button>
                            </>
                          )}
                          <button type="button" aria-label={`Thêm danh mục con trong ${node.name}`} title="Thêm danh mục con" onClick={() => setPanel({ kind: "create", parentId: node.id })} className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-iris-soft hover:text-iris"><Plus size={14} /></button>
                          <button type="button" aria-label="Mở chi tiết" onClick={() => setPanel({ kind: "edit", id: node.id })} className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-raised hover:text-fg"><ChevronRight size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CategoryDetailPanel
        mode={panel}
        rows={rows}
        fees={fees.data}
        onClose={() => setPanel(null)}
        onOpen={(next) => setPanel(next)}
        onChanged={refresh}
        row={panel?.kind === "edit" ? byId.get(panel.id) ?? null : null}
      />
    </div>
  );
}
