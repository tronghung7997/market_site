"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useMoney } from "@/lib/money";
import { orderStatus } from "@/lib/order-status";
import type { SellerDashboard } from "@/lib/types";
import { Card } from "@/components/ui";
import { Clock } from "@/components/Icons";
import { ORDER_STATUS_ORDER, ordersTabForStatus, type BreakdownStatus } from "../model";

// Segment colours: the status tones, with the two "waiting on you" states
// and the two "money went back" states told apart by tint. Every segment is
// also listed with its label and count, so colour is never the only cue.
const SEGMENT_COLOR: Record<BreakdownStatus, string> = {
  completed: "var(--color-good)",
  delivered: "var(--color-iris)",
  processing: "var(--color-warn)",
  pending: "color-mix(in srgb, var(--color-warn) 55%, var(--color-surface))",
  disputed: "var(--color-bad)",
  refunded: "color-mix(in srgb, var(--color-bad) 55%, var(--color-surface))",
  cancelled: "var(--color-faint)",
};

export function OrderStatusBreakdown({ data }: { data: SellerDashboard }) {
  const t = useTranslations("sellerDashboard");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const { orders } = data;
  const total = orders.total;
  const rows = ORDER_STATUS_ORDER.map((status) => ({
    status,
    count: orders.by_status[status] ?? 0,
    label: orderStatus(status, locale).label,
  }));

  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <Clock size={14} className="text-faint" /> {t("statusTitle")}
        </h3>
        <span className="text-[12px] text-faint">{t("ordersUnit", { count: total })}</span>
      </div>

      {total > 0 ? (
        <div className="flex h-[10px] gap-0.5 overflow-hidden rounded-full" role="img" aria-label={t("statusTitle")}>
          {rows.filter((r) => r.count > 0).map((r) => (
            <div
              key={r.status}
              title={`${r.label}: ${r.count}`}
              style={{ width: `${(r.count / total) * 100}%`, background: SEGMENT_COLOR[r.status] }}
            />
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-muted">{t("statusEmpty")}</div>
      )}

      <div className="grid grid-cols-1 gap-x-4 gap-y-2.5">
        {rows.map((r) => (
          <Link
            key={r.status}
            href={`/seller/orders?tab=${ordersTabForStatus(r.status)}`}
            className="flex items-center gap-2 rounded-md text-fg hover:text-iris"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEGMENT_COLOR[r.status] }} />
            <span className="text-[12.5px] text-muted">{r.label}</span>
            <span className="ml-auto font-mono text-[13px] font-semibold tabular">{r.count}</span>
            <span className="w-9 text-right font-mono text-[11px] text-faint tabular">
              {total > 0 ? `${Math.round((r.count / total) * 100)}%` : "—"}
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-line pt-3">
        <div>
          <div className="text-[11px] text-faint">{t("aov")}</div>
          <div className="font-mono text-[14px] font-semibold tabular">
            {orders.avg_order_value === null ? "—" : formatBrowseMoney(orders.avg_order_value, { locale })}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-faint">{t("disputeRate")}</div>
          <div className="font-mono text-[14px] font-semibold tabular">
            {orders.dispute_rate === null ? "—" : `${(orders.dispute_rate * 100).toFixed(1)}%`}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-faint">{t("refundedTotal")}</div>
          <div className="font-mono text-[14px] font-semibold tabular">
            {formatBrowseMoney(data.money.refunded, { locale })}
          </div>
        </div>
      </div>
    </Card>
  );
}
