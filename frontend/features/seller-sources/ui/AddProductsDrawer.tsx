"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { Category, SourceArea, SourceCatalogItem, SourceCatalogPage, SourceImportItem, SupplierSource } from "@/lib/types";
import { Button, Input, Select, Spinner, Switch, Tag } from "@/components/ui";
import { AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, Search, X } from "@/components/Icons";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  autoGroup, marginOf, pruneEmpty, suggestPrice, type DraftProduct, type DraftVariant, type GroupMode,
  sourceRef,
} from "../logic";

export type ExistingProduct = { product_id: number; product_title: string; variant_count: number };

/** Drawer bên phải, 2 bước: (1) tick SKU với một ô lãi %, (2) xếp SKU vào
 *  sản phẩm (tự gộp theo nhóm / mỗi SKU một sản phẩm / tất cả vào một). */
export function AddProductsDrawer({ area, source, existing, presetProductId, onClose, onDone }: {
  area: SourceArea; source: SupplierSource; existing: ExistingProduct[];
  /** mở từ nút "+ Phân loại" của một sản phẩm: mọi SKU mặc định vào sản phẩm đó */
  presetProductId?: number | null;
  onClose: () => void; onDone: (created: number) => void;
}) {
  const t = useTranslations("sellerSources");
  const [step, setStep] = useState<1 | 2>(1);
  const [margin, setMargin] = useState(String(Math.max(source.min_margin_pct, 30)));
  const [selected, setSelected] = useState<Map<string, SourceCatalogItem>>(new Map());
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent
        className={cn(
          "left-auto right-0 top-0 h-full max-h-none w-full max-w-[760px] translate-x-0 translate-y-0 rounded-none border-0 border-l border-line bg-surface p-0 text-fg",
          "flex flex-col gap-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
        )}
        overlayClassName="bg-black/40"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-faint">{t("stepOf", { n: step, total: 2 })}</p>
            <DialogTitle className="text-[16px] font-bold text-fg">
              {step === 1 ? t("drawerTitle", { name: source.name }) : t("groupTitle", { n: selected.size })}
            </DialogTitle>
            <p className="text-[12.5px] text-muted">{step === 1 ? t("drawerHint") : t("groupHint")}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label={t("close")}><X className="h-4 w-4" /></Button>
        </div>

        {step === 1 ? (
          <PickStep
            area={area} source={source} margin={margin} setMargin={setMargin}
            selected={selected} setSelected={setSelected}
            onNext={() => setStep(2)}
          />
        ) : (
          <GroupStep
            area={area} source={source} items={[...selected.values()]} marginPct={Number(margin) || 0}
            existing={existing} presetProductId={presetProductId ?? null}
            saving={saving} setSaving={setSaving}
            onBack={() => setStep(1)} onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Bước 1: chọn SKU                                                    */
/* ------------------------------------------------------------------ */

function PickStep({ area, source, margin, setMargin, selected, setSelected, onNext }: {
  area: SourceArea; source: SupplierSource; margin: string; setMargin: (v: string) => void;
  selected: Map<string, SourceCatalogItem>; setSelected: (f: (m: Map<string, SourceCatalogItem>) => Map<string, SourceCatalogItem>) => void;
  onNext: () => void;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [inStock, setInStock] = useState(true);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SourceCatalogPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const marginPct = Number(margin) || 0;

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        setData(await api.sources.catalog(area, sourceRef(area, source), { q, group, in_stock: inStock, page, per_page: 40, sort: "stock" }));
        setError("");
      } catch (e) {
        setError(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [area, source.id, source.public_key, q, group, inStock, page, apiErrorMessage]);

  const toggle = (item: SourceCatalogItem) => setSelected((prev) => {
    const next = new Map(prev);
    if (next.has(item.external_id)) next.delete(item.external_id); else next.set(item.external_id, item);
    return next;
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  const topGroups = useMemo(() => (data?.groups ?? []).slice(0, 8), [data]);

  return (
    <>
      <div className="space-y-2 border-b border-line px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input id="pick-q" className="h-9 pl-8" placeholder={t("searchPlaceholder")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted" htmlFor="pick-margin">
            {t("marginPct")}
            <Input id="pick-margin" type="number" min={0} className="h-9 w-20 font-mono" value={margin} onChange={(e) => setMargin(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip on={group === ""} onClick={() => { setGroup(""); setPage(1); }}>{t("allGroups")}</Chip>
          {topGroups.map((g) => (
            <Chip key={g.name} on={group === g.name} onClick={() => { setGroup(g.name); setPage(1); }}>
              {g.name} <span className="font-mono text-[11px] opacity-70">{g.count}</span>
            </Chip>
          ))}
          {data && data.groups.length > 8 && (
            <Select id="pick-group-more" className="h-8 w-36 text-[12px]" value={group} onChange={(e) => { setGroup(e.target.value); setPage(1); }}>
              <option value="">{t("moreGroups")}</option>
              {data.groups.slice(8).map((g) => <option key={g.name} value={g.name}>{g.name} ({g.count})</option>)}
            </Select>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted">
            <input id="pick-instock" type="checkbox" checked={inStock} onChange={(e) => { setInStock(e.target.checked); setPage(1); }} />
            {t("inStockOnly")}
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="px-5 py-2 text-[13px] text-bad" role="alert">{error}</p>}
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-wider text-faint">
            <tr>
              <th className="w-9 p-2"></th>
              <th className="p-2 text-left">{t("sku")}</th>
              <th className="p-2 text-right">{t("cost")}</th>
              <th className="p-2 text-right">{t("price")}</th>
              <th className="p-2 text-right">{t("stock")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && <tr><td colSpan={5} className="p-6 text-center"><Spinner /></td></tr>}
            {data?.items.map((it) => {
              const on = selected.has(it.external_id);
              const attached = it.attached.length > 0;
              return (
                <tr key={it.external_id} onClick={() => toggle(it)} className={cn("cursor-pointer border-t border-line hover:bg-card", on && "bg-iris-soft/40")}>
                  <td className="p-2 pl-4"><input type="checkbox" checked={on} onChange={() => toggle(it)} onClick={(e) => e.stopPropagation()} aria-label={it.external_id} /></td>
                  <td className="p-2">
                    <div className="text-fg">{it.name}</div>
                    <div className="text-[11px] text-faint">
                      <span className="font-mono">#{it.external_id}</span> · {it.group_name || it.category_path[0]}
                      {attached && <Tag tone="iris" className="ml-1">{t("attachedN", { n: it.attached.length })}</Tag>}
                    </div>
                  </td>
                  <td className="p-2 text-right font-mono tabular-nums text-muted">{formatLedgerMoney(it.cost_price, locale)}</td>
                  <td className="p-2 text-right font-mono tabular-nums text-fg">{formatLedgerMoney(suggestPrice(it.cost_price, marginPct), locale)}</td>
                  <td className="p-2 pr-4 text-right font-mono tabular-nums">
                    {it.amount === 0 ? <Tag tone="bad">{t("outOfStock")}</Tag> : <span className={it.amount < 50 ? "text-warn" : "text-good"}>{it.amount.toLocaleString()}</span>}
                  </td>
                </tr>
              );
            })}
            {data && data.items.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">{data.total === 0 && !q && !group ? t("noCatalog") : t("noMatch")}</td></tr>}
          </tbody>
        </table>
        {data && totalPages > 1 && (
          <div className="flex items-center gap-2 px-5 py-2 text-[12px] text-muted">
            <span>{t("pageInfo", { shown: data.items.length, total: data.total })}</span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="font-mono">{page}/{totalPages}</span>
            <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line bg-card px-5 py-3">
        <span className="text-[13px] text-muted">
          {selected.size > 0 ? t("selectedN", { n: selected.size }) : t("pickHint")}
          {selected.size > 0 && <Button size="sm" variant="ghost" className="ml-1" onClick={() => setSelected(() => new Map())}>{t("clear")}</Button>}
        </span>
        <Button size="sm" disabled={selected.size === 0} onClick={onNext}>{t("nextGroup")}<ArrowRight className="h-3.5 w-3.5" /></Button>
      </div>
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[12.5px] font-medium", on ? "border-fg bg-fg text-card" : "border-line bg-card text-muted hover:text-fg")}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Bước 2: xếp SKU vào sản phẩm                                        */
/* ------------------------------------------------------------------ */

function GroupStep({ area, source, items, marginPct, existing, presetProductId, saving, setSaving, onBack, onDone }: {
  area: SourceArea; source: SupplierSource; items: SourceCatalogItem[]; marginPct: number;
  existing: ExistingProduct[]; presetProductId: number | null;
  saving: boolean; setSaving: (v: boolean) => void; onBack: () => void; onDone: (created: number) => void;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const [mode, setMode] = useState<GroupMode>(presetProductId ? "one" : "auto");
  const [products, setProducts] = useState<DraftProduct[]>([]);
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activate, setActivate] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { api.categories().then(setCategories).catch(() => setCategories([])); }, []);

  // Gợi ý gộp lại mỗi khi đổi chế độ; giá/tên đã sửa được giữ.
  useEffect(() => {
    setVariants((prev) => {
      const g = autoGroup(items, mode, marginPct, prev);
      const vs = presetProductId ? g.variants.map((v) => ({ ...v, target: `existing:${presetProductId}` })) : g.variants;
      setProducts(pruneEmpty(g.products, vs));
      return vs;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const categoryOptions = useMemo(() => {
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

  // Đoán danh mục theo tên nhóm (Facebook → danh mục "Facebook") cho sản phẩm mới.
  useEffect(() => {
    if (!categoryOptions.length) return;
    setProducts((ps) => ps.map((p) => {
      if (p.category_id) return p;
      const hit = categoryOptions.find((c) => c.label.replace(/^(— )+/, "").toLowerCase() === p.group.toLowerCase());
      return hit ? { ...p, category_id: hit.id } : p;
    }));
  }, [categoryOptions, products.length]);

  const updateVariant = (id: string, patch: Partial<DraftVariant>) =>
    setVariants((vs) => vs.map((v) => (v.external_id === id ? { ...v, ...patch } : v)));
  const updateProduct = (key: string, patch: Partial<DraftProduct>) =>
    setProducts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const moveTo = (id: string, target: string) => {
    let nextProducts = products;
    if (target === "new:__split") {
      const v = variants.find((x) => x.external_id === id);
      const key = `new:${Date.now()}`;
      nextProducts = [...products, { key, title: v ? v.variant_name : "", category_id: 0, group: v?.group ?? "" }];
      target = key;
    }
    const nextVariants = variants.map((v) => (v.external_id === id ? { ...v, target } : v));
    setVariants(nextVariants);
    setProducts(pruneEmpty(nextProducts, nextVariants));
  };

  const targets = useMemo(() => {
    const out: { key: string; label: string; isNew: boolean; rows: DraftVariant[] }[] = [];
    for (const p of products) out.push({ key: p.key, label: p.title, isNew: true, rows: variants.filter((v) => v.target === p.key) });
    for (const e of existing) {
      const rows = variants.filter((v) => v.target === `existing:${e.product_id}`);
      if (rows.length) out.push({ key: `existing:${e.product_id}`, label: e.product_title, isNew: false, rows });
    }
    return out;
  }, [products, variants, existing]);

  const newCount = products.length;
  const attachCount = variants.filter((v) => v.target.startsWith("existing:")).length;
  const missingCategory = products.some((p) => !p.category_id);

  const save = async () => {
    if (missingCategory) { setError(t("needCategory")); return; }
    setSaving(true);
    setError("");
    try {
      const payload: SourceImportItem[] = variants.map((v) => {
        const isNew = v.target.startsWith("new:");
        const p = isNew ? products.find((x) => x.key === v.target) : undefined;
        return {
          external_id: v.external_id, category_id: p?.category_id ?? 0, title: p?.title,
          variant_name: v.variant_name, price: v.price, status: activate ? "active" : "draft",
          product_id: isNew ? null : Number(v.target.slice("existing:".length)),
          group_key: isNew ? v.target : null,
        };
      });
      const created = await api.sources.import(area, sourceRef(area, source), payload, area === "admin" ? source.seller_id : undefined);
      onDone(created.length);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-3">
        <Chip on={mode === "auto"} onClick={() => setMode("auto")}>{t("modeAuto")}</Chip>
        <Chip on={mode === "single"} onClick={() => setMode("single")}>{t("modeSingle")}</Chip>
        <Chip on={mode === "one"} onClick={() => setMode("one")}>{t("modeOne")}</Chip>
        <span className="ml-auto text-[12px] text-muted">{t("groupSummary", { products: newCount, attach: attachCount })}</span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-raised/40 px-5 py-4">
        {targets.map((tg) => {
          const p = products.find((x) => x.key === tg.key);
          return (
            <div key={tg.key} className="overflow-hidden rounded-lg border border-line bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
                {p ? (
                  <>
                    <Input id={`grp-title-${tg.key}`} className="h-8 w-[260px] font-semibold" value={p.title} onChange={(e) => updateProduct(p.key, { title: e.target.value })} placeholder={t("titlePlaceholder")} />
                    <Select id={`grp-cat-${tg.key}`} className={cn("h-8 w-[200px] text-[12.5px]", !p.category_id && "border-warn")} value={p.category_id || ""} onChange={(e) => updateProduct(p.key, { category_id: Number(e.target.value) })}>
                      <option value="">{t("chooseCategory")}</option>
                      {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </Select>
                    <Tag tone="iris">{t("newProduct")}</Tag>
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-fg">{tg.label}</span>
                    <Tag tone="good">{t("existingProduct")}</Tag>
                  </>
                )}
                <span className="ml-auto text-[11.5px] text-faint">{t("variantsN", { n: tg.rows.length })}</span>
              </div>
              <div className="divide-y divide-line">
                {tg.rows.map((v) => {
                  const m = marginOf(v.price, v.cost_price);
                  const low = m !== null && m < source.min_margin_pct;
                  return (
                    <div key={v.external_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <Input id={`grp-var-${v.external_id}`} className="h-8 min-w-[160px] flex-1 text-[13px]" value={v.variant_name} onChange={(e) => updateVariant(v.external_id, { variant_name: e.target.value })} placeholder={t("variantPlaceholder")} />
                      <span className="w-[72px] text-right font-mono text-[12px] tabular-nums text-faint" title={t("cost")}>{formatLedgerMoney(v.cost_price, locale)}</span>
                      <Input id={`grp-price-${v.external_id}`} type="number" min={0} step={500} className={cn("h-8 w-24 text-right font-mono", low && "border-warn")} value={v.price} onChange={(e) => updateVariant(v.external_id, { price: Number(e.target.value) })} />
                      <span className={cn("w-12 text-right font-mono text-[11.5px] tabular-nums", low ? "text-warn" : "text-muted")}>
                        {low && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}{m === null ? "—" : `${m.toFixed(0)}%`}
                      </span>
                      <Select id={`grp-move-${v.external_id}`} className="h-8 w-[150px] text-[12px]" value={v.target} onChange={(e) => moveTo(v.external_id, e.target.value)} aria-label={t("moveTo")}>
                        {products.map((p2) => <option key={p2.key} value={p2.key}>{t("intoNew", { title: p2.title || "…" })}</option>)}
                        {existing.map((e) => <option key={e.product_id} value={`existing:${e.product_id}`}>{t("intoExisting", { title: e.product_title })}</option>)}
                        <option value="new:__split">{t("splitNew")}</option>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <p className="text-[12px] text-faint">{t("minMarginHint", { margin: source.min_margin_pct })}</p>
        {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-card px-5 py-3">
        <Button size="sm" variant="ghost" onClick={onBack} disabled={saving}><ChevronLeft className="h-4 w-4" />{t("backPick")}</Button>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <Switch checked={activate} onChange={setActivate} label={t("activateNow")} />{t("activateNow")}
          </label>
          <Button size="sm" onClick={save} disabled={saving || variants.length === 0}>
            {saving ? t("importing") : t("createSummary", { products: newCount, attach: attachCount })}<ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </>
  );
}
