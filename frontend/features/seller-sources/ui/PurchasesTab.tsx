"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money/CurrencyProvider";
import type { SourceArea, SourcePurchasePage, SourcePurchaseQuery } from "@/lib/types";
import { Banner, Button, Input, Pagination, Select, Tag } from "@/components/ui";
import { AlertTriangle, CheckCircle2, Clock, Search } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { FilterChip, SummaryStrip } from "./shared";

type Result = NonNullable<SourcePurchaseQuery["result"]>;
type Days = NonNullable<SourcePurchaseQuery["days"]>;

/** Mỗi đơn khách mua → một lần sàn mua lại từ nguồn: khách trả, nguồn trừ,
 *  lời, và đơn lỗi đã hoàn tiền cho khách hay chưa. */
export function PurchasesTab({ area, sourceRef: ref, initialResult }: { area: SourceArea; sourceRef: string; initialResult: string | null }) {
  const t = useTranslations("sellerSources");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const money = (n: number) => formatLedgerMoney(n, locale);

  const [days, setDays] = useState<Days>(initialResult ? 7 : 1);
  const [result, setResult] = useState<Result>(initialResult === "failed" ? "failed" : "all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SourcePurchasePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const h = setTimeout(async () => {
      setLoading(true);
      try {
        setData(await api.sources.purchases(area, ref, { days, result, q: q.trim(), page, per_page: 50 }));
        setError("");
      } catch (e) {
        setError(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(h);
  }, [area, ref, days, result, q, page, reloadKey, apiErrorMessage]);

  const s = data?.summary;
  const windowLabel = t(`orders.window${days}`);
  const time = (iso: string) => new Date(iso).toLocaleString(locale, days === 1
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-4 pt-4">
      {s && (
        <SummaryStrip
          label={t("orders.summaryLabel", { window: windowLabel })}
          cells={[
            { key: "orders", label: t("orders.sumOrders", { window: windowLabel }), value: s.orders, sub: t("orders.sumUnits", { n: s.units }) },
            { key: "paid", label: t("orders.sumPaid"), value: money(s.paid), sub: t("orders.sumCost", { cost: money(s.cost) }) },
            { key: "profit", label: t("orders.sumProfit"), value: money(s.profit), tone: s.profit > 0 ? "good" : undefined, sub: t("orders.sumProfitHint") },
            {
              key: "failed", label: t("orders.sumFailed"), value: s.failed, tone: s.failed > 0 ? "bad" : undefined,
              sub: s.failed > 0 ? t("orders.sumRefunded", { amount: money(s.refunded) }) : t("orders.sumNoFail"),
            },
          ]}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input id="ord-q" aria-label={t("orders.search")} className="h-9 pl-8" placeholder={t("orders.search")}
            value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "ok", "failed", "pending"] as Result[]).map((r) => (
            <FilterChip key={r} on={result === r} onClick={() => { setResult(r); setPage(1); }}
              count={data?.counts[r]} tone={r === "failed" ? "bad" : undefined}>
              {t(`orders.result_${r}`)}
            </FilterChip>
          ))}
        </div>
        <Select id="ord-days" aria-label={t("orders.window")} className="h-9 w-36 sm:ml-auto" value={days}
          onChange={(e) => { setDays(Number(e.target.value) as Days); setPage(1); }}>
          {([1, 7, 30] as Days[]).map((d) => <option key={d} value={d}>{t(`orders.window${d}`)}</option>)}
        </Select>
      </div>

      {error && (
        <Banner tone="bad" icon={<AlertTriangle size={15} />} action={<Button size="sm" variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>{t("retry")}</Button>}>
          {error}
        </Banner>
      )}

      <div role="region" aria-label={t("orders.tableLabel")} tabIndex={0} className={cn("relative overflow-x-auto rounded-card border border-line bg-card", loading && data && "opacity-70")}>
        <table className="w-full min-w-[980px] text-[13px]">
          <thead className="bg-raised text-left text-[12px] text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">{t("orders.colTime")}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{t("orders.colOrder")}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{t("orders.colVariant")}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("orders.colQty")}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("orders.colPaid")}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("orders.colCost")}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("orders.colProfit")}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{t("orders.colResult")}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{t("orders.colTrans")}</th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">{t("loading")}</td></tr>}
            {data?.items.map((o) => (
              <tr key={o.order_id} className={cn("border-t border-line align-top", o.result === "failed" && "bg-bad-soft/50")}>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums text-muted">{time(o.created_at)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono font-medium text-fg">{o.order_code}</td>
                <td className="px-3 py-2.5">
                  <span className="block text-fg">{o.product_title ?? "—"}</span>
                  {o.variant_name && <span className="block text-[12px] text-muted">{o.variant_name}</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">×{o.quantity}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-fg">{money(o.total_amount)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">
                  {o.result === "ok" ? `${o.cost_estimated ? "≈ " : ""}${money(o.cost)}` : money(0)}
                </td>
                <td className={cn("px-3 py-2.5 text-right font-mono font-semibold tabular-nums", o.result === "ok" ? (o.profit >= 0 ? "text-good" : "text-bad") : "text-faint")}>
                  {o.result === "ok" ? money(o.profit) : "—"}
                </td>
                <td className="px-3 py-2.5">
                  {o.result === "ok" && <Tag tone="good"><CheckCircle2 size={12} />{t("orders.delivered")}</Tag>}
                  {o.result === "pending" && <Tag tone="iris"><Clock size={12} />{t("orders.pending")}</Tag>}
                  {o.result === "failed" && (
                    <>
                      <Tag tone="bad"><AlertTriangle size={12} />{t("orders.failedRefunded", { amount: money(o.refunded) })}</Tag>
                      {o.error && <p className="mt-1 max-w-xs text-[12px] leading-snug text-bad">{o.error}</p>}
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-muted">{o.trans_id ?? "—"}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">{q || result !== "all" ? t("noMatch") : t("orders.empty", { window: windowLabel })}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
          <span>{data.items.some((o) => o.cost_estimated) ? t("orders.estimatedNote") : t("orders.scopeNote")}</span>
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(data.total / data.per_page))} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
