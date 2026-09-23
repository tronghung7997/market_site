"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import { sellerProductPath } from "@/lib/routes";
import type {
  Category, GatewayOverview, GatewayPackage, GatewayRequestPage, GatewayTryResult, SourceArea, SupplierSource,
} from "@/lib/types";
import { Banner, Button, Card, Input, Pagination, Select, Spinner, Switch, Tag } from "@/components/ui";
import { AlertTriangle, CheckCircle2, ChevronLeft, ExternalLink, Info, Pause, Plus, Search, Trash, Bolt } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { sourceRef } from "../logic";
import { SettingsTab } from "./SettingsTab";
import { FilterChip, SummaryStrip } from "./shared";

type GatewayTab = "packages" | "endpoints" | "requests" | "settings";
const TABS: GatewayTab[] = ["packages", "endpoints", "requests", "settings"];

/** Nguồn API bán theo gói request (kind "gateway"): admin đặt gói + giá, xem
 *  endpoint, nhật ký request của khách và cài đặt gọi nguồn. */
export function GatewayWorkspace({ area, source, onSourceChange }: {
  area: SourceArea; source: SupplierSource; onSourceChange: () => Promise<void>;
}) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ref = sourceRef(area, source);
  const base = area === "admin" ? "/admin/sources" : "/seller/sources";
  const raw = params.get("tab") as GatewayTab | null;
  const tab: GatewayTab = raw && TABS.includes(raw) ? raw : "packages";
  const goTab = (next: GatewayTab) => router.replace(`${pathname}?tab=${next}`, { scroll: false });
  const stats = source.gateway_stats;
  const created = params.get("created");

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <Link href={base} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ChevronLeft size={14} />{t("title")}</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
          <h1 className="truncate font-serif text-2xl font-semibold text-fg">{source.name}</h1>
          <Tag tone="iris">{t("kind.gateway")} · {source.adapter_type}</Tag>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          {source.is_active
            ? <Tag tone="good"><CheckCircle2 size={12} />{t("status.running")}</Tag>
            : <Tag tone="neutral"><Pause size={12} />{t("status.paused")}</Tag>}
          {source.seller_email && <span>{t("list.soldAs", { store: source.seller_business_name ?? source.seller_email })}</span>}
        </p>
      </div>

      {created && <Banner tone="good" icon={<CheckCircle2 size={15} />}>{t("gateway.created")}</Banner>}

      <SummaryStrip
        label={t("workspace.summaryLabel")}
        cells={[
          { key: "req", label: t("gateway.requests24h"), value: (stats?.requests_24h ?? 0).toLocaleString(locale),
            sub: t("gateway.okShare", { ok: stats?.ok_24h ?? 0 }) },
          { key: "err", label: t("gateway.errors24h"), value: (stats?.errors_24h ?? 0).toLocaleString(locale),
            tone: (stats?.errors_24h ?? 0) > 0 ? "warn" : undefined, sub: t("gateway.errorsFree") },
          { key: "keys", label: t("gateway.activeKeys"), value: (stats?.active_keys ?? 0).toLocaleString(locale), sub: t("gateway.activeKeysSub") },
          { key: "profit", label: t("workspace.profit7d"), value: formatLedgerMoney(stats?.profit_7d ?? 0, locale),
            sub: t("gateway.sales7d", { amount: formatLedgerMoney(stats?.sales_7d ?? 0, locale) }) },
        ]}
      />

      <div role="tablist" aria-label={t("workspace.tabsLabel")} className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((key) => (
          <button
            key={key} type="button" role="tab" id={`gw-tab-${key}`} aria-selected={tab === key} aria-controls={`gw-panel-${key}`}
            onClick={() => goTab(key)}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors",
              tab === key ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t(`gateway.tab_${key}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`gw-panel-${tab}`} aria-labelledby={`gw-tab-${tab}`}>
        {tab === "packages" && <PackagesTab area={area} sref={ref} onSaved={onSourceChange} />}
        {tab === "endpoints" && <EndpointsTab area={area} sref={ref} />}
        {tab === "requests" && <RequestsTab area={area} sref={ref} />}
        {tab === "settings" && <SettingsTab area={area} sourceRef={ref} kind="gateway" onSaved={onSourceChange} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gói bán                                                             */
/* ------------------------------------------------------------------ */

type DraftPackage = { label: string; size: string; price: string; active: boolean };

function toDraft(p: GatewayPackage): DraftPackage {
  return { label: p.label, size: String(p.size), price: String(p.price), active: p.active };
}

function PackagesTab({ area, sref, onSaved }: { area: SourceArea; sref: string; onSaved: () => Promise<void> }) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const money = (n: number) => formatLedgerMoney(n, locale);
  const [data, setData] = useState<GatewayOverview | null>(null);
  const [rows, setRows] = useState<DraftPackage[]>([]);
  const [cost, setCost] = useState("");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [error, setError] = useState("");

  const apply = (d: GatewayOverview) => {
    setData(d);
    setRows(d.packages.map(toDraft));
    setCost(d.cost_per_request ? String(d.cost_per_request) : "");
    setTitle(d.product?.title ?? "");
    setCategoryId(d.product?.category_id ?? 0);
  };
  const load = useCallback(async () => {
    try {
      apply(await api.sources.gateway(area, sref));
      setError("");
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [area, sref, apiErrorMessage]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.categories().then(setCategories).catch(() => setCategories([])); }, []);

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

  if (error && !data) return <div className="pt-4"><Banner tone="bad" icon={<AlertTriangle size={15} />}>{error}</Banner></div>;
  if (!data) return <Spinner />;

  const costNum = Number(cost) || 0;
  const parsed = rows.map((r) => ({ ...r, sizeN: Number(r.size), priceN: Number(r.price) }));
  const invalid = parsed.some((r) => !Number.isInteger(r.sizeN) || r.sizeN < 1 || !Number.isInteger(r.priceN) || r.priceN < 1)
    || new Set(parsed.map((r) => r.sizeN)).size !== parsed.length;
  const dirty = JSON.stringify(rows) !== JSON.stringify(data.packages.map(toDraft))
    || costNum !== data.cost_per_request || title.trim() !== (data.product?.title ?? "") || categoryId !== (data.product?.category_id ?? 0);
  const selling = data.product?.status === "active";
  const productHref = data.product
    ? area === "admin" ? `/admin/products/${data.product.id}` : sellerProductPath({ id: data.product.id, public_key: data.product.public_key })
    : null;

  const save = async (publish?: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await api.sources.updatePackages(area, sref, {
        packages: parsed.map((r) => ({ label: r.label.trim() || t("gateway.defaultPackage", { n: r.sizeN }), size: r.sizeN, price: r.priceN, active: r.active })),
        cost_per_request: costNum,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(publish !== undefined ? { publish } : {}),
      });
      apply(next);
      setMsg({ tone: "good", text: publish === true ? t("gateway.published") : publish === false ? t("gateway.unpublished") : t("settings.saved") });
      await onSaved();
    } catch (e) {
      setMsg({ tone: "bad", text: apiErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const update = (i: number, patch: Partial<DraftPackage>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const active = parsed.filter((r) => r.active && r.sizeN > 0 && r.priceN > 0);
  const cheapest = active.length ? Math.min(...active.map((r) => r.priceN / r.sizeN)) : 0;

  return (
    <div className="space-y-4 pt-4">
      <Card className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,260px)_auto] md:items-end">
        <label className="block space-y-1">
          <span className="text-[12.5px] font-medium text-fg">{t("gateway.productTitle")}</span>
          <Input id="gw-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-[12.5px] font-medium text-fg">{t("catalog.category")}</span>
          <Select id="gw-category" value={categoryId || ""} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-[13px] text-fg">
            <Switch checked={selling} disabled={busy || dirty} label={t("gateway.selling")} onChange={(next) => void save(next)} />
            {selling ? t("gateway.selling") : t("gateway.draft")}
          </span>
          {productHref && (
            <Link href={productHref} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:text-iris">
              {t("selling.editProduct")}<ExternalLink size={13} />
            </Link>
          )}
        </div>
        {dirty && <p className="text-[12px] text-muted md:col-span-3">{t("gateway.saveBeforePublish")}</p>}
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-card border border-iris/20 bg-iris-soft px-4 py-3">
        <span className="text-[13.5px] text-fg"><b>{t("gateway.costLabel")}</b> {t("gateway.costLead")}</span>
        <Input id="gw-cost" type="number" min={0} step={1} aria-label={t("gateway.costLabel")} className="h-9 w-28 text-right font-mono"
          value={cost} onChange={(e) => setCost(e.target.value)} />
        <span className="text-[13.5px] text-fg">{t("gateway.perRequest")}</span>
        <span className="text-[12.5px] text-muted md:ml-auto">{t("gateway.costHint")}</span>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <div role="region" aria-label={t("gateway.packagesLabel")} tabIndex={0} className="relative overflow-x-auto rounded-card border border-line bg-card">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="bg-raised text-left text-[12px] text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-medium">{t("gateway.colName")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("gateway.colSize")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("gateway.colPrice")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("gateway.colPer")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("gateway.colProfit")}</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">{t("gateway.colSell")}</th>
                  <th scope="col" className="px-3 py-2.5"><span className="sr-only">{t("col.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {parsed.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">{t("gateway.noPackages")}</td></tr>
                )}
                {parsed.map((r, i) => {
                  const per = r.sizeN > 0 && r.priceN > 0 ? r.priceN / r.sizeN : null;
                  const profit = per !== null && costNum > 0 ? per - costNum : null;
                  return (
                    <tr key={i} className={cn("border-t border-line", !r.active && "text-muted")}>
                      <td className="px-3 py-2">
                        <Input id={`gw-pk-name-${i}`} aria-label={t("gateway.colName")} className="h-9" value={r.label}
                          placeholder={t("gateway.defaultPackage", { n: r.size || "…" })} onChange={(e) => update(i, { label: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input id={`gw-pk-size-${i}`} aria-label={t("gateway.colSize")} type="number" min={1} step={1} className="ml-auto h-9 w-24 text-right font-mono"
                          value={r.size} onChange={(e) => update(i, { size: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input id={`gw-pk-price-${i}`} aria-label={t("gateway.colPrice")} type="number" min={1} step={1} className="ml-auto h-9 w-28 text-right font-mono"
                          value={r.price} onChange={(e) => update(i, { price: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{per === null ? "—" : money(Math.round(per))}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {profit === null ? <span className="text-faint">—</span> : (
                          <>
                            <span className={cn("block font-semibold", profit >= 0 ? "text-good" : "text-bad")}>{money(Math.round(profit))}</span>
                            <span className="block text-[11.5px] text-muted">{Math.round((profit / costNum) * 100)}%</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2"><Switch checked={r.active} label={t("gateway.sellPackage", { name: r.label || r.size })} onChange={(next) => update(i, { active: next })} /></td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" aria-label={t("gateway.removePackage", { name: r.label || r.size })}
                          onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                          className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40">
                          <Trash size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-2.5">
              <Button size="sm" variant="secondary" disabled={rows.length >= 12}
                onClick={() => setRows((rs) => [...rs, { label: "", size: "", price: "", active: true }])}>
                <Plus size={14} />{t("gateway.addPackage")}
              </Button>
              <span className="text-[12px] text-muted">{t("gateway.packagesHint")}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-3">
            <p className="flex items-start gap-2 text-[12.5px] text-muted"><Info size={14} className="mt-0.5 shrink-0" />{t("gateway.priceChangeNote")}</p>
            <div className="flex items-center gap-2">
              {dirty && <Button variant="ghost" onClick={() => apply(data)} disabled={busy}>{t("cancel")}</Button>}
              <Button onClick={() => void save()} disabled={!dirty || invalid || busy}>{t("gateway.savePackages")}</Button>
            </div>
          </div>
          {invalid && <p role="alert" className="text-[12.5px] text-bad">{t("gateway.packagesInvalid")}</p>}
          {msg && <p role={msg.tone === "bad" ? "alert" : "status"} className={cn("text-[12.5px]", msg.tone === "bad" ? "text-bad" : "text-good")}>{msg.text}</p>}
        </div>

        <aside aria-labelledby="gw-preview" className="space-y-2.5 rounded-card border border-line bg-card p-4">
          <p id="gw-preview" className="text-[12.5px] font-medium text-muted">{t("gateway.buyerSees")}</p>
          <p className="text-[14px] font-semibold text-fg">{t("gateway.choosePackage")}</p>
          {active.length === 0 && <p className="text-[12.5px] text-muted">{t("gateway.noActivePackages")}</p>}
          {active.map((r) => {
            const per = r.priceN / r.sizeN;
            const save = cheapest > 0 && active.length > 1 ? Math.round((1 - per / Math.max(...active.map((x) => x.priceN / x.sizeN))) * 100) : 0;
            return (
              <div key={r.sizeN} className="flex items-center justify-between gap-2 rounded-lg border border-line-2 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium text-fg">
                    {r.label || t("gateway.defaultPackage", { n: r.sizeN })}
                    {save >= 5 && <Tag tone="good">{t("gateway.saves", { pct: save })}</Tag>}
                  </span>
                  <span className="block text-[12px] text-muted">
                    <span className="whitespace-nowrap">{t("gateway.defaultPackage", { n: r.sizeN.toLocaleString(locale) })}</span>
                    {" · "}
                    <span className="whitespace-nowrap">{t("gateway.previewSub", { per: money(Math.round(per)) })}</span>
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[13.5px] font-semibold tabular-nums text-fg">{money(r.priceN)}</span>
              </div>
            );
          })}
          {data.charge_only_success && (
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-good"><CheckCircle2 size={14} />{t("gateway.chargeOnlySuccess")}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Endpoint                                                            */
/* ------------------------------------------------------------------ */

export function prettyBody(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function EndpointsTab({ area, sref }: { area: SourceArea; sref: string }) {
  const t = useTranslations("sellerSources");
  const apiErrorMessage = useApiErrorMessage();
  const [data, setData] = useState<GatewayOverview | null>(null);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GatewayTryResult | null>(null);

  useEffect(() => {
    api.sources.gateway(area, sref)
      .then((d) => {
        setData(d);
        const sample = d.endpoints[0]?.sample_body?.url;
        if (typeof sample === "string") setUrl((u) => u || sample);
      })
      .catch((e) => setError(apiErrorMessage(e)));
  }, [area, sref, apiErrorMessage]);

  if (error) return <div className="pt-4"><Banner tone="bad" icon={<AlertTriangle size={15} />}>{error}</Banner></div>;
  if (!data) return <Spinner />;
  const ep = data.endpoints[0];

  const run = async () => {
    if (!ep) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await api.sources.tryEndpoint(area, sref, ep.name, { url: url.trim() }));
    } catch (e) {
      setResult({ status_code: null, latency_ms: 0, body: apiErrorMessage(e), truncated: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pt-4">
      {data.endpoints.map((e) => (
        <Card key={e.name} className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[16px] font-semibold text-fg">{e.name}</span>
                <Tag tone="iris">{e.method}</Tag>
                <Tag tone="good">{t("gateway.endpointOpen")}</Tag>
              </p>
              <p className="text-[13px] text-muted">{e.summary}</p>
            </div>
            <span className="text-[13px] text-muted">{t("gateway.unitsPerCall", { n: e.units })}</span>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-fg">{t("gateway.params")}</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {e.params.map((p) => (
                  <li key={p.name} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                    <span className="font-mono font-semibold text-fg">{p.name}</span>
                    {p.required && <Tag tone="warn">{t("gateway.required")}</Tag>}
                    <span className="text-muted">{p.type} — {p.description}</span>
                  </li>
                ))}
              </ul>
              {e.path && (
                <>
                  <p className="pt-2 text-[13px] font-semibold text-fg">{t("gateway.upstreamCall")}</p>
                  <pre className="overflow-x-auto rounded-lg bg-raised px-3 py-2 font-mono text-[12px] text-fg">{`${e.method} ${e.path}?api_key=••••`}</pre>
                </>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-fg">{t("gateway.chargeRules")}</p>
              <ul className="divide-y divide-line rounded-lg border border-line text-[13px]">
                <li className="flex items-center gap-2 px-3 py-2"><Tag tone="good">2xx</Tag><span className="flex-1">{t("gateway.rule2xx")}</span><span className="font-mono font-semibold text-good">{t("gateway.minusN", { n: e.units })}</span></li>
                <li className="flex items-center gap-2 px-3 py-2"><Tag tone="warn">4xx</Tag><span className="flex-1">{t("gateway.rule4xx")}</span><span className="font-mono text-muted">{data.charge_only_success ? t("gateway.notCharged") : t("gateway.minusN", { n: e.units })}</span></li>
                <li className="flex items-center gap-2 px-3 py-2"><Tag tone="bad">5xx</Tag><span className="flex-1">{t("gateway.rule5xx", { s: data.timeout_seconds })}</span><span className="font-mono text-muted">{t("gateway.notCharged")}</span></li>
              </ul>
              <p className="text-[12px] text-muted">{t("gateway.passThrough")}</p>
            </div>
          </div>
        </Card>
      ))}

      {ep && (
        <Card className="space-y-3 p-5">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-fg">
            <Bolt size={16} className="text-iris" />{t("gateway.tryTitle")}
            <span className="text-[12.5px] font-normal text-muted">{t("gateway.tryAdminHint")}</span>
          </p>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
            <Input id="gw-try-url" aria-label={t("gateway.tryUrl")} className="h-10 min-w-0 flex-1" type="url" required
              placeholder="https://www.facebook.com/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button type="submit" disabled={busy || !url.trim()}>{busy ? t("gateway.calling") : t("gateway.callEndpoint", { name: ep.name })}</Button>
          </form>
          {result && <TryResult result={result} />}
        </Card>
      )}
    </div>
  );
}

export function TryResult({ result }: { result: GatewayTryResult }) {
  const t = useTranslations("sellerSources");
  const ok = result.status_code !== null && result.status_code < 400;
  return (
    <div className="space-y-2">
      <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <Tag tone={ok ? "good" : result.status_code === null ? "bad" : "warn"}>{result.status_code ?? t("gateway.noResponse")}</Tag>
        {t("gateway.latency", { s: (result.latency_ms / 1000).toFixed(1) })}
        {result.units_charged !== undefined && (
          <span>· {result.units_charged > 0 ? t("gateway.charged", { n: result.units_charged }) : t("gateway.notCharged")}</span>
        )}
        {result.units_remaining !== undefined && <span>· {t("gateway.remaining", { n: result.units_remaining })}</span>}
      </p>
      <pre className="max-h-96 overflow-auto rounded-lg bg-ink-panel px-4 py-3 font-mono text-[12px] leading-relaxed text-white/90">
        {prettyBody(result.body)}{result.truncated ? "\n…" : ""}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

function RequestsTab({ area, sref }: { area: SourceArea; sref: string }) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [hours, setHours] = useState<24 | 168>(24);
  const [result, setResult] = useState<"all" | "ok" | "error">("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<GatewayRequestPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const h = setTimeout(async () => {
      try {
        setData(await api.sources.requests(area, sref, { hours, result, q: q.trim(), page }));
        setError("");
      } catch (e) {
        setError(apiErrorMessage(e));
      }
    }, 200);
    return () => clearTimeout(h);
  }, [area, sref, hours, result, q, page, apiErrorMessage]);

  const s = data?.summary;
  const time = (iso: string) => new Date(iso).toLocaleString(locale, hours === 24
    ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-4 pt-4">
      {s && (
        <SummaryStrip
          label={t("gateway.requestsSummary")}
          cells={[
            { key: "r", label: t(hours === 24 ? "gateway.requests24h" : "gateway.requests7d"), value: s.requests.toLocaleString(locale), sub: t("gateway.keysCalling", { n: s.active_keys }) },
            { key: "ok", label: t("gateway.okCharged"), value: s.ok.toLocaleString(locale), tone: "good",
              sub: s.requests ? `${Math.round((s.ok / s.requests) * 1000) / 10}%` : "—" },
            { key: "err", label: t("gateway.errorsFreeLabel"), value: s.errors.toLocaleString(locale), tone: s.errors > 0 ? "warn" : undefined, sub: t("gateway.errorsFree") },
            { key: "lat", label: t("gateway.avgLatency"), value: s.avg_latency_ms === null ? "—" : `${(s.avg_latency_ms / 1000).toFixed(1)}s`,
              sub: s.max_latency_ms === null ? "" : t("gateway.maxLatency", { s: (s.max_latency_ms / 1000).toFixed(1) }) },
          ]}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input id="gw-req-q" aria-label={t("gateway.searchRequests")} className="h-9 pl-8" placeholder={t("gateway.searchRequests")}
            value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        {(["all", "ok", "error"] as const).map((r) => (
          <FilterChip key={r} on={result === r} onClick={() => { setResult(r); setPage(1); }}>{t(`gateway.result_${r}`)}</FilterChip>
        ))}
        <Select id="gw-req-hours" aria-label={t("orders.window")} className="h-9 w-36 sm:ml-auto" value={hours}
          onChange={(e) => { setHours(Number(e.target.value) as 24 | 168); setPage(1); }}>
          <option value={24}>{t("orders.window1")}</option>
          <option value={168}>{t("orders.window7")}</option>
        </Select>
      </div>
      {error && <Banner tone="bad" icon={<AlertTriangle size={15} />}>{error}</Banner>}
      <div role="region" aria-label={t("gateway.requestsLabel")} tabIndex={0} className="relative overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead className="bg-raised text-left text-[12px] text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">{t("orders.colTime")}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{t("orders.colOrder")}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{t("gateway.colKey")}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{t("gateway.colEndpoint")}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{t("orders.colResult")}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("gateway.colLatency")}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("gateway.colCharged")}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("gateway.colRemaining")}</th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">{t("loading")}</td></tr>}
            {data?.items.map((r) => (
              <tr key={r.id} className={cn("border-t border-line", !r.ok && "bg-warn-soft/50")}>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums text-muted">{time(r.created_at)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono font-medium text-fg">{r.order_code}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] text-muted">{r.key_prefix ?? "—"}</td>
                <td className="px-3 py-2.5 font-mono text-[12.5px] text-fg">{r.endpoint}</td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <Tag tone={r.ok ? "good" : r.status_code === null || r.status_code >= 500 ? "bad" : "warn"}>{r.status_code ?? t("gateway.noResponse")}</Tag>
                    {!r.ok && r.error && <span className="max-w-xs truncate text-[12px] text-warn" title={r.error}>{r.error}</span>}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">{(r.latency_ms / 1000).toFixed(1)}s</td>
                <td className={cn("px-3 py-2.5 text-right font-mono font-semibold tabular-nums", r.units_charged ? "text-good" : "text-faint")}>
                  {r.units_charged === null ? "—" : r.units_charged > 0 ? `−${r.units_charged}` : "0"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-fg">{r.units_remaining ?? "—"}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">{q || result !== "all" ? t("noMatch") : t("gateway.noRequests")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
          <span>{t("gateway.requestsNote")}</span>
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(data.total / data.per_page))} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
