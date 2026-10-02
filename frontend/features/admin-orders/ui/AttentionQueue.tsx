"use client";

import * as React from "react";
import { AlertTriangle, ChevronRight, Clock, Layers } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { vnd } from "@/lib/api";
import type { AdminOrderBurst, AdminOrdersPulse, Order } from "@/lib/types";
import { formatSpan, formatWhen } from "../model";

const KIND = {
  dispute: { label: "Khiếu nại", icon: AlertTriangle, tone: "bg-rose-100 text-rose-700" },
  stuck: { label: "Kẹt", icon: Clock, tone: "bg-amber-100 text-amber-800" },
  burst: { label: "Cụm đơn", icon: Layers, tone: "bg-violet-100 text-violet-700" },
} as const;

function Kind({ kind }: { kind: keyof typeof KIND }) {
  const { label, icon: Icon, tone } = KIND[kind];
  return (
    <span className={`inline-flex w-[88px] shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
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
        className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors hover:bg-white"
      >
        <Kind kind={kind} />
        <span className="w-[110px] shrink-0 font-mono text-slate-700">{order.order_code}</span>
        <span className="min-w-0 flex-1 truncate text-slate-700">
          {order.product_title ?? "—"}
          {order.variant_name ? <span className="text-slate-400"> · {order.variant_name}</span> : null}
        </span>
        <span className="hidden truncate text-slate-500 md:block md:max-w-[220px]">{order.buyer_email}</span>
        <span className="w-[86px] shrink-0 text-right font-mono tabular-nums text-slate-700">{vnd(order.total_amount)}</span>
        <span className="w-[92px] shrink-0 text-right text-slate-500">
          {kind === "stuck" ? `${order.status === "pending" ? "chờ" : "xử lý"} ${age}` : `mở ${age}`}
        </span>
        <ChevronRight size={14} className="shrink-0 text-slate-300" aria-hidden="true" />
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
        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-white"
      >
        <Kind kind="burst" />
        <span className="min-w-0 flex-1 truncate text-slate-700">
          <span className="font-medium">{burst.buyer_email ?? `#${burst.buyer_id}`}</span>
          {burst.new_buyer && (
            <span className="ml-1.5 rounded bg-amber-100 px-1 py-px text-[10.5px] font-medium text-amber-800">TK mới</span>
          )}
          <span className="text-slate-400"> mua </span>
          <span className="font-medium">{burst.count} đơn</span>
          <span className="text-slate-400"> trong {span} tại </span>
          {burst.seller_email ?? `#${burst.seller_id}`}
        </span>
        <span className="w-[86px] shrink-0 text-right font-mono tabular-nums text-slate-700">{vnd(burst.amount)}</span>
        <span className="w-[92px] shrink-0 text-right text-slate-500">{formatWhen(burst.last_at)}</span>
        <span className="shrink-0 text-[11.5px] font-medium text-indigo-600">Lọc cụm</span>
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
      className="scroll-mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-2"
    >
      <h2 id="attention-title" className="px-2 pb-1 pt-0.5 text-[12.5px] font-semibold text-amber-900">
        Cần xử lý <span className="font-mono tabular-nums">{total}</span>
        <span className="ml-2 font-normal text-amber-800/80">
          khiếu nại đang mở · đơn chờ quá 15 phút · 1 người mua ≥10 đơn ở 1 shop trong 30 phút
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
