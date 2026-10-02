"use client";

import { ArrowUpRight, ChevronDown, ChevronUp, ListFilter } from "lucide-react";
import { vnd } from "@/lib/api";
import { SlidePanel } from "@/components/admin/slide-panel";
import { OrderStatusBadge } from "@/components/admin/status-badge";
import type { Order } from "@/lib/types";
import { escrowHint } from "../model";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-800">{children}</dd>
    </div>
  );
}

const at = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("vi-VN") : null);

/** Read an order without leaving the list; J/K (or the arrows) step through the page. */
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
  const refunded = order?.refunded_amount ?? 0;
  const discount = order?.discount_amount ?? 0;
  const hint = order ? escrowHint(order.status, order.escrow_expires_at) : null;
  const timeline = order
    ? ([
        ["Tạo đơn", order.created_at],
        ["Đã giao", order.delivered_at],
        ["Hoàn thành", order.completed_at],
        [order.status === "delivered" ? "Nhả escrow (dự kiến)" : null, order.status === "delivered" ? order.escrow_expires_at : null],
      ].filter(([label, when]) => label && when) as [string, string][])
    : [];
  return (
    <SlidePanel isOpen={order !== null} onClose={onClose} title={order?.order_code ?? ""} width="sm">
      {order && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <OrderStatusBadge status={order.status} />
            {hint && <span className="text-[12px] text-slate-500">{hint}</span>}
            {order.has_dispute && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
                Khiếu nại {order.dispute_status === "open" ? "đang mở" : "đã đóng"}
              </span>
            )}
            <span className="flex-1" />
            <button type="button" onClick={() => onStep(-1)} aria-label="Đơn trước (K)" className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50">
              <ChevronUp size={15} />
            </button>
            <button type="button" onClick={() => onStep(1)} aria-label="Đơn sau (J)" className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50">
              <ChevronDown size={15} />
            </button>
          </div>

          <dl className="divide-y divide-slate-100">
            <Row label="Sản phẩm">
              {order.product_title ?? "—"}
              {order.variant_name && <span className="block text-[12px] text-slate-500">{order.variant_name}</span>}
            </Row>
            <Row label="Số lượng">{order.quantity.toLocaleString("vi-VN")}</Row>
            <Row label="Người mua">
              <button type="button" onClick={() => onFilterBuyer(order.buyer_id)} className="inline-flex items-center gap-1 text-left hover:text-indigo-700">
                {order.buyer_email ?? `#${order.buyer_id}`}
                <ListFilter size={12} className="text-indigo-500" aria-label="Lọc theo người mua" />
              </button>
            </Row>
            <Row label="Shop">
              <button type="button" onClick={() => onFilterSeller(order.seller_id)} className="inline-flex items-center gap-1 text-left hover:text-indigo-700">
                {order.seller_email ?? `#${order.seller_id}`}
                <ListFilter size={12} className="text-indigo-500" aria-label="Lọc theo shop" />
              </button>
            </Row>
            <Row label="Tiền">
              <span className="font-mono tabular-nums">
                {vnd(order.total_amount)}
                {discount > 0 && <span className="block text-[12px] text-slate-500">giảm {vnd(discount)} ({order.promo_code})</span>}
                {refunded > 0 && <span className="block text-[12px] text-rose-600">đã hoàn {vnd(refunded)}</span>}
              </span>
            </Row>
          </dl>

          <div>
            <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-slate-400">Dòng thời gian</h3>
            <ol className="flex flex-col gap-1.5 border-l border-slate-200 pl-3 text-[12.5px]">
              {timeline.map(([label, when]) => (
                <li key={label}>
                  <span className="font-mono text-slate-500">{at(when)}</span> <span className="text-slate-800">{label}</span>
                </li>
              ))}
              {order.cancel_reason && <li className="text-rose-700">Lý do huỷ: {order.cancel_reason}</li>}
            </ol>
          </div>

          <button
            type="button"
            onClick={(e) => onOpen(order.id, e)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-indigo-700"
          >
            Mở hồ sơ đơn — hoàn tiền, nhả, gia hạn escrow
            <ArrowUpRight size={14} />
          </button>
        </div>
      )}
    </SlidePanel>
  );
}
