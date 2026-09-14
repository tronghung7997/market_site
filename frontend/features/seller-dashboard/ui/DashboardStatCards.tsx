"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import type { SellerDashboard } from "@/lib/types";
import { Card } from "@/components/ui";
import { Check, Inbox, Wallet, WalletCards } from "@/components/Icons";
import { percentDelta } from "../model";

function DeltaChip({ current, previous }: { current: number; previous: number }) {
  const t = useTranslations("sellerDashboard");
  const delta = percentDelta(current, previous);
  if (delta === null) {
    return <span className="text-[11px] text-faint">{t("noBaseline")}</span>;
  }
  const up = delta > 0;
  const flat = delta === 0;
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular",
        flat ? "bg-raised text-muted" : up ? "bg-good-soft text-good" : "bg-bad-soft text-bad",
      )}
      title={t("vsPrevious")}
    >
      {flat ? "0%" : `${up ? "+" : "−"}${Math.abs(delta)}%`}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  delta,
  sub,
  tone,
}: {
  icon: typeof Inbox;
  label: string;
  value: string;
  delta?: { current: number; previous: number };
  sub: string;
  tone?: "warn" | "bad";
}) {
  return (
    <Card className="flex flex-col gap-2.5 p-5">
      <div className="flex items-center gap-2 text-[12px] text-faint">
        <Icon size={14} /> {label}
      </div>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="font-mono text-[24px] font-semibold leading-none tabular">{value}</span>
        {delta && <DeltaChip current={delta.current} previous={delta.previous} />}
      </div>
      <div className={cn("text-[12px]", tone === "warn" ? "font-medium text-warn" : tone === "bad" ? "font-medium text-bad" : "text-muted")}>
        {sub}
      </div>
    </Card>
  );
}

export function DashboardStatCards({ data }: { data: SellerDashboard }) {
  const t = useTranslations("sellerDashboard");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const money = (v: number) => formatBrowseMoney(v, { locale });
  const { money: m, orders: o } = data;

  const completion = o.completion_rate === null ? null : Math.round(o.completion_rate * 100);
  const completionPrev = o.total_prev > 0 ? Math.round((o.completed_prev / o.total_prev) * 100) : 0;
  const cancelled = o.by_status.cancelled ?? 0;
  const refunded = o.by_status.refunded ?? 0;
  const problems = cancelled + refunded + o.dispute_count;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={Wallet}
        label={t("netTitle")}
        value={money(m.net_released)}
        delta={{ current: m.net_released, previous: m.net_released_prev }}
        sub={t("netSub", { gross: money(m.gross), fee: money(m.platform_fee), refunded: money(m.refunded) })}
      />
      <StatCard
        icon={Inbox}
        label={t("ordersTitle")}
        value={o.total.toLocaleString(locale)}
        delta={{ current: o.total, previous: o.total_prev }}
        sub={m.escrow_orders > 0
          ? t("ordersSubEscrow", { count: m.escrow_orders, amount: money(m.escrow_held) })
          : t("ordersSubNoEscrow")}
        tone={m.escrow_orders > 0 ? "warn" : undefined}
      />
      <StatCard
        icon={Check}
        label={t("completionTitle")}
        value={completion === null ? "—" : `${completion}%`}
        delta={completion === null ? undefined : { current: completion, previous: completionPrev }}
        sub={t("completionSub", {
          completed: o.by_status.completed ?? 0,
          total: o.total,
          cancelled,
          refunded,
          disputed: o.dispute_count,
        })}
        tone={problems > 0 && o.total > 0 && problems / o.total >= 0.2 ? "warn" : undefined}
      />
      <StatCard
        icon={WalletCards}
        label={t("walletTitle")}
        value={money(m.wallet.available)}
        sub={t("walletSub", { pending: money(m.pending_withdrawals), locked: money(m.wallet.locked) })}
      />
    </div>
  );
}
