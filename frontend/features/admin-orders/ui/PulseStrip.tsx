"use client";

import { vnd } from "@/lib/api";
import { InfoTip } from "@/components/admin";
import type { AdminOrdersPulse } from "@/lib/types";
import { delta, disputeRate, DISPUTE_RATE_WARN, formatWhen } from "../model";

const DELTA_TONE = { up: "text-good", down: "text-bad", flat: "text-faint" } as const;

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
            className={i === values.length - 1 ? "fill-iris" : "fill-line-2"}
          />
        );
      })}
    </svg>
  );
}

function Tile({
  label,
  help,
  children,
  foot,
  onClick,
  warn,
}: {
  label: string;
  /** Short explanation behind the "?" next to the label. */
  help: string;
  children: React.ReactNode;
  foot: React.ReactNode;
  onClick?: () => void;
  warn?: boolean;
}) {
  const figure = (
    <>
      {children}
      <span className={`block truncate text-[11.5px] ${warn ? "text-warn" : "text-muted"}`}>{foot}</span>
    </>
  );
  // The "?" is its own button, so the clickable part is only the figure below
  // the label (never a button inside a button).
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 px-3.5 py-3 ${warn ? "bg-warn-soft" : "bg-surface"}`}>
      <span className={`flex items-center text-[11.5px] font-medium uppercase tracking-wide ${warn ? "text-warn" : "text-faint"}`}>
        {label}
        <InfoTip label={label} text={help} />
      </span>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="-mx-1 flex min-w-0 flex-col gap-0.5 rounded-md px-1 text-left transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          {figure}
        </button>
      ) : figure}
    </div>
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
      <div className="h-[86px] animate-pulse rounded-xl border border-line bg-raised" aria-busy="true" aria-label="Đang tải số liệu" />
    );
  }
  const countDelta = delta(pulse.today_count, pulse.yesterday_count);
  const valueDelta = delta(pulse.today_value, pulse.yesterday_value);
  const rate = pulse.orders_7d > 0 ? pulse.disputes_7d / pulse.orders_7d : 0;
  return (
    // One segmented surface (DESIGN §10), not five floating cards.
    <section aria-label="Tình hình đơn hàng" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
      <Tile
        label="Đơn hôm nay"
        help="Số đơn đặt từ 0 giờ hôm nay (giờ của bạn), so với hôm qua tính tới cùng giờ này. Cột nhỏ bên phải là số đơn từng ngày trong 7 ngày, cột tím là hôm nay. Không tính đơn seed."
        foot={<>so với hôm qua cùng giờ: {pulse.yesterday_count.toLocaleString("vi-VN")}</>}
      >
        <span className="flex items-end justify-between gap-2">
          <span className="font-mono text-[22px] font-semibold leading-7 tabular-nums text-fg">
            {pulse.today_count.toLocaleString("vi-VN")}
            <span className={`ml-1.5 text-[12px] font-medium ${DELTA_TONE[countDelta.tone]}`}>{countDelta.label}</span>
          </span>
          <span title={`7 ngày: ${pulse.spark.join(" · ")}`}>
            <Spark values={pulse.spark} />
          </span>
        </span>
      </Tile>
      <Tile label="Giá trị hôm nay"
        help="Tổng tiền khách trả cho các đơn đặt hôm nay, so với hôm qua tới cùng giờ. Là doanh số qua sàn, không phải doanh thu của sàn." foot={<>hôm qua cùng giờ: {vnd(pulse.yesterday_value)}</>}>
        <span className="font-mono text-[19px] font-semibold leading-7 tabular-nums text-fg">
          {vnd(pulse.today_value)}
          <span className={`ml-1.5 text-[11.5px] font-medium ${DELTA_TONE[valueDelta.tone]}`}>
            {valueDelta.tone === "flat" ? "" : valueDelta.tone === "up" ? "▲" : "▼"}
          </span>
        </span>
      </Tile>
      <Tile
        label="Đang giữ escrow"
        help="Tiền khách đã trả cho các đơn chưa trả cho seller (chờ xử lý, đang giao, chờ hết hạn giữ, đang khiếu nại). Khi hết hạn giữ mà không có khiếu nại, hệ thống tự trả tiền cho seller."
        foot={
          pulse.escrow_count === 0
            ? "không có tiền đơn nào đang giữ"
            : <>{pulse.escrow_count.toLocaleString("vi-VN")} đơn chưa giải ngân{pulse.next_release_at ? ` · lần trả seller kế tiếp ${formatWhen(pulse.next_release_at)}` : ""}</>
        }
      >
        <span className="font-mono text-[19px] font-semibold leading-7 tabular-nums text-fg">
          {vnd(pulse.escrow_amount)}
        </span>
      </Tile>
      <Tile
        label="Cần xử lý"
        help="Việc cần người xem ngay: khiếu nại đang mở, đơn tự động chờ quá 15 phút (đơn giao thủ công: quá 24 giờ), và cụm đơn (1 người mua đặt ≥10 đơn ở 1 shop trong 30 phút). Bấm số để xem danh sách."
        warn={attentionCount > 0}
        onClick={attentionCount > 0 ? onAttention : undefined}
        foot={
          attentionCount > 0
            ? `${pulse.disputed.length} khiếu nại · ${pulse.stuck.length} kẹt · ${pulse.bursts.length} cụm`
            : "không có việc tồn"
        }
      >
        <span className="font-mono text-[22px] font-semibold leading-7 tabular-nums text-fg">{attentionCount}</span>
      </Tile>
      <Tile
        label="Khiếu nại 7 ngày"
        help="Trong các đơn đặt 7 ngày qua, bao nhiêu % đã bị khiếu nại (mỗi đơn tính 1 lần). Vượt ngưỡng 3% thì ô chuyển màu cảnh báo."
        warn={rate > DISPUTE_RATE_WARN}
        foot={`${pulse.disputes_7d} / ${pulse.orders_7d.toLocaleString("vi-VN")} đơn đặt trong 7 ngày bị khiếu nại · ngưỡng ${DISPUTE_RATE_WARN * 100}%`}
      >
        <span className="font-mono text-[22px] font-semibold leading-7 tabular-nums text-fg">
          {disputeRate(pulse.disputes_7d, pulse.orders_7d)}
        </span>
      </Tile>
    </section>
  );
}
