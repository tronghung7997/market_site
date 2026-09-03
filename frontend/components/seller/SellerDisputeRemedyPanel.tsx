"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { cn } from "@/lib/cn";
import { Link } from "@/i18n/navigation";
import { AlertTriangle, ExternalLink, Package, RefreshCw } from "@/components/Icons";
import type { Dispute, Order, SellerDisputeResource } from "@/lib/types";
import { summarizeDisputeCase } from "@/lib/dispute-case";
import { Button, Input, Spinner, Textarea } from "@/components/ui";

const PAGE_SIZE = 100;

export function SellerDisputeRemedyPanel({
  disputeId,
  dispute,
  order,
  formatRefund,
  onChanged,
}: {
  disputeId: number;
  dispute?: Dispute | null;
  order?: Order | null;
  formatRefund: (amount: number) => string;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("seller");
  const apiErrorMessage = useApiErrorMessage();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<SellerDisputeResource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showResolved, setShowResolved] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [caps, setCaps] = useState<Record<number, number>>({});

  const [action, setAction] = useState<"refund" | "replace">("replace");
  const [replaceMode, setReplaceMode] = useState<"stock" | "pick">("stock");
  const [stockTotal, setStockTotal] = useState(0);
  const [stockSearch, setStockSearch] = useState("");
  const debouncedStockSearch = useDebounce(stockSearch, 250);
  const [stockPage, setStockPage] = useState(1);
  const [stockItems, setStockItems] = useState<Array<{ id: number; data: string }>>([]);
  const [stockMatchTotal, setStockMatchTotal] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingOnly = !showResolved;

  const loadClaimed = async () => {
    setLoading(true);
    try {
      const resp = await api.sellerDisputeResources(disputeId, {
        search: debouncedSearch || undefined,
        page,
        per_page: PAGE_SIZE,
        pending_only: pendingOnly,
      });
      setItems(resp.items);
      setTotal(resp.total);
      setCaps((current) => {
        const next = { ...current };
        for (const row of resp.items) {
          if (row.refund_amount_cap != null) next[row.id] = row.refund_amount_cap;
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadClaimed();
  }, [disputeId, debouncedSearch, page, pendingOnly]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, pendingOnly]);

  const [reloadingStock, setReloadingStock] = useState(false);

  const reloadStock = async () => {
    setReloadingStock(true);
    try {
      const resp = await api.sellerDisputeReplacements(disputeId, { page: 1, per_page: 1 });
      setStockTotal(resp.total);
      if (action === "replace" && replaceMode === "pick") {
        const pickResp = await api.sellerDisputeReplacements(disputeId, {
          search: debouncedStockSearch || undefined,
          page: stockPage,
          per_page: PAGE_SIZE,
        });
        setStockItems(pickResp.items);
        setStockMatchTotal(pickResp.total);
      }
    } catch {
      // ignore
    } finally {
      setReloadingStock(false);
    }
  };

  useEffect(() => {
    void api.sellerDisputeReplacements(disputeId, { page: 1, per_page: 1 }).then((resp) => {
      setStockTotal(resp.total);
    }).catch(() => setStockTotal(0));
  }, [disputeId]);

  useEffect(() => {
    if (action !== "replace" || replaceMode !== "pick") return;
    void api.sellerDisputeReplacements(disputeId, {
      search: debouncedStockSearch || undefined,
      page: stockPage,
      per_page: PAGE_SIZE,
    }).then((resp) => {
      setStockItems(resp.items);
      setStockMatchTotal(resp.total);
    }).catch(() => {
      setStockItems([]);
      setStockMatchTotal(0);
    });
  }, [action, replaceMode, disputeId, debouncedStockSearch, stockPage]);

  useEffect(() => {
    setStockPage(1);
  }, [debouncedStockSearch]);

  const toggle = (id: number, enabled: boolean) => {
    if (!enabled) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePick = (id: number) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllMatching = async () => {
    const resp = await api.sellerDisputeResources(disputeId, {
      search: debouncedSearch || undefined,
      pending_only: true,
      ids_only: true,
    });
    setSelected(new Set(resp.ids ?? []));
  };

  const selectFirstStockMatches = async () => {
    if (selected.size === 0) return;
    const resp = await api.sellerDisputeReplacements(disputeId, {
      search: debouncedStockSearch || undefined,
      ids_only: true,
    });
    setPicked(new Set((resp.ids ?? []).slice(0, selected.size)));
  };

  const caseSummary = dispute ? summarizeDisputeCase(dispute) : null;
  const selectedRefundTotal = [...selected].reduce((sum, id) => sum + (caps[id] ?? 0), 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stockPageCount = Math.max(1, Math.ceil(stockMatchTotal / PAGE_SIZE));

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    if (action === "replace" && replaceMode === "stock" && stockTotal < selected.size) {
      setError(t("notEnoughStock", { need: selected.size, have: stockTotal }));
      return;
    }
    if (action === "replace" && replaceMode === "pick" && picked.size !== selected.size) {
      setError(t("pickExactReplacements", { need: selected.size, have: picked.size }));
      return;
    }
    const confirmed = window.confirm(
      action === "refund"
        ? t("confirmRefundSelected", { count: selected.size, amount: formatRefund(selectedRefundTotal) })
        : replaceMode === "pick"
          ? t("confirmReplacePicked", { count: selected.size })
          : t("confirmReplaceSelected", { count: selected.size }),
    );
    if (!confirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.sellerResolveDisputeResourcesBatched(
        disputeId,
        [...selected],
        action,
        note.trim() || undefined,
        action === "replace" && replaceMode === "pick" ? [...picked] : undefined,
      );
      setSelected(new Set());
      setPicked(new Set());
      setNote("");
      setShowResolved(true);
      await loadClaimed();
      const stock = await api.sellerDisputeReplacements(disputeId, { page: 1, per_page: 1 });
      setStockTotal(stock.total);
      await onChanged();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, action === "refund" ? t("refundFailed") : t("replaceFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative space-y-4 text-xs">
      {submitting && (
        <div className="absolute inset-0 z-20 grid place-items-center rounded-xl bg-surface/80">
          <div className="flex items-center gap-2 text-muted">
            <Spinner />
            <span>{t("loading")}</span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/25 bg-warn-soft/30 px-3 py-2">
        <p className="text-muted">
          <span className="font-semibold text-fg">{t("claimedAccountsHintShort")}</span>
          {" · "}
          {t("showingClaimedAccounts", {
            from: total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1,
            to: Math.min(page * PAGE_SIZE, total),
            total,
          })}
        </p>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
            className="h-3.5 w-3.5 accent-iris"
          />
          {t("showResolvedAccounts")}
        </label>
      </div>
      {caseSummary && (caseSummary.refunded > 0 || caseSummary.replaced > 0) && (
        <p className="text-[11.5px] text-muted">
          {t("handledAccountsSummary", { refunded: caseSummary.refunded, replaced: caseSummary.replaced })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("searchClaimedAccounts")}
          aria-label={t("searchClaimedAccounts")}
          className="min-w-[220px] flex-1"
        />
        <Button size="sm" variant="secondary" onClick={() => void selectAllMatching()} disabled={loading}>
          {pendingOnly ? t("selectAllResults", { count: total }) : t("selectAllPendingMatches")}
        </Button>
        {selected.size > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("clearSelection")}</Button>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto rounded-xl border border-line divide-y divide-line/50">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted">
            <Spinner /><span>{t("loading")}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-muted">
            {pendingOnly && !debouncedSearch ? t("allClaimsHandled") : t("noClaimedAccounts")}
          </div>
        ) : items.map((resource) => {
          const pending = !resource.action;
          return (
            <label
              key={resource.id}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 text-[11.5px]",
                pending ? "cursor-pointer hover:bg-raised/60" : "cursor-default opacity-70",
                selected.has(resource.id) && "bg-iris-soft/20",
              )}
            >
              <input
                type="checkbox"
                checked={selected.has(resource.id)}
                disabled={!pending}
                onChange={() => toggle(resource.id, pending)}
                className="h-3.5 w-3.5 shrink-0 accent-iris"
              />
              <span className="shrink-0 font-mono text-[10.5px] text-faint">#{resource.id}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-fg">{resource.data}</span>
              {resource.refund_amount_cap != null && (
                <span className="shrink-0 font-mono text-[10.5px] text-muted">{formatRefund(resource.refund_amount_cap)}</span>
              )}
              {resource.action === "refund" && (
                <span className="shrink-0 rounded border border-good/30 bg-good-soft px-1.5 py-0.5 text-[10px] font-bold text-good">
                  ✓ {t("resourceRefunded")}
                  {resource.refund_amount_cap != null ? ` ${formatRefund(resource.refund_amount_cap)}` : ""}
                </span>
              )}
              {resource.action === "replace" && (
                <span className="shrink-0 rounded border border-iris/30 bg-iris-soft px-1.5 py-0.5 text-[10px] font-bold text-iris">
                  ✓ {resource.replacement_resource_id
                    ? t("resourceReplacedWith", { id: resource.replacement_resource_id })
                    : t("resourceReplaced")}
                </span>
              )}
              {!resource.action && <span className="shrink-0 text-[10px] font-medium text-warn">{t("claimPending")}</span>}
            </label>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>{t("pageOf", { page, pages: pageCount })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</Button>
            <Button size="sm" variant="ghost" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</Button>
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-line bg-raised/50 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
          <span className="text-muted">{t("selected")}: <span className="font-mono font-bold text-fg">{selected.size}</span></span>
          {selected.size > 0 && selectedRefundTotal > 0 && (
            <span className="text-muted">{t("refundEstimate")}: <span className="font-mono font-bold text-warn">{formatRefund(selectedRefundTotal)}</span></span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setAction("replace")}
            className={cn(
              "rounded-xl border px-3 py-2 text-left text-[12px] font-semibold",
              action === "replace" ? "border-iris bg-iris-soft/40 text-fg" : "border-line bg-surface text-muted",
            )}
          >
            {t("remedyReplace")}
            <span className="mt-0.5 block text-[10.5px] font-normal text-muted">{t("remedyReplaceHint", { count: stockTotal })}</span>
          </button>
          <button
            type="button"
            onClick={() => setAction("refund")}
            className={cn(
              "rounded-xl border px-3 py-2 text-left text-[12px] font-semibold",
              action === "refund" ? "border-bad bg-bad-soft/50 text-fg" : "border-line bg-surface text-muted",
            )}
          >
            {t("remedyRefund")}
            <span className="mt-0.5 block text-[10.5px] font-normal text-muted">{t("remedyRefundHint")}</span>
          </button>
        </div>

        {action === "replace" && (
          <div className="space-y-2.5 rounded-lg border border-line bg-surface p-2.5">
            {/* Out of stock or low stock banner with direct link to inventory */}
            {stockTotal < (selected.size || 1) && (
              <div className="p-3 rounded-xl border border-warn/30 bg-warn-soft/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <div className="text-[12px] font-bold text-warn flex items-center gap-1.5">
                    <AlertTriangle size={14} className="shrink-0" />
                    <span>
                      {stockTotal === 0
                        ? t("inventoryOutOfStockTitle")
                        : t("inventoryLowStockTitle", { available: stockTotal, need: selected.size || 1 })}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted">
                    {stockTotal === 0 ? t("inventoryOutOfStockDesc") : t("inventoryLowStockDesc")}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {order?.variant_id ? (
                    <Link
                      href={`/seller/inventory?variant=${order.variant_id}`}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 h-7.5 px-3 rounded-lg bg-iris hover:bg-iris/90 text-white font-semibold text-xs transition-colors shadow-xs"
                    >
                      <Package size={13} />
                      <span>{t("restockThisVariant")}</span>
                      <ExternalLink size={12} className="opacity-80" />
                    </Link>
                  ) : order?.product_id ? (
                    <Link
                      href={`/seller/inventory?product=${order.product_id}`}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 h-7.5 px-3 rounded-lg bg-iris hover:bg-iris/90 text-white font-semibold text-xs transition-colors shadow-xs"
                    >
                      <Package size={13} />
                      <span>{t("restockProduct")}</span>
                      <ExternalLink size={12} className="opacity-80" />
                    </Link>
                  ) : (
                    <Link
                      href="/seller/inventory"
                      target="_blank"
                      className="inline-flex items-center gap-1.5 h-7.5 px-3 rounded-lg bg-iris hover:bg-iris/90 text-white font-semibold text-xs transition-colors shadow-xs"
                    >
                      <Package size={13} />
                      <span>{t("openInventory")}</span>
                      <ExternalLink size={12} className="opacity-80" />
                    </Link>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    onClick={() => void reloadStock()}
                    disabled={reloadingStock}
                    className="h-7.5 px-2.5 text-xs gap-1"
                    title={t("refreshStock")}
                  >
                    <RefreshCw size={12} className={cn(reloadingStock && "animate-spin")} />
                    <span className="text-[11px]">{t("refreshStock")}</span>
                  </Button>
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 text-[12px] text-fg">
              <input type="radio" className="mt-0.5 accent-iris" checked={replaceMode === "stock"} onChange={() => setReplaceMode("stock")} />
              <span>
                <span className="font-semibold">{t("replaceFromStock")}</span>
                <span className="block text-[11px] text-muted">{t("replaceFromStockHint", { count: stockTotal })}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12px] text-fg">
              <input type="radio" className="mt-0.5 accent-iris" checked={replaceMode === "pick"} onChange={() => setReplaceMode("pick")} />
              <span>
                <span className="font-semibold">{t("replacePickAccounts")}</span>
                <span className="block text-[11px] text-muted">{t("replacePickAccountsHint")}</span>
              </span>
            </label>

            {replaceMode === "pick" && (
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={stockSearch}
                    onChange={(event) => setStockSearch(event.target.value)}
                    placeholder={t("searchStockAccounts")}
                    className="min-w-[200px] flex-1"
                  />
                  <Button size="sm" variant="secondary" onClick={() => void selectFirstStockMatches()} disabled={selected.size === 0}>
                    {t("selectFirstStock", { count: selected.size })}
                  </Button>
                </div>
                <p className="text-[11px] text-muted">{t("pickedStockCount", { picked: picked.size, need: selected.size })}</p>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-line divide-y divide-line/50">
                  {stockItems.map((row) => (
                    <label key={row.id} className={cn("flex cursor-pointer items-center gap-2 px-2.5 py-2 hover:bg-raised/60", picked.has(row.id) && "bg-iris-soft/20")}>
                      <input type="checkbox" checked={picked.has(row.id)} onChange={() => togglePick(row.id)} className="h-3.5 w-3.5 accent-iris" />
                      <span className="font-mono text-[10.5px] text-faint">#{row.id}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-fg">{row.data}</span>
                    </label>
                  ))}
                </div>
                {stockPageCount > 1 && (
                  <div className="flex items-center justify-end gap-2 text-[11px] text-muted">
                    <Button size="sm" variant="ghost" disabled={stockPage === 1} onClick={() => setStockPage((value) => Math.max(1, value - 1))}>‹</Button>
                    <span className="font-mono">{stockPage}/{stockPageCount}</span>
                    <Button size="sm" variant="ghost" disabled={stockPage === stockPageCount} onClick={() => setStockPage((value) => Math.min(stockPageCount, value + 1))}>›</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("resourceActionNote")} className="text-xs" />
        {error && <div className="rounded-lg border border-bad/20 bg-bad-soft p-2.5 text-xs font-medium text-bad">{error}</div>}
        <Button size="sm" disabled={submitting || selected.size === 0} onClick={() => void handleSubmit()}>
          {submitting ? t("loading") : action === "refund"
            ? t("refundSelected", { count: selected.size })
            : t("replaceSelected", { count: selected.size })}
        </Button>
      </div>
    </div>
  );
}
