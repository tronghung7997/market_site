"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { SourceOffer } from "@/lib/types";
import { Button, Tag } from "@/components/ui";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, X } from "@/components/Icons";
import { cellKey, marginRange, needsAttention, type OfferSummary, type ProductOfferGrid } from "../offer-grid";

/** Second line inside a cell, like the product price grid's toggle. */
export type OfferCellView = "margin" | "cost" | "perday";
export const OFFER_CELL_VIEWS: OfferCellView[] = ["margin", "cost", "perday"];

const PRODUCT_STATUSES = ["draft", "paused", "suspended", "active"];

function digits(text: string): number {
  const n = Number(text.replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Source-wide numbers, styled like the product grid's summary strip. */
export function OfferSummaryStrip({ summary, formatMoney }: { summary: OfferSummary; formatMoney: (amount: number) => string }) {
  const t = useTranslations("sellerSources");
  const margin = marginRange(summary.marginMin, summary.marginMax);
  const items: { label: string; value: string; bad?: boolean }[] = [
    { label: t("statSelling"), value: String(summary.selling) },
    { label: t("statProducts"), value: String(summary.products) },
    { label: t("statAttention"), value: String(summary.attention), bad: summary.attention > 0 },
    {
      label: t("statPrice"),
      value: summary.minPrice == null ? "—"
        : summary.minPrice === summary.maxPrice ? formatMoney(summary.minPrice)
          : `${formatMoney(summary.minPrice)} – ${formatMoney(summary.maxPrice ?? 0)}`,
    },
    { label: t("statMargin"), value: margin ?? "—" },
  ];
  return (
    <dl className="grid grid-cols-2 divide-line overflow-hidden rounded-lg border border-line bg-card sm:flex sm:divide-x">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 flex-1 px-3 py-2">
          <dt className="text-[11.5px] text-muted">{item.label}</dt>
          <dd className={cn("font-mono text-[15px] font-semibold tabular-nums", item.bad ? "text-bad" : "text-fg")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One product of a proxy source as the same grid its "Giá & nguồn hàng" tab
 *  shows: a row group per type, a row per network, a column per duration. */
export function ProductOfferCard({
  grid,
  open,
  onToggle,
  productHref,
  margin,
  minMargin,
  view,
  busy,
  numberLocale,
  priceOf,
  onPriceChange,
  onPriceCommit,
  onRemove,
  onReprice,
  onAdd,
  formatMoney,
}: {
  grid: ProductOfferGrid;
  open: boolean;
  onToggle: () => void;
  productHref: string;
  margin: number;
  minMargin: number;
  view: OfferCellView;
  busy: boolean;
  numberLocale: string;
  priceOf: (offer: SourceOffer) => number;
  onPriceChange: (offer: SourceOffer, price: number) => void;
  onPriceCommit: (offer: SourceOffer) => void;
  onRemove: (offer: SourceOffer) => void;
  onReprice: () => void;
  onAdd: (cell: { type: string; network: string; days: number; price?: number }) => void;
  formatMoney: (amount: number) => string;
}) {
  const t = useTranslations("sellerSources");
  const range = marginRange(grid.marginMin, grid.marginMax);
  const panelId = `offer-grid-${grid.productId}`;
  const status = PRODUCT_STATUSES.includes(grid.status) ? t(`productStatus.${grid.status}`) : grid.status;

  return (
    <section className="overflow-hidden rounded-card border border-line bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full min-w-0 items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/50 sm:w-auto sm:flex-1"
        >
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="max-w-full truncate text-[14px] font-semibold text-fg">{grid.title}</span>
            <Tag tone={grid.status === "active" ? "good" : "neutral"}>{status}</Tag>
            <span className="font-mono text-[12px] text-muted">
              {t("plansCount", { n: grid.offers.length })}{range ? ` · ${t("marginLabel", { range })}` : ""}
            </span>
            {grid.attention > 0 && (
              <Tag tone="warn"><AlertTriangle className="h-3 w-3" />{t("attentionCells", { n: grid.attention })}</Tag>
            )}
          </span>
        </button>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="secondary" disabled={busy} onClick={onReprice}>{t("applyMarginProduct", { pct: margin })}</Button>
          <Link href={productHref} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline">
            {t("openProduct")}<ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </header>

      {open && (
        <div id={panelId} role="region" aria-label={grid.title} tabIndex={0} className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-raised text-[12px] text-muted">
                <th scope="col" className="sticky left-0 z-10 whitespace-nowrap bg-raised px-3 py-2 text-left font-medium">{t("rowAxis")}</th>
                {grid.days.map((days) => (
                  <th key={days} scope="col" className="w-44 whitespace-nowrap px-2 py-2 text-right font-medium">{t("daysColumn", { days })}</th>
                ))}
              </tr>
            </thead>
            {grid.types.map((group) => (
              <tbody key={group.type}>
                <tr className="border-t border-line bg-surface">
                  <th scope="rowgroup" colSpan={grid.days.length + 1} className="px-3 py-2 text-left">
                    <span className="text-[13px] font-semibold text-fg">{group.type}</span>
                    <span className="ml-2 font-mono text-[11.5px] font-normal text-muted">
                      {t("plansCount", { n: grid.offers.filter((o) => o.type === group.type).length })}
                    </span>
                  </th>
                </tr>
                {group.networks.map((network) => (
                  <tr key={network} className="border-t border-line/70">
                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-1.5 pl-6 text-left text-[13px] font-medium text-fg">
                      {network}
                    </th>
                    {grid.days.map((days) => {
                      const offer = grid.cells.get(cellKey(group.type, network, days));
                      return (
                        <td key={days} className="px-1.5 py-1.5 align-top">
                          {offer ? (
                            <OfferCell
                              offer={offer}
                              price={priceOf(offer)}
                              view={view}
                              minMargin={minMargin}
                              numberLocale={numberLocale}
                              onChange={(price) => onPriceChange(offer, price)}
                              onCommit={() => onPriceCommit(offer)}
                              onRemove={() => onRemove(offer)}
                              formatMoney={formatMoney}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => onAdd({ type: group.type, network, days, price: siblingPrice(grid, group.type, days) })}
                              aria-label={`${t("addCell")} · ${group.type} · ${network} · ${t("daysColumn", { days })}`}
                              className="h-12 w-full rounded-lg border border-dashed border-line-2 text-[12px] text-muted transition-colors hover:border-iris hover:text-iris"
                            >
                              {t("addCell")}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}

/** Price of a neighbouring cell in the same column (same type first) — a
 *  better start for an empty cell than the upstream plan's own duration. */
function siblingPrice(grid: ProductOfferGrid, type: string, days: number): number | undefined {
  const column = grid.offers.filter((o) => o.days === days);
  return (column.find((o) => o.type === type) ?? column[0])?.price;
}

function OfferCell({
  offer,
  price,
  view,
  minMargin,
  numberLocale,
  onChange,
  onCommit,
  onRemove,
  formatMoney,
}: {
  offer: SourceOffer;
  price: number;
  view: OfferCellView;
  minMargin: number;
  numberLocale: string;
  onChange: (price: number) => void;
  onCommit: () => void;
  onRemove: () => void;
  formatMoney: (amount: number) => string;
}) {
  const t = useTranslations("sellerSources");
  // Plain ledger numbers inside the grid, like the price being typed.
  const num = (amount: number) => Math.round(amount).toLocaleString(numberLocale);
  const cost = offer.cost_price;
  const margin = cost && price > 0 ? Math.round(((price - cost) / cost) * 1000) / 10 : null;
  // Same rule as the backend's margin_ok, on the price being typed.
  const belowFloor = cost ? price < cost * (1 + minMargin / 100) : false;
  const broken = Boolean(offer.plan_missing) || offer.upstream_available === false || belowFloor;

  let sub: string;
  let subTone = "text-muted";
  if (offer.plan_missing) { sub = t("subPlanMissing"); subTone = "text-bad"; }
  else if (offer.upstream_available === false) { sub = t("subSoldOut"); subTone = "text-bad"; }
  else if (offer.unmapped) { sub = t("subUnmapped"); subTone = "text-warn"; }
  else if (belowFloor && margin != null) { sub = t("subBelowFloor", { pct: margin, floor: minMargin }); subTone = "text-bad"; }
  else if (view === "perday") sub = t("subPerDay", { amount: num(price / offer.days) });
  else if (cost == null) sub = t("subNoCost");
  else if (view === "cost") sub = t("subCost", { amount: num(cost) });
  else sub = t("subMargin", { profit: num(price - cost), pct: margin ?? 0 });

  const problem = offer.plan_missing ? t("planMissing")
    : offer.upstream_available === false ? t("upstreamSoldOut")
      : offer.unmapped ? t("unmappedPlan")
        : belowFloor ? t("marginBelowFloor", { floor: minMargin })
          : null;
  const details = [
    offer.label,
    offer.external_name ? `${t("upstreamPlan")}: ${offer.external_name}` : null,
    cost != null ? t("subCost", { amount: formatMoney(cost) }) : null,
    problem,
  ].filter(Boolean).join("\n");

  return (
    <div
      title={details}
      className={cn(
        "group relative min-w-[112px] rounded-lg border px-2 py-1 transition-colors focus-within:border-iris",
        broken ? "border-bad bg-bad-soft" : offer.unmapped ? "border-warn" : "border-line bg-surface",
      )}
    >
      <input
        name={`price-${offer.product_id}-${offer.plan_key}`}
        aria-label={`${t("price")} · ${offer.label}`}
        aria-invalid={broken || undefined}
        inputMode="numeric"
        className="h-6 w-full bg-transparent text-right font-mono text-[14px] font-semibold tabular-nums text-fg outline-none"
        value={price > 0 ? price.toLocaleString(numberLocale) : ""}
        onChange={(event) => onChange(digits(event.target.value))}
        onBlur={onCommit}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
      <div className={cn("flex items-center justify-end gap-1 truncate font-mono text-[11px] leading-4", subTone)}>
        {problem && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}
        <span className="truncate">{sub}</span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${t("removeOffer")} · ${offer.label}`}
        className="absolute -left-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card hover:text-bad focus-visible:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/50 group-hover:flex group-focus-within:flex"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
