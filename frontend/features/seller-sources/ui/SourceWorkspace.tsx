"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { SourceArea, SourceCatalogItem, SourceListing, SupplierSource } from "@/lib/types";
import { Button, Input, Select, Spinner, Switch, Tag } from "@/components/ui";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Plus, RefreshCw, Search } from "@/components/Icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { groupListings, needsAttention, type ListingGroup } from "../logic";
import { AddProductsDrawer, type ExistingProduct } from "./AddProductsDrawer";
import { ProxySourceWorkspace } from "./ProxySourceWorkspace";
import { relTime } from "./SourcesList";

type Filter = "all" | "selling" | "attention" | "paused";

export function SourceWorkspace({ area, sourceId }: { area: SourceArea; sourceId: number }) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const params = useSearchParams();
  const base = area === "admin" ? "/admin/sources" : "/seller/sources";
  const productBase = area === "admin" ? "/admin/products" : "/seller/products";

  const [source, setSource] = useState<SupplierSource | null>(null);
  const [rows, setRows] = useState<SourceListing[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(params.get("filter") === "attention" ? "attention" : "all");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Record<number, string>>({});
  const [margin, setMargin] = useState("30");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<{ presetProductId: number | null } | null>(params.get("add") ? { presetProductId: null } : null);
  const [confirmDetach, setConfirmDetach] = useState<SourceListing | null>(null);
  const [changeSku, setChangeSku] = useState<SourceListing | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await api.sources.list(area);
      const s = all.find((x) => x.id === sourceId) ?? null;
      setSource(s);
      // Nguồn proxy có workspace riêng (gói đang bán thay cho listings).
      const listings = s?.kind === "proxy" ? [] : await api.sources.listings(area, sourceId);
      setRows(listings);
      if (s) setMargin((m) => (m === "30" ? String(Math.max(s.min_margin_pct, 30)) : m));
      setError("");
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [area, sourceId, apiErrorMessage]);
  useEffect(() => { void load(); }, [load]);

  const patchRow = (updated: SourceListing) => setRows((rs) => rs?.map((r) => (r.listing_id === updated.listing_id ? updated : r)) ?? null);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.sources.sync(area, sourceId);
      setNotice(r.error ? `${t("syncFailed")}: ${r.error}` : t("syncDone", { items: r.catalog_items, updated: r.updated, delisted: r.delisted, low: r.low_margin }));
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  const savePrice = async (row: SourceListing) => {
    const raw = editing[row.listing_id];
    if (raw === undefined) return;
    const price = Number(raw);
    setEditing((e) => { const n = { ...e }; delete n[row.listing_id]; return n; });
    if (!Number.isFinite(price) || price === row.price) return;
    try {
      patchRow(await api.sources.updateListing(area, row.listing_id, { price }));
      setNotice(t("priceSaved"));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const toggleActive = async (row: SourceListing, next: boolean) => {
    try {
      patchRow(await api.sources.updateListing(area, row.listing_id, { is_active: next }));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const moveTo = async (row: SourceListing, productId: number) => {
    try {
      await api.sources.updateListing(area, row.listing_id, { product_id: productId });
      await load();
      setNotice(t("moved"));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const reprice = async (onlyBelowMin: boolean) => {
    setBusy(true);
    try {
      const r = await api.sources.reprice(area, sourceId, { margin_pct: Number(margin) || 0, only_below_min: onlyBelowMin });
      setNotice(t("repriced", { n: r.changed.length }));
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const detach = async () => {
    if (!confirmDetach) return;
    setBusy(true);
    try {
      await api.sources.detach(area, confirmDetach.listing_id);
      setConfirmDetach(null);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    const keep = (r: SourceListing) => {
      if (filter === "selling" && !(r.variant_active && !needsAttention(r))) return false;
      if (filter === "attention" && !needsAttention(r)) return false;
      if (filter === "paused" && r.variant_active) return false;
      if (needle && !`${r.product_title} ${r.variant_name} ${r.external_id} ${r.external_name ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    };
    return groupListings(rows.filter(keep));
  }, [rows, q, filter]);

  const counts = useMemo(() => ({
    all: rows?.length ?? 0,
    selling: rows?.filter((r) => r.variant_active && !needsAttention(r)).length ?? 0,
    attention: rows?.filter(needsAttention).length ?? 0,
    paused: rows?.filter((r) => !r.variant_active).length ?? 0,
  }), [rows]);
  const lowCount = rows?.filter((r) => !r.margin_ok && !r.sync_error).length ?? 0;
  const allProducts = useMemo(() => groupListings(rows ?? []), [rows]);
  const existing: ExistingProduct[] = useMemo(
    () => allProducts.map((g) => ({ product_id: g.product_id, product_title: g.product_title, variant_count: g.rows.length })),
    [allProducts],
  );

  const toggleCollapse = (id: number) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (source?.kind === "proxy") return <ProxySourceWorkspace area={area} source={source} onSourceChange={load} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={base} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
            <ChevronLeft className="h-3.5 w-3.5" />{area === "admin" ? t("adminTitle") : t("title")}
          </Link>
          <h1 className="truncate text-lg font-bold text-fg">{source?.name ?? "…"}</h1>
          {source && (
            <p className="text-[12.5px] text-muted">
              {t("detailMeta", { products: allProducts.length, variants: rows?.length ?? 0, synced: relTime(source.catalog_synced_at, t) })}
              {area === "admin" && ` · ${source.seller_email ?? t("unassigned")}`}
            </p>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={sync} disabled={syncing}>
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />{syncing ? t("syncing") : t("syncNow")}
        </Button>
        <Button size="sm" onClick={() => setDrawer({ presetProductId: null })} disabled={!source}>
          <Plus className="h-3.5 w-3.5" />{t("addProducts")}
        </Button>
      </div>
      {notice && <p className="text-[12.5px] text-good">{notice}</p>}
      {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-[200px] sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input id="lst-q" className="h-9 pl-8" placeholder={t("searchListings")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {(["all", "selling", "attention", "paused"] as Filter[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium",
              filter === f ? "border-fg bg-fg text-card" : "border-line bg-card text-muted hover:text-fg")}>
            {t(`filter_${f}`)}
            <span className={cn("font-mono text-[11px]", f === "attention" && counts.attention > 0 && filter !== f ? "text-warn" : "opacity-70")}>{counts[f]}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted">
          <label htmlFor="lst-margin">{t("applyMargin")}</label>
          <Input id="lst-margin" type="number" min={0} className="h-8 w-16 font-mono" value={margin} onChange={(e) => setMargin(e.target.value)} />
          <span>%</span>
          <Button size="sm" variant="secondary" disabled={busy || !rows?.length} onClick={() => reprice(false)}>{t("applyAll")}</Button>
          <Button size="sm" variant="secondary" disabled={busy || lowCount === 0} onClick={() => reprice(true)}>{t("applyLow", { n: lowCount })}</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-[13px]">
          <thead className="bg-surface text-[11px] uppercase tracking-wider text-faint">
            <tr>
              <th className="p-2.5 text-left">{t("productVariant")}</th>
              <th className="p-2.5 text-right">{t("cost")}</th>
              <th className="p-2.5 text-right">{t("price")}</th>
              <th className="p-2.5 text-right">{t("margin")}</th>
              <th className="p-2.5 text-right">{t("stock")}</th>
              <th className="p-2.5 text-left">{t("status")}</th>
              <th className="p-2.5 text-right">{t("sell")}</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={7} className="p-6 text-center"><Spinner /></td></tr>}
            {groups.map((g) => (
              <ProductRows
                key={g.product_id} g={g} open={!collapsed.has(g.product_id)} onToggle={() => toggleCollapse(g.product_id)}
                productHref={`${productBase}/${g.public_key}`} others={allProducts.filter((p) => p.product_id !== g.product_id)}
                editing={editing} setEditing={setEditing} savePrice={savePrice} toggleActive={toggleActive}
                onAddVariant={() => setDrawer({ presetProductId: g.product_id })}
                onMove={moveTo} onChangeSku={setChangeSku} onDetach={setConfirmDetach}
                format={(n: number) => formatLedgerMoney(n, locale)}
              />
            ))}
            {rows && rows.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-muted">
                {t("noListings")}
                <div className="mt-3"><Button size="sm" onClick={() => setDrawer({ presetProductId: null })}><Plus className="h-3.5 w-3.5" />{t("addProducts")}</Button></div>
              </td></tr>
            )}
            {rows && rows.length > 0 && groups.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted">{t("noMatch")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-faint">{t("tableHint")}</p>

      {drawer && source && (
        <AddProductsDrawer
          area={area} source={source} existing={existing} presetProductId={drawer.presetProductId}
          onClose={() => setDrawer(null)}
          onDone={(n) => { setDrawer(null); setNotice(t("importDone", { n })); void load(); }}
        />
      )}

      {changeSku && (
        <ChangeSkuDialog
          area={area} sourceId={sourceId} row={changeSku} onClose={() => setChangeSku(null)}
          onPick={async (item) => {
            try {
              patchRow(await api.sources.updateListing(area, changeSku.listing_id, { external_id: item.external_id }));
              setChangeSku(null);
              setNotice(t("skuChanged"));
            } catch (e) { setError(apiErrorMessage(e)); }
          }}
        />
      )}

      <Dialog open={confirmDetach !== null} onOpenChange={(o) => { if (!o && !busy) setConfirmDetach(null); }}>
        <DialogContent className="max-w-sm border-line bg-surface p-5 text-fg">
          <DialogHeader><DialogTitle className="text-[15px] font-bold">{t("detachTitle")}</DialogTitle></DialogHeader>
          <p className="text-[12.5px] text-muted">{t("detachBody", { name: confirmDetach ? `${confirmDetach.product_title} · ${confirmDetach.variant_name}` : "" })}</p>
          <DialogFooter className="mt-2 flex-row justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDetach(null)} disabled={busy}>{t("cancel")}</Button>
            <Button size="sm" variant="danger" onClick={detach} disabled={busy}>{t("detach")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Một sản phẩm = dòng đầu (mở/thu) + các dòng phân loại               */
/* ------------------------------------------------------------------ */

function ProductRows({ g, open, onToggle, productHref, others, editing, setEditing, savePrice, toggleActive, onAddVariant, onMove, onChangeSku, onDetach, format }: {
  g: ListingGroup; open: boolean; onToggle: () => void; productHref: string; others: ListingGroup[];
  editing: Record<number, string>; setEditing: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  savePrice: (r: SourceListing) => void; toggleActive: (r: SourceListing, next: boolean) => void;
  onAddVariant: () => void; onMove: (r: SourceListing, productId: number) => void;
  onChangeSku: (r: SourceListing) => void; onDetach: (r: SourceListing) => void;
  format: (n: number) => string;
}) {
  const t = useTranslations("sellerSources");
  const status = g.delisted > 0
    ? <Tag tone="warn">{t("productDelisted", { n: g.delisted })}</Tag>
    : g.autoPaused > 0 ? <Tag tone="warn">{t("productAutoPaused", { n: g.autoPaused })}</Tag>
    : g.lowMargin > 0 ? <Tag tone="bad">{t("productLowMargin", { n: g.lowMargin })}</Tag>
    : g.product_status !== "active" ? <Tag tone="neutral">{t(`pstatus_${g.product_status}`)}</Tag>
    : g.active === 0 ? <Tag tone="neutral">{t("allPaused")}</Tag>
    : <Tag tone="good">{t("selling")}</Tag>;
  return (
    <>
      <tr className="border-t border-line bg-surface/70">
        <td className="p-2" colSpan={5}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onToggle} className="inline-flex items-center gap-1.5 text-fg" aria-expanded={open}>
              {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
              <span className="font-semibold">{g.product_title}</span>
            </button>
            <span className="text-[12px] text-faint">{t("variantsN", { n: g.rows.length })}</span>
          </div>
        </td>
        <td className="p-2">{status}</td>
        <td className="p-2 text-right whitespace-nowrap">
          <Button size="sm" variant="ghost" onClick={onAddVariant}><Plus className="h-3.5 w-3.5" />{t("variant")}</Button>
          <Link href={productHref}><Button size="sm" variant="ghost">{t("productPage")}</Button></Link>
        </td>
      </tr>
      {open && g.rows.map((r) => {
        const delisted = Boolean(r.sync_error);
        const autoPaused = !delisted && Boolean(r.auto_paused_at);
        const low = !delisted && !autoPaused && !r.margin_ok;
        return (
          <tr key={r.listing_id} className={cn("border-t border-line/60", (delisted || autoPaused) && "bg-warn-soft/40", low && "bg-bad-soft/30", !r.variant_active && !delisted && !low && !autoPaused && "opacity-60")}>
            <td className="p-2 pl-9">
              <div className="text-fg">{r.variant_name}</div>
              <div className="text-[11px] text-faint">
                <span className="font-mono">#{r.external_id}</span>{r.external_name && <span className="ml-1 truncate">· {r.external_name}</span>}
              </div>
              {autoPaused && <div className="mt-0.5 text-[11.5px] text-warn">{t("autoPausedReason", { n: r.fail_streak, reason: r.last_fail_reason ?? "" })}</div>}
            </td>
            <td className="p-2 text-right font-mono tabular-nums text-muted">{delisted ? "—" : format(r.cost_price)}</td>
            <td className="p-2 text-right">
              <input
                id={`lst-price-${r.listing_id}`}
                className="h-8 w-24 rounded-md border border-line bg-card px-2 text-right font-mono text-[13px] tabular-nums focus:border-iris"
                type="number" min={0} step={500}
                value={editing[r.listing_id] ?? r.price}
                onChange={(e) => setEditing((s) => ({ ...s, [r.listing_id]: e.target.value }))}
                onBlur={() => savePrice(r)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                aria-label={t("price")}
              />
            </td>
            <td className={cn("p-2 text-right font-mono tabular-nums font-semibold", delisted ? "text-faint" : r.margin_ok ? "text-good" : "text-bad")}>
              {r.margin_pct == null || delisted ? "—" : `${Math.round(r.margin_pct)}%`}
            </td>
            <td className={cn("p-2 text-right font-mono tabular-nums", r.sellable === 0 ? "text-bad" : r.sellable < 50 ? "text-warn" : "text-fg")}>{delisted ? "—" : r.sellable.toLocaleString()}</td>
            <td className="p-2">
              {delisted ? <Tag tone="warn"><AlertTriangle className="h-3 w-3" />{t("delisted")}</Tag>
                : autoPaused ? <Tag tone="warn"><AlertTriangle className="h-3 w-3" />{t("autoPaused")}</Tag>
                : low ? <Tag tone="bad">{t("lowMarginTag")}</Tag>
                : r.variant_active ? <Tag tone="good">{t("selling")}</Tag>
                : <Tag tone="neutral">{t("paused")}</Tag>}
            </td>
            <td className="p-2 text-right whitespace-nowrap">
              <div className="inline-flex items-center gap-1.5">
                {delisted && <Button size="sm" variant="secondary" onClick={() => onChangeSku(r)}>{t("changeSku")}</Button>}
                {autoPaused && <Button size="sm" variant="secondary" onClick={() => toggleActive(r, true)}>{t("resume")}</Button>}
                <Select id={`lst-more-${r.listing_id}`} className="h-8 w-[34px] px-1 text-[12px]" value="" aria-label={t("more")}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "sku") onChangeSku(r);
                    else if (v === "detach") onDetach(r);
                    else if (v.startsWith("move:")) onMove(r, Number(v.slice(5)));
                  }}>
                  <option value="">⋯</option>
                  {others.map((o) => <option key={o.product_id} value={`move:${o.product_id}`}>{t("moveToProduct", { title: o.product_title })}</option>)}
                  <option value="sku">{t("changeSku")}</option>
                  <option value="detach">{t("detach")}</option>
                </Select>
                <Switch checked={r.variant_active} onChange={(next) => toggleActive(r, next)} label={t("sell")} />
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Đổi SKU cho một phân loại (khi nguồn gỡ SKU cũ)                     */
/* ------------------------------------------------------------------ */

function ChangeSkuDialog({ area, sourceId, row, onClose, onPick }: {
  area: SourceArea; sourceId: number; row: SourceListing; onClose: () => void; onPick: (item: SourceCatalogItem) => void;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const [q, setQ] = useState(row.external_name ? row.external_name.split(" ").slice(0, 2).join(" ") : "");
  const [items, setItems] = useState<SourceCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const h = setTimeout(async () => {
      setLoading(true);
      try {
        setItems((await api.sources.catalog(area, sourceId, { q, in_stock: true, per_page: 12 })).items);
      } finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(h);
  }, [area, sourceId, q]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg border-line bg-surface p-5 text-fg">
        <DialogHeader><DialogTitle className="text-[15px] font-bold">{t("changeSkuTitle", { name: row.variant_name })}</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input id="sku-q" className="h-9 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} autoFocus />
        </div>
        <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {loading && items.length === 0 && <div className="p-4 text-center"><Spinner /></div>}
          {items.map((it) => (
            <button key={it.external_id} type="button" onClick={() => onPick(it)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-card">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg">{it.name}</span>
                <span className="text-[11px] text-faint"><span className="font-mono">#{it.external_id}</span> · {it.group_name}</span>
              </span>
              <span className="font-mono text-[12px] tabular-nums text-muted">{formatLedgerMoney(it.cost_price, locale)}</span>
              <span className="font-mono text-[12px] tabular-nums text-good">{it.amount.toLocaleString()}</span>
            </button>
          ))}
          {!loading && items.length === 0 && <p className="p-4 text-center text-[13px] text-muted">{t("noMatch")}</p>}
        </div>
        <DialogFooter className="mt-1 flex-row justify-end"><Button size="sm" variant="ghost" onClick={onClose}>{t("cancel")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
