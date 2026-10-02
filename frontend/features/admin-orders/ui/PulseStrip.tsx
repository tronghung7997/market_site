"use client";

import { vnd } from "@/lib/api";
import type { AdminOrdersPulse } from "@/lib/types";
import { delta, disputeRate, DISPUTE_RATE_WARN, formatWhen } from "../model";

const DELTA_TONE = { up: "text-emerald-600", down: "text-rose-600", flat: "text-slate-400" } as const;

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <svg viewBox="0 0 70 20" className="h-5 w-[70px]" aria-hidden="true">
      {values.map((v, i) => {
        const h = Math.max(1.5, (v / max) * 18);
        return (
          <rect
            key={i}
            x={i * 10}
            y={20 - h}
            width={7}
            height={h}
            rx={1}
            className={i === values.length - 1 ? "fill-indigo-500" : "fill-slate-300"}
          />
        );
      })}
    </svg>
  );
}

function Tile({
  label,
  children,
  foot,
  onClick,
  warn,
}: {
  label: string;
  children: React.ReactNode;
  foot: React.ReactNode;
  onClick?: () => void;
  warn?: boolean;
}) {
  const cls = `flex min-w-0 flex-col gap-0.5 rounded-xl border px-3.5 py-3 text-left ${
    warn ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"
  } ${onClick ? "transition-colors hover:border-indigo-300" : ""}`;
  const body = (
    <>
      <span className={`text-[11.5px] font-medium uppercase tracking-wide ${warn ? "text-amber-800" : "text-slate-400"}`}>
        {label}
      </span>
      {children}
      <span className={`truncate text-[11.5px] ${warn ? "text-amber-800" : "text-slate-500"}`}>{foot}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Today vs yesterday, money in escrow, dispute rate and the attention count. */
export function PulseStrip({
  pulse,
  attentionCount,
  onAttention,
}: {
  pulse: AdminOrdersPulse | undefined;
  attentionCount: number;
  onAttention: () => void;
}) {
  if (!pulse) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[86px] animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    );
  }
  const countDelta = delta(pulse.today_count, pulse.yesterday_count);
  const valueDelta = delta(pulse.today_value, pulse.yesterday_value);
  const rate = pulse.orders_7d > 0 ? pulse.disputes_7d / pulse.orders_7d : 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Tile
        label="Đơn hôm nay"
        foot={<>so với hôm qua cùng giờ: {pulse.yesterday_count.toLocaleString("vi-VN")}</>}
      >
        <span className="flex items-end justify-between gap-2">
          <span className="font-mono text-[22px] font-semibold leading-7 tabular-nums text-slate-900">
            {pulse.today_count.toLocaleString("vi-VN")}
            <span className={`ml-1.5 text-[12px] font-medium ${DELTA_TONE[countDelta.tone]}`}>{countDelta.label}</span>
          </span>
          <span title={`7 ngày: ${pulse.spark.join(" · ")}`}>
            <Spark values={pulse.spark} />
          </span>
        </span>
      </Tile>
      <Tile label="Giá trị hôm nay" foot={<>hôm qua cùng giờ: {vnd(pulse.yesterday_value)}</>}>
        <span className="font-mono text-[19px] font-semibold leading-7 tabular-nums text-slate-900">
          {vnd(pulse.today_value)}
          <span className={`ml-1.5 text-[11.5px] font-medium ${DELTA_TONE[valueDelta.tone]}`}>
            {valueDelta.tone === "flat" ? "" : valueDelta.tone === "up" ? "▲" : "▼"}
          </span>
        </span>
      </Tile>
      <Tile
        label="Đang giữ escrow"
        foot={
          pulse.escrow_count === 0
            ? "không có đơn chờ nhả"
            : <>{pulse.escrow_count.toLocaleString("vi-VN")} đơn{pulse.next_release_at ? ` · nhả sớm nhất ${formatWhen(pulse.next_release_at)}` : ""}</>
        }
      >
        <span className="font-mono text-[19px] font-semibold leading-7 tabular-nums text-slate-900">
          {vnd(pulse.escrow_amount)}
        </span>
      </Tile>
      <Tile
        label="Cần xử lý"
        warn={attentionCount > 0}
        onClick={attentionCount > 0 ? onAttention : undefined}
        foot={
          attentionCount > 0
            ? `${pulse.disputed.length} khiếu nại · ${pulse.stuck.length} kẹt · ${pulse.bursts.length} cụm`
            : "không có việc tồn"
        }
      >
        <span className="font-mono text-[22px] font-semibold leading-7 tabular-nums text-slate-900">{attentionCount}</span>
      </Tile>
      <Tile
        label="Khiếu nại 7 ngày"
        warn={rate > DISPUTE_RATE_WARN}
        foot={`${pulse.disputes_7d} / ${pulse.orders_7d.toLocaleString("vi-VN")} đơn · ngưỡng ${DISPUTE_RATE_WARN * 100}%`}
      >
        <span className="font-mono text-[22px] font-semibold leading-7 tabular-nums text-slate-900">
          {disputeRate(pulse.disputes_7d, pulse.orders_7d)}
        </span>
      </Tile>
    </div>
  );
}
