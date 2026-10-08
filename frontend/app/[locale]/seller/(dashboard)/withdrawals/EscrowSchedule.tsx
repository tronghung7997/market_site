"use client";

/** Sales on their way to the wallet: the total (the wallet's figure), its
 *  breakdown, and delivered orders by the local day they are due. Figures are
 *  estimates after the platform fee: a dispute or a refund before the date
 *  changes what is credited. */

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { Button, Card, Skeleton } from "@/components/ui";
import { browserTimeZone, formatIsoDate, localIsoDate } from "@/features/seller-dashboard";
import { scheduleRows } from "./escrow-schedule";

const VISIBLE_DAYS = 7;

export function EscrowSchedule() {
  const t = useTranslations("seller.escrow");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const tz = useMemo(() => browserTimeZone(), []);
  const query = useQuery({ queryKey: ["seller", "escrow-schedule", tz], queryFn: () => api.sellerEscrowSchedule(tz), staleTime: 60_000 });
  const [expanded, setExpanded] = useState(false);
  const today = localIsoDate();
  const data = query.data;
  const rows = useMemo(() => (data ? scheduleRows(data.days, today) : []), [data, today]);
  const money = (amount: number) => formatBrowseMoney(amount, { locale });

  const cells = data ? [
    // Same figure as "Tiền bán chờ về ví" on the wallet and the ledger.
    { key: "total", label: t("total", { count: data.total.order_count }), value: data.total.net, count: null },
    { key: "held", label: t("inEscrow", { count: data.in_escrow.order_count }), value: data.in_escrow.net, count: data.in_escrow.order_count },
    { key: "dispute", label: t("disputed", { count: data.held_by_dispute.order_count }), value: data.held_by_dispute.net, count: data.held_by_dispute.order_count },
    { key: "delivery", label: t("awaitingDelivery", { count: data.awaiting_delivery.order_count }), value: data.awaiting_delivery.net, count: data.awaiting_delivery.order_count },
  ].filter((cell) => cell.count === null || cell.count > 0) : [];
  // Nothing held and nothing scheduled: the empty line below says it all.
  const nothingHeld = cells.every((cell) => cell.value === 0) && rows.length === 0;

  const dayLabel = (row: (typeof rows)[number]) =>
    row.kind === "today" ? t("today") : row.kind === "tomorrow" ? t("tomorrow") : formatIsoDate(row.date, locale, { weekday: "short", day: "numeric", month: "numeric" });
  const shown = expanded ? rows : rows.slice(0, VISIBLE_DAYS);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-raised/30 px-5 py-3">
        <h2 className="text-[13px] font-semibold">{t("title")}</h2>
        <p className="mt-0.5 text-[12px] text-muted">{t("subtitle")}</p>
      </div>

      {query.isPending ? (
        <div className="space-y-2 p-5" aria-hidden><Skeleton className="h-12" /><Skeleton className="h-4" /><Skeleton className="h-4 w-2/3" /></div>
      ) : query.isError ? (
        <div className="flex items-center justify-between gap-3 px-5 py-5 text-[12.5px]">
          <span className="text-bad">{t("loadFailed")}</span>
          <Button size="sm" variant="secondary" onClick={() => query.refetch()}>{t("retry")}</Button>
        </div>
      ) : (
        <>
          {!nothingHeld && (
            <dl className={cn(
              "grid grid-cols-2 gap-px border-b border-line bg-line",
              "[&>div:last-child:nth-child(odd)]:col-span-2",
              cells.length === 3 && "sm:grid-cols-3 sm:[&>div:last-child:nth-child(odd)]:col-span-1",
              cells.length === 4 && "xl:grid-cols-4",
            )}>
              {cells.map((cell) => (
                <div key={cell.key} className="flex flex-col-reverse gap-1 bg-card px-5 py-3">
                  <dt className="text-[11.5px] text-muted">{cell.label}</dt>
                  <dd className={cn("font-mono text-[15px] font-semibold tabular", cell.key === "dispute" && "text-warn")}>{money(cell.value)}</dd>
                </div>
              ))}
            </dl>
          )}

          {rows.length === 0 ? (
            <p className="px-5 py-6 text-center text-[12.5px] text-muted">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((row) => (
                <li key={row.date} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-5 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)_auto]">
                  <span className={cn("text-[12.5px]", row.kind === "later" ? "text-muted" : "font-medium text-fg")}>
                    <time dateTime={row.date}>{dayLabel(row)}</time>
                    <span className="ml-1.5 text-[11.5px] text-faint">{t("orders", { count: row.order_count })}</span>
                  </span>
                  <span aria-hidden className="col-span-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-raised sm:col-span-1 sm:row-start-auto">
                    <span className="block h-full rounded-full bg-good/70" style={{ width: `${Math.max(4, row.share * 100)}%` }} />
                  </span>
                  <span className="text-right font-mono text-[13px] font-semibold tabular">{money(row.net)}</span>
                </li>
              ))}
            </ul>
          )}

          {(rows.length > VISIBLE_DAYS || (data?.no_deadline.order_count ?? 0) > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-2.5 text-[12px] text-muted">
              <span>{data && data.no_deadline.order_count > 0 ? t("noDeadline", { count: data.no_deadline.order_count }) : null}</span>
              {rows.length > VISIBLE_DAYS && (
                <button type="button" onClick={() => setExpanded((v) => !v)} className="font-medium text-iris-hi hover:underline">
                  {expanded ? t("showLess") : t("showAll", { count: rows.length })}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
