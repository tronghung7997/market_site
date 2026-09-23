"use client";

/** Workspace cho NGUỒN PROXY (TopProxy / DProxy) trong /admin/sources và
 *  /seller/sources. Khác nguồn catalog: không có tồn kho và phân loại — một
 *  "gói đang bán" là một key `type|network|days` trong pricing config của sản
 *  phẩm, nối tới một gói thượng nguồn trong catalog đã đồng bộ. Đổi nhà cung
 *  cấp = thêm nguồn mới rồi nhập lại gói cho cùng sản phẩm. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { sellerProductPath } from "@/lib/routes";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { Category, SourceArea, SourceCatalogItem, SourceOffer, SourcePlanImportItem, SourceSellerCandidate, SupplierSource } from "@/lib/types";
import { Button, Input, Select, Spinner, Tag } from "@/components/ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ChevronLeft, Plus, RefreshCw, Search, Trash, X } from "@/components/Icons";
import { relTime } from "./shared";
import { sourceRef } from "../logic";

const PROTOCOLS = ["HTTP", "SOCKS5"];
const DPROXY_TYPES = ["residential", "datacenter", "mobile"];

function suggestPrice(cost: number | null, marginPct: number, roundTo = 1000): number {
  if (!cost || cost <= 0) return 0;
  return Math.ceil((cost * (1 + marginPct / 100)) / roundTo) * roundTo;
}

export function ProxySourceWorkspace({ area, source, onSourceChange }: { area: SourceArea; source: SupplierSource; onSourceChange: () => Promise<void> }) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const params = useSearchParams();
  const base = area === "admin" ? "/admin/sources" : "/seller/sources";
  // Admin pages may carry row ids; the seller surface uses the product's public key.
  const productHref = (o: SourceOffer) =>
    area === "admin" ? `/admin/products/${o.product_id}` : sellerProductPath({ id: o.product_id, public_key: o.product_key });

  const [offers, setOffers] = useState<SourceOffer[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [margin, setMargin] = useState(String(Math.max(source.min_margin_pct, 30)));
  const [drawer, setDrawer] = useState(Boolean(params.get("add")));
  const [confirmRemove, setConfirmRemove] = useState<SourceOffer | null>(null);

  const load = useCallback(async () => {
    try {
      setOffers(await api.sources.offers(area, sourceRef(area, source)));
      setError("");
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [area, source.id, source.public_key, apiErrorMessage]);
  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.sources.sync(area, sourceRef(area, source));
      setNotice(r.error ? `${t("syncFailed")}: ${r.error}` : t("plansSynced", { n: r.catalog_items }));
      await onSourceChange();
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  const key = (o: SourceOffer) => `${o.product_id}:${o.plan_key}`;
  const savePrice = async (o: SourceOffer) => {
    const raw = editing[key(o)];
    if (raw === undefined) return;
    const price = Number(raw);
    setEditing((e) => { const n = { ...e }; delete n[key(o)]; return n; });
    if (!Number.isFinite(price) || price <= 0 || price === o.price) return;
    try {
      const updated = await api.sources.updateOffer(area, sourceRef(area, source), { product_id: o.product_id, plan_key: o.plan_key, price });
      setOffers((rows) => rows?.map((r) => (key(r) === key(updated) ? updated : r)) ?? null);
      setNotice(t("priceSaved"));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const remove = async () => {
    if (!confirmRemove) return;
    setBusy(true);
    try {
      await api.sources.removeOffer(area, sourceRef(area, source), { product_id: confirmRemove.product_id, plan_key: confirmRemove.plan_key });
      setConfirmRemove(null);
      await load();
      await onSourceChange();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reprice = async () => {
    setBusy(true);
    try {
      const r = await api.sources.repriceOffers(area, sourceRef(area, source), { margin_pct: Number(margin) || 0 });
      setNotice(t("offersRepriced", { n: r.updated, skipped: r.skipped }));
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (offers ?? []).filter((o) => !needle || `${o.product_title} ${o.label} ${o.plan_key} ${o.external_name ?? ""}`.toLowerCase().includes(needle));
  }, [offers, q]);
  const products = useMemo(() => {
    const m = new Map<number, { product_id: number; product_title: string; n: number }>();
    for (const o of offers ?? []) {
      const cur = m.get(o.product_id) ?? { product_id: o.product_id, product_title: o.product_title, n: 0 };
      cur.n += 1; m.set(o.product_id, cur);
    }
    return [...m.values()];
  }, [offers]);
  const lowCount = (offers ?? []).filter((o) => !o.margin_ok || o.unmapped || o.plan_missing).length;
  const health = (source.last_test_result as {
    health?: { status?: string; message?: string; credit?: { available_spending_usd?: number; credit_limit_usd?: number | null } | null };
  } | null)?.health;
  const credit = health?.credit;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={base} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
            <ChevronLeft className="h-3.5 w-3.5" />{area === "admin" ? t("adminTitle") : t("title")}
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 truncate text-lg font-bold text-fg">{source.name}<Tag tone="iris">{t("kindProxy")}</Tag></h1>
          <p className="text-[12.5px] text-muted">
            {t("proxyMeta", { plans: source.catalog_count, products: products.length, offers: offers?.length ?? 0, synced: relTime(source.catalog_synced_at, t) })}
            {area === "admin" && ` · ${source.seller_email ?? t("unassigned")}`}
            {credit?.available_spending_usd != null && (
              <> · <span className="font-mono tabular-nums">{t("creditLeft", { amount: credit.available_spending_usd.toFixed(2) })}</span></>
            )}
            {health?.status && (
              <> · <span className={cn(health.status === "healthy" ? "text-good" : health.status === "warning" ? "text-warn" : "text-bad")}>{health.message ?? health.status}</span></>
            )}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={sync} disabled={syncing}>
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />{syncing ? t("syncing") : t("syncPlans")}
        </Button>
        <Button size="sm" onClick={() => setDrawer(true)}><Plus className="h-3.5 w-3.5" />{t("addPlans")}</Button>
      </div>
      {notice && <p className="text-[12.5px] text-good">{notice}</p>}
      {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-[200px] sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input id="ofr-q" className="h-9 pl-8" placeholder={t("searchOffers")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {lowCount > 0 && <Tag tone="warn"><AlertTriangle className="h-3 w-3" />{t("offersAttention", { n: lowCount })}</Tag>}
        <div className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted">
          <label htmlFor="ofr-margin">{t("applyMargin")}</label>
          <Input id="ofr-margin" type="number" min={0} className="h-8 w-16 font-mono" value={margin} onChange={(e) => setMargin(e.target.value)} />
          <span>%</span>
          <Button size="sm" variant="secondary" disabled={busy || !offers?.length} onClick={reprice}>{t("applyAll")}</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-[13px]">
          <thead className="bg-surface text-[11px] uppercase tracking-wider text-faint">
            <tr>
              <th className="p-2.5 text-left">{t("product")}</th>
              <th className="p-2.5 text-left">{t("offer")}</th>
              <th className="p-2.5 text-left">{t("upstreamPlan")}</th>
              <th className="p-2.5 text-right">{t("cost")}</th>
              <th className="p-2.5 text-right">{t("price")}</th>
              <th className="p-2.5 text-right">{t("margin")}</th>
              <th className="p-2.5" />
            </tr>
          </thead>
          <tbody>
            {offers === null && <tr><td colSpan={7} className="p-6 text-center"><Spinner /></td></tr>}
            {offers?.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-[13px] text-muted">
                {t("noOffers")} <button type="button" className="font-medium text-iris hover:underline" onClick={() => setDrawer(true)}>{t("addPlans")}</button>
              </td></tr>
            )}
            {visible.map((o) => {
              const k = key(o);
              const attention = !o.margin_ok || o.unmapped || o.plan_missing;
              return (
                <tr key={k} className={cn("border-t border-line", attention && "bg-warn-soft/30")}>
                  <td className="p-2.5 align-top">
                    <Link href={productHref(o)} className="font-medium text-fg hover:text-iris">{o.product_title}</Link>
                    <span className="mt-0.5 block"><Tag tone={o.product_status === "active" ? "good" : "neutral"}>{o.product_status}</Tag></span>
                  </td>
                  <td className="p-2.5 align-top">
                    <span className="block text-fg">{o.label}</span>
                    <span className="block font-mono text-[11px] text-faint">{o.plan_key}</span>
                  </td>
                  <td className="p-2.5 align-top text-[12px] text-muted">
                    {o.unmapped ? <span className="text-warn"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{t("unmappedPlan")}</span>
                      : o.plan_missing ? <span className="text-warn"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{t("planMissing")}</span>
                      : (o.external_name ?? o.external_id ?? "—")}
                    {o.upstream_available === false && <span className="mt-0.5 block text-warn">{t("upstreamSoldOut")}</span>}
                  </td>
                  <td className="p-2.5 text-right align-top font-mono tabular-nums text-muted">{o.cost_price != null ? formatLedgerMoney(o.cost_price, locale) : "—"}</td>
                  <td className="p-2.5 text-right align-top">
                    <Input
                      aria-label={t("price")} type="number" min={1000} step={1000}
                      className="h-8 w-28 text-right font-mono tabular-nums"
                      value={editing[k] ?? String(o.price)}
                      onChange={(e) => setEditing((s) => ({ ...s, [k]: e.target.value }))}
                      onBlur={() => void savePrice(o)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    />
                  </td>
                  <td className={cn("p-2.5 text-right align-top font-mono tabular-nums", o.margin_ok ? "text-good" : "text-warn")}>
                    {o.margin_pct != null ? `${o.margin_pct}%` : "—"}
                  </td>
                  <td className="p-2.5 text-right align-top">
                    <button type="button" onClick={() => setConfirmRemove(o)} aria-label={t("removeOffer")} className="rounded p-1 text-faint hover:bg-bad-soft hover:text-bad"><Trash className="h-4 w-4" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drawer && (
        <AddPlansDrawer
          area={area} source={source} products={products} margin={Number(margin) || 30}
          onClose={() => setDrawer(false)}
          onDone={async (n) => { setDrawer(false); setNotice(t("plansImported", { n })); await load(); await onSourceChange(); }}
        />
      )}

      <Dialog open={confirmRemove !== null} onOpenChange={(o) => { if (!o && !busy) setConfirmRemove(null); }}>
        <DialogContent className="max-w-sm gap-3 rounded-2xl border-line bg-surface p-5 shadow-card-lg">
          <DialogTitle className="text-[15px] font-bold text-fg">{t("removeOfferTitle")}</DialogTitle>
          <p className="text-[12.5px] text-muted">{confirmRemove && t("removeOfferBody", { label: confirmRemove.label, product: confirmRemove.product_title })}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => setConfirmRemove(null)} disabled={busy}>{t("cancel")}</Button>
            <Button size="sm" variant="danger" onClick={remove} disabled={busy}>{t("removeOffer")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ drawer */

type Row = SourcePlanImportItem & { _id: string; item: SourceCatalogItem };

function AddPlansDrawer({ area, source, products, margin, onClose, onDone }: {
  area: SourceArea; source: SupplierSource; products: { product_id: number; product_title: string; n: number }[]; margin: number;
  onClose: () => void; onDone: (n: number) => Promise<void>;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const isTop = source.adapter_type === "topproxy";
  const [items, setItems] = useState<SourceCatalogItem[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [target, setTarget] = useState<"new" | number>(products[0]?.product_id ?? "new");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<"draft" | "active">("draft");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Admin nhập gói cho nguồn CHƯA giao seller → phải chọn seller sở hữu sản phẩm.
  const needsOwner = area === "admin" && source.seller_id == null;
  const [sellers, setSellers] = useState<SourceSellerCandidate[]>([]);
  const [ownerId, setOwnerId] = useState("");

  useEffect(() => {
    api.sources.catalog(area, sourceRef(area, source), { in_stock: false, per_page: 200, sort: "name" }).then((p) => setItems(p.items)).catch((e) => setError(apiErrorMessage(e)));
    api.categories().then(setCategories).catch(() => setCategories([]));
    if (needsOwner) api.sources.sellers().then(setSellers).catch(() => setSellers([]));
  }, [area, source.id, source.public_key, apiErrorMessage, needsOwner]);

  const flatCategories = useMemo(() => {
    const out: { id: number; name: string }[] = [];
    const walk = (list: Category[], depth: number) => {
      for (const c of list) {
        out.push({ id: c.id, name: `${"— ".repeat(depth)}${c.name}` });
        if (c.children?.length) walk(c.children, depth + 1);
      }
    };
    walk(categories, 0);
    return out;
  }, [categories]);

  const add = (item: SourceCatalogItem) => {
    const extra = item.extra as { duration_days?: number; mode?: string; loaiproxy?: string; proxy_type?: string };
    const days = Number(extra.duration_days) || 30;
    setRows((rs) => [...rs, {
      _id: `${item.external_id}:${Date.now()}:${rs.length}`, item,
      external_id: item.external_id,
      // DProxy: loại lấy từ proxies_type_id của gói; quốc gia/nhà mạng gói không khai → admin điền.
      type: isTop ? "HTTP" : (extra.proxy_type ?? ""),
      network: isTop ? (extra.mode === "xoay" ? "xoay" : item.external_id) : "",
      days, price: suggestPrice(item.cost_price, margin), network_label: isTop && extra.mode !== "xoay" ? item.name.split(" · ").pop() : undefined,
    }]);
  };
  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...p } : r)));
  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r._id !== id));

  const valid = rows.length > 0 && rows.every((r) => r.type && r.network && (r.days ?? 0) >= 1 && (r.price ?? 0) > 0)
    && (target !== "new" || (title.trim().length > 0 && categoryId !== ""))
    && (!needsOwner || target !== "new" || ownerId !== "");
  const visibleItems = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !needle || `${i.name} ${i.external_id} ${i.group_name}`.toLowerCase().includes(needle));
  }, [items, q]);

  const save = async () => {
    setSaving(true);
    try {
      const payload: SourcePlanImportItem[] = rows.map(({ _id, item, ...r }, idx) => ({
        ...r,
        ...(target === "new"
          ? { group_key: "new", ...(idx === 0 ? { title: title.trim(), category_id: Number(categoryId), status } : {}) }
          : { product_id: target }),
      }));
      const created = await api.sources.importPlans(area, sourceRef(area, source), payload, needsOwner && target === "new" ? Number(ownerId) : null);
      await onDone(created.length);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-5xl gap-0 overflow-hidden rounded-2xl border-line bg-surface p-0 shadow-card-lg">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 pr-12">
          <div>
            <DialogTitle className="text-[16px] font-bold text-fg">{t("addPlansTitle")}</DialogTitle>
            <p className="text-[12.5px] text-muted">{t(isTop ? "addPlansHintTop" : "addPlansHintDproxy")}</p>
          </div>
        </div>
        <div className="grid max-h-[calc(92dvh-140px)] grid-cols-1 overflow-hidden md:grid-cols-[320px_1fr]">
          {/* catalog */}
          <div className="flex min-h-0 flex-col border-b border-line md:border-b-0 md:border-r">
            <div className="relative p-3">
              <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input id="plan-q" className="h-9 pl-8" placeholder={t("searchPlans")} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {items === null && <li className="p-4 text-center"><Spinner /></li>}
              {visibleItems.map((i) => {
                const extra = i.extra as { duration_days?: number; currency?: string };
                return (
                  <li key={i.external_id}>
                    <button type="button" onClick={() => add(i)} className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-raised">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-fg">{i.name}</span>
                        <span className="block text-[11px] text-faint">{i.group_name}{extra.duration_days ? ` · ${extra.duration_days} ${t("days")}` : ""}{extra.currency && extra.currency !== "VND" ? ` · ${extra.currency}` : ""}</span>
                      </span>
                      <span className="shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">{i.cost_price ? formatLedgerMoney(i.cost_price, locale) : "—"}<Plus className="ml-1 inline h-3.5 w-3.5 text-iris" /></span>
                    </button>
                  </li>
                );
              })}
              {items?.length === 0 && <li className="p-4 text-center text-[12.5px] text-muted">{t("noPlansSynced")}</li>}
            </ul>
          </div>
          {/* rows */}
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line-2 p-6 text-center text-[13px] text-muted">{t("pickPlansHint")}</p>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead className="text-[11px] uppercase tracking-wider text-faint">
                    <tr><th className="pb-1.5 text-left">{t("upstreamPlan")}</th><th className="pb-1.5 text-left">{t("colType")}</th><th className="pb-1.5 text-left">{t("colNetwork")}</th><th className="pb-1.5 text-left">{t("colDays")}</th><th className="pb-1.5 text-right">{t("price")}</th><th /></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r._id} className="border-t border-line align-top">
                        <td className="py-2 pr-2"><span className="block font-medium text-fg">{r.item.name}</span><span className="block font-mono text-[11px] text-faint">{t("cost")} {r.item.cost_price ? formatLedgerMoney(r.item.cost_price, locale) : "—"}</span></td>
                        <td className="py-2 pr-2">
                          {isTop ? (
                            <Select value={r.type} onChange={(e) => patch(r._id, { type: e.target.value })} className="h-8 w-24 text-[12px]">{PROTOCOLS.map((p) => <option key={p}>{p}</option>)}</Select>
                          ) : (
                            <Input list="dp-types" value={r.type} onChange={(e) => patch(r._id, { type: e.target.value })} placeholder="residential" className="h-8 w-28 font-mono text-[12px]" />
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          {isTop ? <span className="inline-block pt-1.5 font-mono text-[12px] text-muted">{r.network}</span>
                            : <Input value={r.network} onChange={(e) => patch(r._id, { network: e.target.value })} placeholder="VN" className="h-8 w-20 font-mono text-[12px]" />}
                          {!isTop && <Input value={r.network_label ?? ""} onChange={(e) => patch(r._id, { network_label: e.target.value })} placeholder={t("networkLabelPh")} className="mt-1 h-8 w-28 text-[12px]" />}
                        </td>
                        <td className="py-2 pr-2">
                          {/* Gói DProxy có thời hạn cố định — lệnh mua không nhận số ngày. */}
                          <Input
                            type="number" min={1} value={r.days ?? ""}
                            readOnly={!isTop && Boolean((r.item.extra as { duration_days?: number }).duration_days)}
                            onChange={(e) => patch(r._id, { days: Number(e.target.value) })}
                            className="h-8 w-20 font-mono text-[12px] read-only:bg-raised read-only:text-muted"
                          />
                        </td>
                        <td className="py-2 pr-2 text-right"><Input type="number" min={1000} step={1000} value={r.price ?? ""} onChange={(e) => patch(r._id, { price: Number(e.target.value) })} className="h-8 w-28 text-right font-mono text-[12px]" /></td>
                        <td className="py-2 text-right"><button type="button" onClick={() => removeRow(r._id)} aria-label={t("cancel")} className="rounded p-1 text-faint hover:text-bad"><X className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!isTop && <datalist id="dp-types">{DPROXY_TYPES.map((v) => <option key={v} value={v} />)}</datalist>}
              {rows.length > 0 && (
                <div className="mt-4 space-y-3 rounded-lg border border-line p-3">
                  <p className="text-[12.5px] font-semibold text-fg">{t("targetProduct")}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-[12.5px]", target === "new" ? "border-iris bg-iris-soft/40" : "border-line")}>
                      <input type="radio" name="plan-target" checked={target === "new"} onChange={() => setTarget("new")} className="mt-0.5 accent-iris" />
                      <span><b className="block font-semibold text-fg">{t("newProduct")}</b><span className="text-muted">{t("newProductHint")}</span></span>
                    </label>
                    <label className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-[12.5px]", target !== "new" ? "border-iris bg-iris-soft/40" : "border-line", products.length === 0 && "opacity-50")}>
                      <input type="radio" name="plan-target" disabled={products.length === 0} checked={target !== "new"} onChange={() => setTarget(products[0].product_id)} className="mt-0.5 accent-iris" />
                      <span className="min-w-0 flex-1"><b className="block font-semibold text-fg">{t("existingProductOfSource")}</b>
                        {target !== "new" && (
                          <Select value={String(target)} onChange={(e) => setTarget(Number(e.target.value))} className="mt-1 h-8 text-[12px]">
                            {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_title} ({p.n})</option>)}
                          </Select>
                        )}
                      </span>
                    </label>
                  </div>
                  {needsOwner && target === "new" && (
                    <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
                      {t("ownerSeller")}
                      <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="h-9 text-[13px]">
                        <option value="">{t("ownerSeller")}…</option>
                        {sellers.map((s) => <option key={s.id} value={s.id}>{s.business_name ?? s.email}{s.is_internal ? ` · ${t("internalSeller")}` : ""}</option>)}
                      </Select>
                    </label>
                  )}
                  {target === "new" && (
                    <div className="grid gap-2 sm:grid-cols-[1fr_200px_120px]">
                      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("productTitlePh")} aria-label={t("productTitlePh")} className="h-9 text-[13px]" />
                      <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label={t("category")} className="h-9 text-[13px]">
                        <option value="">{t("category")}…</option>
                        {flatCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Select>
                      <Select value={status} onChange={(e) => setStatus(e.target.value as "draft" | "active")} aria-label={t("colStatus")} className="h-9 text-[13px]">
                        <option value="draft">{t("statusDraft")}</option><option value="active">{t("statusActive")}</option>
                      </Select>
                    </div>
                  )}
                </div>
              )}
              {error && <p className="mt-3 text-[13px] text-bad" role="alert">{error}</p>}
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <span className="text-[12px] text-faint">{t("plansSelected", { n: rows.length })}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={onClose} disabled={saving}>{t("cancel")}</Button>
                <Button size="sm" onClick={save} disabled={!valid || saving}>{saving ? t("creating") : t("importPlans", { n: rows.length })}</Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
