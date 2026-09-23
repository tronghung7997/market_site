"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { Category, SourceArea, SourceCatalogItem, SourceCatalogPage, SourceImportItem, SourceListing, SupplierSource } from "@/lib/types";
import { Banner, Button, Input, Pagination, Select, Switch, Tag } from "@/components/ui";
import { AlertTriangle, Check, Info, Search } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { existingProducts, marginOf, planPlacement, sourceRef, suggestPrice, type DraftProduct, type DraftVariant } from "../logic";
import { FilterChip } from "./shared";

const PER_PAGE = 30;

/** Thêm hàng: tick mặt hàng của nguồn bên trái, bên phải thấy ngay mỗi mặt
 *  hàng sẽ thành phân loại của sản phẩm nào. Nhóm đã có sản phẩm → vào sản
 *  phẩm đó (bán ngay); nhóm mới → sản phẩm mới lưu nháp. */
export function CatalogTab({ area, source, listings, onImported }: {
  area: SourceArea; source: SupplierSource; listings: SourceListing[]; onImported: (n: number) => Promise<void>;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const money = (n: number) => formatLedgerMoney(n, locale);
  const rule = { markup_pct: source.markup_pct, round_to: source.round_to };

  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [inStock, setInStock] = useState(true);
  const [hideSelling, setHideSelling] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SourceCatalogPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Map<string, SourceCatalogItem>>(new Map());
  const [plan, setPlan] = useState<{ products: DraftProduct[]; variants: DraftVariant[] }>({ products: [], variants: [] });
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const existing = useMemo(() => existingProducts(listings), [listings]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        setData(await api.sources.catalog(area, sourceRef(area, source), { q, group, in_stock: inStock, page, per_page: PER_PAGE, sort: "stock" }));
        setError("");
      } catch (e) {
        setError(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [area, source.id, source.public_key, q, group, inStock, page, apiErrorMessage]);

  useEffect(() => { api.categories().then(setCategories).catch(() => setCategories([])); }, []);

  const categoryOptions = useMemo(() => {
    const out: { id: number; label: string; name: string }[] = [];
    const walk = (list: Category[], depth: number) => {
      for (const c of [...list].sort((a, b) => a.sort_order - b.sort_order)) {
        out.push({ id: c.id, label: `${"— ".repeat(depth)}${c.name}`, name: c.name });
        if (c.children?.length) walk(c.children, depth + 1);
      }
    };
    walk(categories, 0);
    return out;
  }, [categories]);

  // Kế hoạch xếp chỗ tính lại mỗi khi chọn thêm/bớt; sửa tay được giữ.
  useEffect(() => {
    setPlan((prev) => {
      const next = planPlacement([...selected.values()], existing, rule, prev);
      next.products = next.products.map((p) => {
        if (p.category_id) return p;
        const hit = categoryOptions.find((c) => c.name.toLowerCase() === p.group.toLowerCase());
        return hit ? { ...p, category_id: hit.id } : p;
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, existing, categoryOptions, source.markup_pct, source.round_to]);

  const toggle = (item: SourceCatalogItem) => setSelected((prev) => {
    const next = new Map(prev);
    if (next.has(item.external_id)) next.delete(item.external_id); else next.set(item.external_id, item);
    return next;
  });

  const updateVariant = (id: string, patch: Partial<DraftVariant>) =>
    setPlan((p) => ({ ...p, variants: p.variants.map((v) => (v.external_id === id ? { ...v, ...patch } : v)) }));
  const updateProduct = (key: string, patch: Partial<DraftProduct>) =>
    setPlan((p) => ({ ...p, products: p.products.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const moveVariant = (id: string, target: string) => {
    setPlan((p) => {
      const variants = p.variants.map((v) => (v.external_id === id ? { ...v, target } : v));
      const products = [...p.products];
      if (target.startsWith("new:") && !products.some((x) => x.key === target)) {
        const v = variants.find((x) => x.external_id === id);
        products.push({ key: target, title: v?.variant_name ?? "", category_id: 0, group: v?.group ?? "" });
      }
      return { products: products.filter((x) => variants.some((v) => v.target === x.key)), variants };
    });
  };

  const visibleItems = (data?.items ?? []).filter((it) => !(hideSelling && it.attached.length > 0));
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  const missingCategory = plan.products.some((p) => !p.category_id);
  const intoExisting = plan.variants.filter((v) => v.target.startsWith("existing:")).length;

  const targets = [
    ...plan.products.map((p) => ({ key: p.key, title: p.title, isNew: true, product: p as DraftProduct | null, existing: null as (typeof existing)[number] | null })),
    ...existing
      .filter((e) => plan.variants.some((v) => v.target === `existing:${e.product_id}`))
      .map((e) => ({ key: `existing:${e.product_id}`, title: e.product_title, isNew: false, product: null, existing: e })),
  ];

  const save = async () => {
    if (missingCategory) { setSaveError(t("catalog.needCategory")); return; }
    setSaving(true);
    setSaveError("");
    try {
      const items: SourceImportItem[] = plan.variants.map((v) => {
        const isNew = v.target.startsWith("new:");
        const p = isNew ? plan.products.find((x) => x.key === v.target) : undefined;
        return {
          external_id: v.external_id, category_id: p?.category_id ?? 0, title: p?.title,
          variant_name: v.variant_name, price: v.price, status: "draft",
          product_id: isNew ? null : Number(v.target.slice("existing:".length)),
          group_key: isNew ? v.target : null,
        };
      });
      const created = await api.sources.import(area, sourceRef(area, source), items, area === "admin" ? source.seller_id : undefined);
      setSelected(new Map());
      setPlan({ products: [], variants: [] });
      await onImported(created.length);
    } catch (e) {
      setSaveError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const groups = data?.groups ?? [];
  const topGroups = groups.slice(0, 7);

  return (
    <div className="grid grid-cols-1 items-start gap-5 pt-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-3">
        {area === "admin" && !source.seller_id && (
          <Banner tone="warn" icon={<AlertTriangle size={15} />}>{t("catalog.noStore")}</Banner>
        )}
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            id="cat-q" aria-label={t("catalog.search")} className="h-10 pl-8"
            placeholder={t("catalog.searchIn", { n: source.catalog_count.toLocaleString(locale) })}
            value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip on={group === ""} onClick={() => { setGroup(""); setPage(1); }}>{t("catalog.allGroups")}</FilterChip>
          {topGroups.map((g) => (
            <FilterChip key={g.name} on={group === g.name} count={g.count.toLocaleString(locale)} onClick={() => { setGroup(g.name); setPage(1); }}>{g.name || t("catalog.otherGroup")}</FilterChip>
          ))}
          {groups.length > topGroups.length && (
            <Select id="cat-group-more" aria-label={t("catalog.moreGroups")} className="h-8 w-40 text-[12.5px]" value={topGroups.some((g) => g.name === group) ? "" : group}
              onChange={(e) => { setGroup(e.target.value); setPage(1); }}>
              <option value="">{t("catalog.moreGroups")}</option>
              {groups.slice(topGroups.length).map((g) => <option key={g.name} value={g.name}>{g.name || t("catalog.otherGroup")} ({g.count})</option>)}
            </Select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-5 text-[13px] text-muted">
          <span className="flex items-center gap-2"><Switch checked={inStock} onChange={(v) => { setInStock(v); setPage(1); }} label={t("catalog.inStockOnly")} />{t("catalog.inStockOnly")}</span>
          <span className="flex items-center gap-2"><Switch checked={hideSelling} onChange={setHideSelling} label={t("catalog.hideSelling")} />{t("catalog.hideSelling")}</span>
        </div>

        {error && <Banner tone="bad" icon={<AlertTriangle size={15} />}>{error}</Banner>}

        <div role="region" aria-label={t("catalog.tableLabel")} tabIndex={0} className={cn("relative overflow-x-auto rounded-card border border-line bg-card", loading && data && "opacity-70")}>
          <table className="w-full min-w-[620px] text-[13px]">
            <thead className="bg-raised text-left text-[12px] text-muted">
              <tr>
                <th scope="col" className="w-10 px-3 py-2.5"><span className="sr-only">{t("catalog.pick")}</span></th>
                <th scope="col" className="px-2 py-2.5 font-medium">{t("catalog.item")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("col.cost")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("catalog.rulePrice")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("col.stock")}</th>
              </tr>
            </thead>
            <tbody>
              {!data && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">{t("loading")}</td></tr>}
              {visibleItems.map((it) => {
                const on = selected.has(it.external_id);
                const selling = it.attached.length > 0;
                const price = suggestPrice(it.cost_price, source.markup_pct, source.round_to);
                return (
                  <tr key={it.external_id} className={cn("border-t border-line", on && "bg-iris-soft")}>
                    <td className="px-3 py-2.5 align-top">
                      <input
                        id={`cat-${it.external_id}`} type="checkbox" className="mt-0.5 h-4 w-4 accent-iris" checked={on} onChange={() => toggle(it)}
                        aria-label={t("catalog.pickItem", { name: it.name })}
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <label htmlFor={`cat-${it.external_id}`} className="block cursor-pointer">
                        <span className="block text-fg">{it.name}</span>
                        <span className="block text-[11.5px] text-muted">
                          <span className="font-mono">#{it.external_id}</span> · {it.group_name || it.category_path[0]}
                        </span>
                        {selling && (
                          <span className="mt-0.5 block text-[12px] font-medium text-good">
                            {t("catalog.sellingIn", { product: it.attached[0].product_title })}
                          </span>
                        )}
                      </label>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">{money(it.cost_price)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-fg">{money(price)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {it.amount === 0 ? <Tag tone="bad">{t("catalog.outOfStock")}</Tag> : <span className={it.amount < 50 ? "text-warn" : "text-fg"}>{it.amount.toLocaleString(locale)}</span>}
                    </td>
                  </tr>
                );
              })}
              {data && visibleItems.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">{data.total === 0 && !q && !group ? t("catalog.empty") : t("noMatch")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
            <span>{t("catalog.pageInfo", { from: (page - 1) * PER_PAGE + (data.items.length ? 1 : 0), to: (page - 1) * PER_PAGE + data.items.length, total: data.total.toLocaleString(locale) })}</span>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        )}
      </div>

      <aside aria-labelledby="cat-plan" className="rounded-card border border-line bg-card lg:sticky lg:top-4">
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="cat-plan" className="text-[15px] font-semibold text-fg">
              {plan.variants.length > 0 ? t("catalog.planTitle", { n: plan.variants.length }) : t("catalog.planEmptyTitle")}
            </h2>
            {plan.variants.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>{t("catalog.clear")}</Button>}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted">{plan.variants.length > 0 ? t("catalog.planHint") : t("catalog.planEmptyHint")}</p>
        </div>

        {targets.length > 0 && (
          <div className="max-h-[60dvh] space-y-3 overflow-y-auto p-4">
            {targets.map((tg) => {
              const rows = plan.variants.filter((v) => v.target === tg.key);
              return (
                <div key={tg.key} className="space-y-2.5 rounded-lg border border-line bg-raised p-3">
                  {tg.isNew && tg.product ? (
                    <>
                      <Tag tone="iris">{t("catalog.newProduct")}</Tag>
                      <label className="block space-y-1">
                        <span className="text-[12px] font-medium text-muted">{t("catalog.productTitle")}</span>
                        <Input id={`plan-title-${tg.key}`} value={tg.product.title} onChange={(e) => updateProduct(tg.key, { title: e.target.value })} />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[12px] font-medium text-muted">{t("catalog.category")}</span>
                        <Select id={`plan-cat-${tg.key}`} aria-invalid={!tg.product.category_id} className={cn(!tg.product.category_id && "border-warn")}
                          value={tg.product.category_id || ""} onChange={(e) => updateProduct(tg.key, { category_id: Number(e.target.value) })}>
                          <option value="">{t("catalog.chooseCategory")}</option>
                          {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </Select>
                      </label>
                    </>
                  ) : (
                    <>
                      <Tag tone="good">{t("catalog.existingProduct")}</Tag>
                      <p className="text-[14px] font-semibold text-fg">{tg.title}</p>
                      {tg.existing && tg.existing.variant_names.length > 0 && (
                        <p className="text-[12px] text-muted">{t("catalog.alreadyHas", { names: tg.existing.variant_names.join(" · ") })}</p>
                      )}
                    </>
                  )}
                  {rows.map((v) => {
                    const m = marginOf(v.price, v.cost_price);
                    const low = m !== null && m < source.min_margin_pct;
                    return (
                      <div key={v.external_id} className="space-y-2 rounded-lg border border-iris/30 bg-card p-2.5">
                        <div className="flex items-center gap-2">
                          <Input id={`plan-var-${v.external_id}`} aria-label={t("catalog.variantName")} className="h-8 min-w-0 flex-1 text-[13px]"
                            value={v.variant_name} onChange={(e) => updateVariant(v.external_id, { variant_name: e.target.value })} />
                          <Input id={`plan-price-${v.external_id}`} aria-label={t("catalog.priceFor", { name: v.variant_name })} type="number" min={0} step={1}
                            className={cn("h-8 w-24 text-right font-mono", low && "border-warn")}
                            value={v.price} onChange={(e) => updateVariant(v.external_id, { price: Number(e.target.value) })} />
                        </div>
                        <p className={cn("font-mono text-[11.5px]", low ? "text-warn" : "text-muted")}>
                          {t("catalog.costProfit", { cost: money(v.cost_price), pct: m === null ? "—" : Math.round(m) })}
                        </p>
                        <label className="flex items-center gap-2 text-[12px] text-muted">
                          <span className="shrink-0">{t("catalog.moveTo")}</span>
                          <Select id={`plan-move-${v.external_id}`} className="h-8 min-w-0 flex-1 text-[12.5px]"
                            value={v.target} onChange={(e) => moveVariant(v.external_id, e.target.value === "__split" ? `new:${v.external_id}` : e.target.value)}>
                            {plan.products.map((p) => <option key={p.key} value={p.key}>{t("catalog.intoNew", { title: p.title || "…" })}</option>)}
                            {existing.map((e) => <option key={e.product_id} value={`existing:${e.product_id}`}>{t("catalog.intoExisting", { title: e.product_title })}</option>)}
                            <option value="__split">{t("catalog.split")}</option>
                          </Select>
                        </label>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {plan.variants.length > 0 && (
          <div className="space-y-3 border-t border-line bg-raised px-4 py-3">
            <p className="flex items-start gap-2 text-[12.5px] leading-snug text-muted">
              <Info size={15} className="mt-0.5 shrink-0" />
              {t("catalog.saveNote", { existing: intoExisting, fresh: plan.products.length })}
            </p>
            {saveError && <p role="alert" className="text-[12.5px] text-bad">{saveError}</p>}
            <Button block onClick={save} disabled={saving || (area === "admin" && !source.seller_id)}>
              <Check size={15} />{saving ? t("catalog.saving") : t("catalog.save", { n: plan.variants.length })}
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}
