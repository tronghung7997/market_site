"use client";

import * as React from "react";
import { AlertTriangle, ChevronRight, Clock, Layers } from "@/components/Icons";
import { Link } from "@/i18n/navigation";
import { vnd } from "@/lib/api";
import type { AdminOrderBurst, AdminOrdersPulse, Order } from "@/lib/types";
import { formatSpan, formatWhen } from "../model";

const KIND = {
  dispute: { label: "Khiếu nại", icon: AlertTriangle, tone: "bg-bad-soft text-bad" },
  stuck: { label: "Kẹt", icon: Clock, tone: "bg-warn-soft text-warn" },
  burst: { label: "Cụm đơn", icon: Layers, tone: "bg-iris-soft text-iris-hi" },
} as const;

function Kind({ kind }: { kind: keyof typeof KIND }) {
  const { label, icon: Icon, tone } = KIND[kind];
  return (
    <span className={`inline-flex shrink-0 items-center sm:w-[88px] gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

function OrderLine({ kind, order, now }: { kind: "dispute" | "stuck"; order: Order; now: number }) {
  const age = formatSpan(now - new Date(order.created_at).getTime());
  return (
    <li>
      <Link
        href={`/admin/orders/${order.id}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors hover:bg-surface sm:flex-nowrap"
      >
        <Kind kind={kind} />
        <span className="shrink-0 font-mono text-fg sm:w-[110px]">{order.order_code}</span>
        <span className="order-last min-w-0 basis-full truncate text-fg sm:order-none sm:flex-1 sm:basis-auto">
          {order.product_title ?? "—"}
          {order.variant_name ? <span className="text-faint"> · {order.variant_name}</span> : null}
        </span>
        <span className="hidden truncate text-muted md:block md:max-w-[220px]">{order.buyer_email}</span>
        <span className="ml-auto shrink-0 text-right font-mono tabular-nums text-fg sm:ml-0 sm:w-[86px]">{vnd(order.total_amount)}</span>
        <span className="shrink-0 text-right text-muted sm:w-[92px]">
          {kind === "stuck" ? `${order.status === "pending" ? "chờ" : "xử lý"} ${age}` : `mở ${age}`}
        </span>
        <ChevronRight size={14} className="hidden shrink-0 text-faint sm:block" aria-hidden="true" />
      </Link>
    </li>
  );
}

function BurstLine({ burst, onFilter }: { burst: AdminOrderBurst; onFilter: (b: AdminOrderBurst) => void }) {
  const span = formatSpan(new Date(burst.last_at).getTime() - new Date(burst.first_at).getTime());
  return (
    <li>
      <button
        type="button"
        onClick={() => onFilter(burst)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-surface sm:flex-nowrap"
      >
        <Kind kind="burst" />
        <span className="order-last min-w-0 basis-full text-fg sm:order-none sm:flex-1 sm:basis-auto sm:truncate">
          <span className="font-medium">{burst.buyer_email ?? `#${burst.buyer_id}`}</span>
          {burst.new_buyer && (
            <span className="ml-1.5 rounded bg-warn-soft px-1 py-px text-[10.5px] font-medium text-warn">TK mới</span>
          )}
          <span className="text-faint"> mua </span>
          <span className="font-medium">{burst.peak} đơn trong 30 phút</span>
          <span className="text-faint"> ({burst.count} đơn / 24 giờ, từ đơn đầu tới cuối {span}) tại </span>
          {burst.seller_email ?? `#${burst.seller_id}`}
        </span>
        <span className="ml-auto shrink-0 text-right font-mono tabular-nums text-fg sm:ml-0 sm:w-[86px]">{vnd(burst.amount)}</span>
        <span className="shrink-0 text-right text-muted sm:w-[92px]">{formatWhen(burst.last_at)}</span>
        <span className="shrink-0 text-[11.5px] font-medium text-iris-hi">Lọc cụm</span>
      </button>
    </li>
  );
}

/** What needs a human now. Hidden when there is nothing. */
export const AttentionQueue = React.forwardRef<
  HTMLElement,
  { pulse: AdminOrdersPulse; onFilterBurst: (b: AdminOrderBurst) => void }
>(function AttentionQueue({ pulse, onFilterBurst }, ref) {
  // Ages are computed against one "now" per render of fresh data.
  const now = React.useMemo(() => Date.now(), [pulse]);
  const total = pulse.disputed.length + pulse.stuck.length + pulse.bursts.length;
  if (total === 0) return null;
  return (
    <section
      ref={ref}
      aria-labelledby="attention-title"
      className="scroll-mt-4 rounded-xl border border-warn/30 bg-warn-soft p-2"
    >
      <h2 id="attention-title" className="px-2 pb-1 pt-0.5 text-[12.5px] font-semibold text-warn">
        Cần xử lý <span className="font-mono tabular-nums">{total}</span>
        <span className="ml-2 font-normal text-warn">
          khiếu nại đang mở · đơn tự động chờ quá 15 phút (giao thủ công: quá 24 giờ) · 1 người mua ≥10 đơn ở 1 shop trong 30 phút
        </span>
      </h2>
      <ul className="flex flex-col">
        {pulse.disputed.map((o) => <OrderLine key={`d${o.id}`} kind="dispute" order={o} now={now} />)}
        {pulse.stuck.map((o) => <OrderLine key={`s${o.id}`} kind="stuck" order={o} now={now} />)}
        {pulse.bursts.map((b) => <BurstLine key={`b${b.buyer_id}-${b.seller_id}`} burst={b} onFilter={onFilterBurst} />)}
      </ul>
    </section>
  );
});
