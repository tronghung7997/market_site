"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { SlidePanel } from "@/components/admin/slide-panel";
import { OrderStatusBadge, DisputeStatusBadge } from "@/components/admin/status-badge";
import { InfoTip } from "@/components/admin";
import { ChevronDown, ChevronUp, ExternalLink, ListFilter } from "@/components/Icons";
import type { AdminOrderCase, Order } from "@/lib/types";
import { escrowHint, formatSpan } from "../model";

const ESCROW_STATE: Record<string, { label: string; tone: string }> = {
  awaiting_delivery: { label: "Chờ giao hàng · tiền đang giữ", tone: "text-warn" },
  held: { label: "Đang giữ · chờ trả seller", tone: "text-iris-hi" },
  released: { label: "Đã trả seller", tone: "text-good" },
  refunded: { label: "Đã hoàn khách", tone: "text-bad" },
  settled: { label: "Đã quyết toán", tone: "text-good" },
};
const TIER: Record<string, string> = { new: "Mới", verified: "Đã xác minh", trusted: "Uy tín", enterprise: "Doanh nghiệp" };
const TASK_STATUS: Record<string, string> = {
  pending: "chờ", assigned: "đã giao việc", processing: "đang làm", completed: "xong", failed: "lỗi", cancelled: "huỷ",
};

const pct = (rate: number) => `${(rate * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
const at = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("vi-VN") : null);

function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="flex items-start text-muted">
        {label}
        {help && <InfoTip label={label} text={help} />}
      </dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 flex items-center text-[11.5px] font-semibold uppercase tracking-wide text-faint">
        {title}
        {help && <InfoTip label={title} text={help} />}
      </h3>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Đang tải hồ sơ đơn">
      {[70, 90, 55, 80].map((w) => <div key={w} className="h-3.5 animate-pulse rounded bg-raised" style={{ width: `${w}%` }} />)}
    </div>
  );
}

/** Money trail, delivery, parties' track record, disputes and tasks — loaded
 *  from the case endpoint (shared cache with the full order page). */
function CaseDetails({ c }: { c: AdminOrderCase }) {
  const m = c.money;
  const escrow = ESCROW_STATE[m.escrow_state] ?? { label: m.escrow_state, tone: "text-muted" };
  const sellerGets = m.released_to_seller > 0 ? m.released_to_seller : m.projected_seller_payout;
  const fee = m.platform_fee > 0 ? m.platform_fee : m.projected_platform_fee;
  const lines = c.lines ?? [];
  const claimed = lines.filter((l) => l.claimed).length;
  const refundedLines = lines.filter((l) => l.refunded).length;
  const tasks = c.tasks ?? [];
  const br = c.buyer_record;
  const sr = c.seller_record;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Dòng tiền" help="Khách trả bao nhiêu, tiền đang ở đâu, seller nhận bao nhiêu sau phí sàn. Khi chưa trả seller, số seller nhận và phí là số dự kiến.">
        <dl className="divide-y divide-line">
          <Row label="Trạng thái tiền">
            <span className={cn("font-medium", escrow.tone)}>{escrow.label}</span>
            {m.escrow_overdue && <span className="block text-[12px] text-warn">Hết hạn giữ, chờ hệ thống trả seller (job chạy mỗi 30 phút)</span>}
          </Row>
          <Row label="Khách trả">
            <span className="font-mono tabular-nums">{vnd(m.total)}</span>
            {m.discount > 0 && <span className="block text-[12px] text-muted">đã giảm {vnd(m.discount)}{c.promo_code ? ` (mã ${c.promo_code})` : ""} · sàn bù seller {vnd(m.promo_subsidy)}</span>}
          </Row>
          {m.refunded > 0 && <Row label="Đã hoàn khách"><span className="font-mono tabular-nums text-bad">{vnd(m.refunded)}</span></Row>}
          {sellerGets != null && (
            <Row label={m.released_to_seller > 0 ? "Seller đã nhận" : "Seller sẽ nhận"}>
              <span className="font-mono tabular-nums">{vnd(sellerGets)}</span>
            </Row>
          )}
          {fee != null && (
            <Row label="Phí sàn" help="Phần sàn giữ lại khi trả seller, theo phí của danh mục/hạng seller.">
              <span className="font-mono tabular-nums">{vnd(fee)}</span>
              <span className="ml-1 text-[12px] text-muted">({m.fee_percent.toLocaleString("vi-VN")}%)</span>
            </Row>
          )}
        </dl>
      </Section>

      {(lines.length > 0 || c.provider) && (
        <Section title="Giao hàng">
          <dl className="divide-y divide-line">
            {lines.length > 0 && (
              <Row label="Đã giao" help="Số dòng hàng (tài khoản, key, proxy…) đã giao cho đơn này. Nội dung chỉ xem trong hồ sơ đơn.">
                {lines.length.toLocaleString("vi-VN")} dòng
                {claimed > 0 && <span className="text-muted"> · khách đã lấy {claimed}</span>}
                {refundedLines > 0 && <span className="text-bad"> · {refundedLines} dòng đã hoàn</span>}
              </Row>
            )}
            {c.provider && (
              <Row label="Nguồn hàng">
                {c.provider.name}
                {!c.provider.is_active && <span className="ml-1.5 text-[12px] text-warn">(đang tắt)</span>}
              </Row>
            )}
          </dl>
        </Section>
      )}

      <Section title="Người mua & shop" help="Lịch sử để đánh giá nhanh độ tin cậy: số đơn đã trả tiền và tỉ lệ khiếu nại.">
        <dl className="divide-y divide-line">
          {c.buyer && (
            <Row label="Người mua">
              <span className="text-muted">
                tài khoản từ {new Date(c.buyer.created_at).toLocaleDateString("vi-VN")}
                {!c.buyer.is_active && <span className="text-bad"> · đang khoá</span>}
              </span>
              {br && (
                <span className="block text-[12px] text-muted">
                  {br.paid_orders.toLocaleString("vi-VN")} đơn đã trả · khiếu nại 90 ngày {br.disputes_90d} ({pct(br.dispute_rate)})
                  {br.won + br.rejected > 0 && ` · thắng ${br.won}/${br.won + br.rejected}`}
                </span>
              )}
            </Row>
          )}
          {c.seller && (
            <Row label="Shop">
              <span className="text-muted">
                hạng {TIER[c.seller.tier] ?? c.seller.tier}
                {c.seller.is_internal && " · nội bộ"}
                {!c.seller.is_active && <span className="text-bad"> · đang khoá</span>}
              </span>
              {sr && (
                <span className="block text-[12px] text-muted">
                  90 ngày: {sr.paid_orders_90d.toLocaleString("vi-VN")} đơn · khiếu nại {pct(sr.dispute_rate_90d)}
                  {sr.open_disputes > 0 && <span className="text-warn"> · {sr.open_disputes} đang mở</span>}
                  {sr.avg_response_hours != null && ` · phản hồi TB ${formatSpan(sr.avg_response_hours * 3_600_000)}`}
                </span>
              )}
            </Row>
          )}
        </dl>
      </Section>

      {c.disputes.length > 0 && (
        <Section title={`Khiếu nại · ${c.disputes.length}`}>
          <ul className="flex flex-col gap-1.5">
            {c.disputes.map((d) => (
              <li key={d.id} className="flex items-start gap-2 text-[12.5px]">
                <DisputeStatusBadge status={d.status} />
                <Link href={d.href} className="min-w-0 flex-1 truncate text-fg hover:text-iris-hi hover:underline" title={d.reason}>
                  {d.reason}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {tasks.length > 0 && (
        <Section title={`Tác vụ giao hàng · ${tasks.length}`}>
          <p className="text-[12.5px] text-muted">
            {Object.entries(tasks.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {}))
              .map(([st, n]) => `${n} ${TASK_STATUS[st] ?? st}`).join(" · ")}
            {tasks[0]?.assignee && ` · người làm: ${tasks[0].assignee}`}
          </p>
        </Section>
      )}
    </div>
  );
}

/** Read an order without leaving the list; J/K step through the visible rows. */
export function OrderQuickView({
  order,
  onClose,
  onStep,
  onOpen,
  onFilterBuyer,
  onFilterSeller,
}: {
  order: Order | null;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  /** Opens the full case page (Cmd/Ctrl-click: a new tab). */
  onOpen: (id: number, event: React.MouseEvent) => void;
  onFilterBuyer: (id: number) => void;
  onFilterSeller: (id: number) => void;
}) {
  // Same cache key as the full order page: opening it next is instant.
  const caseQ = useQuery({
    queryKey: ["admin", "order-case", order?.id ?? 0],
    queryFn: () => api.adminOrderCase(order!.id),
    enabled: order !== null,
    staleTime: 30_000,
  });
  const hint = order ? escrowHint(order.status, order.escrow_expires_at) : null;
  const timeline = order
    ? ([
        ["Tạo đơn", order.created_at],
        ["Đã giao", order.delivered_at],
        ["Hoàn thành", order.completed_at],
        [order.status === "delivered" ? "Trả tiền cho seller (dự kiến)" : null, order.status === "delivered" ? order.escrow_expires_at : null],
      ].filter(([label, when]) => label && when) as [string, string][])
    : [];
  return (
    <SlidePanel isOpen={order !== null} onClose={onClose} title={order?.order_code ?? ""} width="md">
      {order && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} />
            {hint && <span className="text-[12px] text-muted">{hint}</span>}
            <span className="flex-1" />
            <span className="hidden text-[11px] text-faint sm:inline">J / K: đơn sau / trước</span>
            <button type="button" onClick={() => onStep(-1)} aria-label="Đơn trước (K)" className="rounded-md border border-line p-1 text-muted hover:bg-raised">
              <ChevronUp size={15} />
            </button>
            <button type="button" onClick={() => onStep(1)} aria-label="Đơn sau (J)" className="rounded-md border border-line p-1 text-muted hover:bg-raised">
              <ChevronDown size={15} />
            </button>
          </div>

          <dl className="divide-y divide-line">
            <Row label="Sản phẩm">
              {order.product_title ?? "—"}
              {order.variant_name && <span className="block text-[12px] text-muted">{order.variant_name}</span>}
            </Row>
            <Row label="Số lượng">
              {order.quantity.toLocaleString("vi-VN")}
              {order.quantity > 1 && <span className="ml-1 text-[12px] text-muted">· {vnd(Math.round(order.total_amount / order.quantity))} / cái</span>}
            </Row>
            <Row label="Người mua">
              <button type="button" onClick={() => onFilterBuyer(order.buyer_id)} className="inline-flex items-center gap-1 text-left hover:text-iris-hi">
                {order.buyer_email ?? `#${order.buyer_id}`}
                <ListFilter size={12} className="text-iris-hi" aria-label="Lọc theo người mua" />
              </button>
            </Row>
            <Row label="Shop">
              <button type="button" onClick={() => onFilterSeller(order.seller_id)} className="inline-flex items-center gap-1 text-left hover:text-iris-hi">
                {order.seller_email ?? `#${order.seller_id}`}
                <ListFilter size={12} className="text-iris-hi" aria-label="Lọc theo shop" />
              </button>
            </Row>
          </dl>

          {caseQ.isError ? (
            <p className="text-[12.5px] text-bad">
              Không tải được chi tiết đơn.{" "}
              <button type="button" onClick={() => caseQ.refetch()} className="underline">Thử lại</button>
            </p>
          ) : caseQ.data && caseQ.data.id === order.id ? (
            <CaseDetails c={caseQ.data} />
          ) : (
            <Skeleton />
          )}

          <Section title="Dòng thời gian">
            <ol className="flex flex-col gap-1.5 border-l border-line pl-3 text-[12.5px]">
              {timeline.map(([label, when]) => (
                <li key={label}>
                  <span className="font-mono text-muted">{at(when)}</span> <span className="text-fg">{label}</span>
                </li>
              ))}
              {order.cancel_reason && <li className="text-bad">Lý do huỷ: {order.cancel_reason}</li>}
            </ol>
          </Section>

          <button
            type="button"
            onClick={(e) => onOpen(order.id, e)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-iris px-3 py-2 text-[13px] font-medium text-white hover:brightness-110"
          >
            Mở hồ sơ đơn — hoàn tiền, trả seller ngay, gia hạn giữ tiền
            <ExternalLink size={14} />
          </button>
        </div>
      )}
    </SlidePanel>
  );
}
