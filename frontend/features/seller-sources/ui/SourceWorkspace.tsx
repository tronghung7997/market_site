"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type {
  Category, SourceArea, SourceCatalogItem, SourceCatalogPage, SourceImportItem, SourceListing, SupplierSource,
} from "@/lib/types";
import { Button, Card, Field, Input, Select, Spinner, Tag, Textarea } from "@/components/ui";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Search, Trash, X } from "@/components/Icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { suggestPrice } from "../logic";

type TabKey = "catalog" | "listings";

export function SourceWorkspace({ area, sourceId }: { area: SourceArea; sourceId: number }) {
  const t = useTranslations("sellerSources");
  const apiErrorMessage = useApiErrorMessage();
  const base = area === "admin" ? "/admin/sources" : "/seller/sources";
  const [source, setSource] = useState<SupplierSource | null>(null);
  const [tab, setTab] = useState<TabKey>("catalog");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const loadSource = useCallback(async () => {
    try {
      const all = await api.sources.list(area);
      setSource(all.find((s) => s.id === sourceId) ?? null);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [area, sourceId, apiErrorMessage]);
  useEffect(() => { void loadSource(); }, [loadSource]);

  const sync = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await api.sources.sync(area, sourceId);
      setSyncMsg(r.error ? `${t("syncFailed")}: ${r.error}` : t("syncDone", { items: r.catalog_items, updated: r.updated, delisted: r.delisted, low: r.low_margin }));
      setRefreshKey((k) => k + 1);
      await loadSource();
    } catch (e) {
      setSyncMsg(apiErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={base} className="text-[12px] text-muted hover:text-fg inline-flex items-center gap-1">
            <ChevronLeft className="h-3.5 w-3.5" />{t("title")}
          </Link>
          <h1 className="text-lg font-bold text-fg truncate">{source?.name ?? "…"}</h1>
          {source && (
            <p className="text-[12.5px] text-muted">
              {t("headerMeta", { catalog: source.catalog_count, listings: source.listing_count, margin: source.min_margin_pct })}
              {area === "admin" && ` · ${source.seller_email ?? t("unassigned")}`}
            </p>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={sync} disabled={syncing}>
          <RefreshCw className="h-3.5 w-3.5" />{syncing ? t("syncing") : t("syncNow")}
        </Button>
      </div>
      {syncMsg && <p className="text-[12.5px] text-muted">{syncMsg}</p>}
      {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}

      <div className="flex gap-1 border-b border-line">
        {(["catalog", "listings"] as TabKey[]).map((k) => (
          <button
            key={k} type="button" onClick={() => setTab(k)}
            className={cn("px-3 py-2 text-[13px] font-medium border-b-2 -mb-px", tab === k ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg")}
          >
            {k === "catalog" ? t("tabCatalog") : t("tabListings")}
          </button>
        ))}
      </div>

      {source && tab === "catalog" && (
        <CatalogBrowser area={area} source={source} refreshKey={refreshKey} onImported={() => { setRefreshKey((k) => k + 1); void loadSource(); }} />
      )}
      {source && tab === "listings" && (
        <ListingsTable area={area} source={source} refreshKey={refreshKey} onChanged={() => void loadSource()} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

function CatalogBrowser({ area, source, refreshKey, onImported }: {
  area: SourceArea; source: SupplierSource; refreshKey: number; onImported: () => void;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [inStock, setInStock] = useState(true);
  const [maxCost, setMaxCost] = useState("");
  const [sort, setSort] = useState<"stock" | "cost_asc" | "cost_desc" | "name">("stock");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SourceCatalogPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Map<string, SourceCatalogItem>>(new Map());
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        setData(await api.sources.catalog(area, source.id, {
          q, group, in_stock: inStock, max_cost: maxCost ? Number(maxCost) : null, page, per_page: 50, sort,
        }));
        setError("");
      } catch (e) {
        setError(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [area, source.id, q, group, inStock, maxCost, page, sort, refreshKey, apiErrorMessage]);

  const toggle = (item: SourceCatalogItem) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.external_id)) next.delete(item.external_id); else next.set(item.external_id, item);
      return next;
    });
  };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="space-y-1">
        <p className="px-2 text-[11px] uppercase tracking-wider text-faint">{t("groups")}</p>
        <button type="button" onClick={() => { setGroup(""); setPage(1); }}
          className={cn("w-full text-left rounded-md px-2 py-1.5 text-[13px]", group === "" ? "bg-iris-soft text-iris-hi font-medium" : "text-muted hover:bg-surface")}>
          {t("allGroups")}
        </button>
        {data?.groups.map((g) => (
          <button key={g.name} type="button" onClick={() => { setGroup(g.name); setPage(1); }}
            className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]", group === g.name ? "bg-iris-soft text-iris-hi font-medium" : "text-muted hover:bg-surface")}>
            <span className="truncate flex-1">{g.name}</span>
            <span className="font-mono text-[11px] text-faint">{g.count}</span>
          </button>
        ))}
        {data && data.groups.length === 0 && <p className="px-2 text-[12px] text-faint">{t("noCatalog")}</p>}
      </aside>

      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
            <Input id="src-q" className="pl-8 h-9" placeholder={t("searchPlaceholder")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Input id="src-maxcost" className="h-9 w-32 font-mono" type="number" min={0} step={1000} placeholder={t("maxCost")} value={maxCost} onChange={(e) => { setMaxCost(e.target.value); setPage(1); }} />
          <Select id="src-sort" className="h-9 w-40" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="stock">{t("sortStock")}</option>
            <option value="cost_asc">{t("sortCostAsc")}</option>
            <option value="cost_desc">{t("sortCostDesc")}</option>
            <option value="name">{t("sortName")}</option>
          </Select>
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            <input id="src-instock" type="checkbox" checked={inStock} onChange={(e) => { setInStock(e.target.checked); setPage(1); }} />
            {t("inStockOnly")}
          </label>
        </div>
        {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}

        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full text-[13px]">
            <thead className="bg-surface text-[11px] uppercase tracking-wider text-faint">
              <tr>
                <th className="w-8 p-2"></th>
                <th className="p-2 text-left">{t("sku")}</th>
                <th className="p-2 text-right">{t("cost")}</th>
                <th className="p-2 text-right">{t("suggested")}</th>
                <th className="p-2 text-right">{t("stock")}</th>
                <th className="p-2 text-left">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && <tr><td colSpan={6} className="p-6 text-center"><Spinner /></td></tr>}
              {data?.items.map((it) => {
                const on = selected.has(it.external_id);
                return (
                  <tr key={it.external_id} onClick={() => toggle(it)} className={cn("border-t border-line cursor-pointer hover:bg-surface", on && "bg-iris-soft/40")}>
                    <td className="p-2 align-top"><input type="checkbox" checked={on} onChange={() => toggle(it)} onClick={(e) => e.stopPropagation()} aria-label={it.external_id} /></td>
                    <td className="p-2 align-top">
                      <div className="text-fg">{it.name}</div>
                      <div className="text-[11px] text-faint font-mono">
                        #{it.external_id} · {it.category_path.join(" › ")}
                        {it.format_hint && <span className="ml-1">· {it.format_hint}</span>}
                      </div>
                    </td>
                    <td className="p-2 align-top text-right font-mono tabular-nums">{formatLedgerMoney(it.cost_price, locale)}</td>
                    <td className="p-2 align-top text-right font-mono tabular-nums text-muted">{formatLedgerMoney(suggestPrice(it.cost_price, Math.max(source.min_margin_pct, 30)), locale)}</td>
                    <td className={cn("p-2 align-top text-right font-mono tabular-nums", it.amount === 0 ? "text-bad" : it.amount < 50 ? "text-warn" : "text-good")}>{it.amount.toLocaleString()}</td>
                    <td className="p-2 align-top">
                      {it.attached.length > 0
                        ? <Tag tone="iris">{t("attachedN", { n: it.attached.length })}</Tag>
                        : <span className="text-[12px] text-faint">—</span>}
                    </td>
                  </tr>
                );
              })}
              {data && data.items.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">{t("noMatch")}</td></tr>}
            </tbody>
          </table>
        </div>
        {data && (
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <span>{t("pageInfo", { shown: data.items.length, total: data.total })}</span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="font-mono">{page}/{totalPages}</span>
            <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur px-4 py-3 lg:left-[240px]">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <span className="text-[13px] font-medium text-fg">{t("selectedN", { n: selected.size })}</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}><X className="h-3.5 w-3.5" />{t("clear")}</Button>
            <span className="flex-1" />
            <Button size="sm" onClick={() => setImportOpen(true)}>{t("importSelected")}</Button>
          </div>
        </div>
      )}

      {importOpen && (
        <ImportDialog
          area={area} source={source} items={[...selected.values()]}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); setSelected(new Map()); onImported(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Import dialog                                                       */
/* ------------------------------------------------------------------ */

type Draft = SourceImportItem & { cost_price: number; name: string };

function cleanTitle(name: string): string {
  // "H30. Clone Ngoại TUT..." → bỏ mã đầu dòng của shop; giữ phần mô tả.
  return name.replace(/^[A-Z]{1,3}\d{1,4}\.\s*/i, "").replace(/\s{2,}/g, " ").trim();
}

function ImportDialog({ area, source, items, onClose, onDone }: {
  area: SourceArea; source: SupplierSource; items: SourceCatalogItem[]; onClose: () => void; onDone: () => void;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const [categories, setCategories] = useState<Category[]>([]);
  const [margin, setMargin] = useState(String(Math.max(source.min_margin_pct, 30)));
  const [status, setStatus] = useState<"draft" | "active">("draft");
  const [warranty, setWarranty] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>(() => items.map((it) => ({
    external_id: it.external_id, category_id: 0, title: cleanTitle(it.name), variant_name: t("defaultVariant"),
    price: suggestPrice(it.cost_price, Math.max(source.min_margin_pct, 30)), cost_price: it.cost_price, name: it.name,
  })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ ok: number; titles: string[] } | null>(null);

  useEffect(() => { api.categories().then(setCategories).catch(() => setCategories([])); }, []);

  const categoryOptions = useMemo(() => {
    // GET /categories trả cây (children lồng nhau) — làm phẳng kèm thụt đầu dòng.
    const out: { id: number; label: string }[] = [];
    const walk = (list: Category[], depth: number) => {
      for (const c of [...list].sort((a, b) => a.sort_order - b.sort_order)) {
        out.push({ id: c.id, label: `${"— ".repeat(depth)}${c.name}` });
        if (c.children?.length) walk(c.children, depth + 1);
      }
    };
    walk(categories, 0);
    return out;
  }, [categories]);

  const applyMargin = () => {
    const m = Number(margin) || 0;
    setDrafts((ds) => ds.map((d) => ({ ...d, price: suggestPrice(d.cost_price, m) })));
  };
  const setAllCategory = (id: number) => setDrafts((ds) => ds.map((d) => ({ ...d, category_id: id })));
  const update = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = async () => {
    if (drafts.some((d) => !d.category_id)) { setError(t("needCategory")); return; }
    setSaving(true);
    setError("");
    try {
      const created = await api.sources.import(area, source.id, drafts.map((d) => ({
        external_id: d.external_id, category_id: d.category_id, title: d.title, variant_name: d.variant_name,
        price: d.price, status, warranty_text: warranty || undefined,
      })), area === "admin" ? source.seller_id : undefined);
      setResult({ ok: created.length, titles: created.map((c) => c.product_title) });
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) (result ? onDone : onClose)(); }}>
      <DialogContent className="max-w-3xl border-line bg-surface p-5 text-fg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold">{t("importTitle", { n: items.length })}</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-2 text-[13px]">
            <p className="text-good font-medium">{t("importDone", { n: result.ok })}</p>
            <ul className="list-disc pl-5 text-muted">{result.titles.map((x, i) => <li key={i}>{x}</li>)}</ul>
            <p className="text-[12px] text-faint">{status === "draft" ? t("importDraftHint") : t("importActiveHint")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={t("marginPct")}>
                <div className="flex gap-1">
                  <Input id="imp-margin" type="number" min={0} className="h-9 font-mono" value={margin} onChange={(e) => setMargin(e.target.value)} />
                  <Button size="sm" variant="secondary" type="button" onClick={applyMargin}>{t("apply")}</Button>
                </div>
              </Field>
              <Field label={t("categoryAll")}>
                <Select id="imp-cat-all" className="h-9" defaultValue="" onChange={(e) => setAllCategory(Number(e.target.value))}>
                  <option value="">{t("choose")}</option>
                  {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </Field>
              <Field label={t("statusAfterImport")}>
                <Select id="imp-status" className="h-9" value={status} onChange={(e) => setStatus(e.target.value as "draft" | "active")}>
                  <option value="draft">{t("statusDraft")}</option>
                  <option value="active">{t("statusActive")}</option>
                </Select>
              </Field>
              <Field label={t("warranty")}>
                <Input id="imp-warranty" className="h-9" value={warranty} onChange={(e) => setWarranty(e.target.value)} placeholder={t("warrantyPlaceholder")} />
              </Field>
            </div>
            <p className="text-[12px] text-faint">{t("minMarginHint", { margin: source.min_margin_pct })}</p>

            <div className="space-y-3">
              {drafts.map((d, i) => {
                const marginNow = d.cost_price > 0 && d.price ? ((d.price - d.cost_price) / d.cost_price) * 100 : 0;
                const low = d.cost_price > 0 && marginNow < source.min_margin_pct;
                return (
                  <div key={d.external_id} className="rounded-lg border border-line p-3 space-y-2">
                    <p className="text-[11px] text-faint font-mono">#{d.external_id} · {d.name} · {t("cost")} {formatLedgerMoney(d.cost_price, locale)}</p>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                      <Input id={`imp-title-${i}`} value={d.title ?? ""} onChange={(e) => update(i, { title: e.target.value })} placeholder={t("titlePlaceholder")} />
                      <Select id={`imp-cat-${i}`} value={d.category_id || ""} onChange={(e) => update(i, { category_id: Number(e.target.value) })}>
                        <option value="">{t("chooseCategory")}</option>
                        {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </Select>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto] items-center">
                      <Input id={`imp-var-${i}`} value={d.variant_name ?? ""} onChange={(e) => update(i, { variant_name: e.target.value })} placeholder={t("variantPlaceholder")} />
                      <Input id={`imp-price-${i}`} type="number" min={0} step={500} className="font-mono" value={d.price ?? 0} onChange={(e) => update(i, { price: Number(e.target.value) })} />
                      <span className={cn("text-[12px] font-mono tabular-nums", low ? "text-warn" : "text-muted")}>
                        {low && <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />}{t("marginNow", { pct: marginNow.toFixed(0) })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}
          </div>
        )}
        <DialogFooter className="mt-2 flex-row justify-end gap-2">
          {result ? (
            <Button size="sm" onClick={onDone}>{t("close")}</Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>{t("cancel")}</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? t("importing") : t("importN", { n: drafts.length })}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Listings                                                            */
/* ------------------------------------------------------------------ */

function ListingsTable({ area, source, refreshKey, onChanged }: {
  area: SourceArea; source: SupplierSource; refreshKey: number; onChanged: () => void;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const [rows, setRows] = useState<SourceListing[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Record<number, string>>({});
  const [margin, setMargin] = useState(String(Math.max(source.min_margin_pct, 30)));
  const [busy, setBusy] = useState(false);
  const [confirmDetach, setConfirmDetach] = useState<SourceListing | null>(null);
  const productBase = area === "admin" ? "/admin/products" : "/seller/products";

  const load = useCallback(async () => {
    try {
      setRows(await api.sources.listings(area, source.id));
      setError("");
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [area, source.id, apiErrorMessage]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const savePrice = async (row: SourceListing) => {
    const raw = editing[row.listing_id];
    if (raw === undefined) return;
    const price = Number(raw);
    setEditing((e) => { const n = { ...e }; delete n[row.listing_id]; return n; });
    if (!Number.isFinite(price) || price === row.price) return;
    try {
      const updated = await api.sources.updateListing(area, row.listing_id, { price });
      setRows((rs) => rs?.map((r) => (r.listing_id === row.listing_id ? updated : r)) ?? null);
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const toggleActive = async (row: SourceListing) => {
    try {
      const updated = await api.sources.updateListing(area, row.listing_id, { is_active: !row.variant_active });
      setRows((rs) => rs?.map((r) => (r.listing_id === row.listing_id ? updated : r)) ?? null);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const reprice = async (onlyBelowMin: boolean) => {
    setBusy(true);
    try {
      const r = await api.sources.reprice(area, source.id, { margin_pct: Number(margin) || 0, only_below_min: onlyBelowMin });
      setError("");
      await load();
      onChanged();
      setRepriceMsg(t("repriced", { n: r.changed.length }));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const [repriceMsg, setRepriceMsg] = useState("");

  const detach = async () => {
    if (!confirmDetach) return;
    setBusy(true);
    try {
      await api.sources.detach(area, confirmDetach.listing_id);
      setConfirmDetach(null);
      await load();
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const lowCount = rows?.filter((r) => !r.margin_ok).length ?? 0;
  const errCount = rows?.filter((r) => r.sync_error).length ?? 0;

  return (
    <div className="space-y-3">
      <Card className="p-3 flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">{t("bulkMargin")}</span>
        <Input id="lst-margin" type="number" min={0} className="h-9 w-24 font-mono" value={margin} onChange={(e) => setMargin(e.target.value)} />
        <span className="text-[13px] text-muted">%</span>
        <Button size="sm" variant="secondary" disabled={busy || !rows?.length} onClick={() => reprice(false)}>{t("applyAll")}</Button>
        <Button size="sm" variant="secondary" disabled={busy || lowCount === 0} onClick={() => reprice(true)}>{t("applyBelowMin", { n: lowCount })}</Button>
        {repriceMsg && <span className="text-[12.5px] text-muted">{repriceMsg}</span>}
        <span className="flex-1" />
        {errCount > 0 && <Tag tone="warn"><AlertTriangle className="h-3 w-3" />{t("syncErrors", { n: errCount })}</Tag>}
      </Card>
      {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-[13px]">
          <thead className="bg-surface text-[11px] uppercase tracking-wider text-faint">
            <tr>
              <th className="p-2 text-left">{t("product")}</th>
              <th className="p-2 text-left">{t("sku")}</th>
              <th className="p-2 text-right">{t("cost")}</th>
              <th className="p-2 text-right">{t("price")}</th>
              <th className="p-2 text-right">{t("margin")}</th>
              <th className="p-2 text-right">{t("stock")}</th>
              <th className="p-2 text-left">{t("sync")}</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={8} className="p-6 text-center"><Spinner /></td></tr>}
            {rows?.map((r) => (
              <tr key={r.listing_id} className={cn("border-t border-line", !r.variant_active && "opacity-60")}>
                <td className="p-2 align-top">
                  <Link href={`${productBase}/${r.public_key}`} className="text-fg hover:text-iris">{r.product_title}</Link>
                  <div className="text-[11px] text-faint">
                    {r.variant_name} · <Tag tone={r.product_status === "active" ? "good" : "neutral"}>{r.product_status}</Tag>
                    {!r.variant_active && <Tag tone="neutral" className="ml-1">{t("variantOff")}</Tag>}
                  </div>
                </td>
                <td className="p-2 align-top max-w-[260px]">
                  <div className="text-[12px] text-muted truncate" title={r.external_name ?? ""}>{r.external_name ?? "—"}</div>
                  <div className="text-[11px] font-mono text-faint">#{r.external_id}</div>
                </td>
                <td className="p-2 align-top text-right font-mono tabular-nums">{formatLedgerMoney(r.cost_price, locale)}</td>
                <td className="p-2 align-top text-right">
                  <input
                    id={`lst-price-${r.listing_id}`}
                    className="h-8 w-28 rounded-md border border-line bg-surface px-2 text-right font-mono text-[13px] tabular-nums focus:border-iris"
                    type="number" min={0} step={500}
                    value={editing[r.listing_id] ?? r.price}
                    onChange={(e) => setEditing((s) => ({ ...s, [r.listing_id]: e.target.value }))}
                    onBlur={() => savePrice(r)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  />
                </td>
                <td className={cn("p-2 align-top text-right font-mono tabular-nums", r.margin_ok ? "text-good" : "text-warn")}>
                  {r.margin_pct == null ? "—" : `${r.margin_pct}%`}
                  {!r.margin_ok && <AlertTriangle className="inline h-3.5 w-3.5 ml-1" />}
                </td>
                <td className={cn("p-2 align-top text-right font-mono tabular-nums", r.sellable === 0 ? "text-bad" : r.sellable < 50 ? "text-warn" : "text-good")}>{r.sellable.toLocaleString()}</td>
                <td className="p-2 align-top text-[12px]">
                  {r.sync_error
                    ? <Tag tone={r.sync_error === "delisted" ? "bad" : "warn"}>{r.sync_error === "delisted" ? t("delisted") : r.sync_error}</Tag>
                    : <span className="text-faint">{r.synced_at ? new Date(r.synced_at).toLocaleTimeString(locale) : "—"}</span>}
                </td>
                <td className="p-2 align-top text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(r)}>{r.variant_active ? t("pause") : t("resume")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDetach(r)} aria-label={t("detach")}><Trash className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted">{t("noListings")}</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={confirmDetach !== null} onOpenChange={(o) => { if (!o && !busy) setConfirmDetach(null); }}>
        <DialogContent className="max-w-sm border-line bg-surface p-5 text-fg">
          <DialogHeader><DialogTitle className="text-[15px] font-bold">{t("detachTitle")}</DialogTitle></DialogHeader>
          <p className="text-[12.5px] text-muted">{t("detachBody", { name: confirmDetach?.product_title ?? "" })}</p>
          <DialogFooter className="mt-2 flex-row justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDetach(null)} disabled={busy}>{t("cancel")}</Button>
            <Button size="sm" variant="danger" onClick={detach} disabled={busy}>{t("detach")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
