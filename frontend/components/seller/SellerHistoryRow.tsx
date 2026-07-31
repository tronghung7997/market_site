"use client";

/* Một dòng "Lịch sử" cho seller — đơn đã sống qua giai đoạn cần-hành-động
 * (delivered/completed). Gọn khi đóng, bung ra timeline + dữ liệu đã giao +
 * dashboard/tài nguyên + khiếu nại (nếu có) khi bấm — thay bảng phẳng cũ vốn
 * không cho xem lại gì đã giao cho khách. */

import { useState } from "react";
import { vnd } from "@/lib/api";
import { orderStatus } from "@/lib/order-status";
import type { Order } from "@/lib/types";
import ServiceDashboard from "@/components/ServiceDashboard";
import { StatusTimeline, OrderResources, OrderDispute } from "@/components/orders/OrderCardPrimitives";
import { Card, CopyButton, Monogram, Tag } from "@/components/ui";
import { ChevronRight, Star } from "@/components/Icons";

export default function SellerHistoryRow({ order: o }: { order: Order }) {
  const st = orderStatus(o.status);
  const [open, setOpen] = useState(false);

  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised/60 transition-colors cursor-pointer"
      >
        <Monogram text={o.product_title ?? "??"} className="h-8 w-8 text-[12px] text-faint shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-medium truncate">{o.product_title ?? `Đơn #${o.id}`}</span>
            <Tag tone={st.tone}>{st.label}</Tag>
            {o.status === "completed" && o.has_review && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-warn shrink-0">
                <Star size={10} className="fill-warn" /> Đã đánh giá
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-faint mt-0.5 truncate">
            Đơn #{o.id} · {new Date(o.created_at).toLocaleDateString("vi-VN")}
            {o.buyer_email && <> · {o.buyer_email}</>}
          </p>
        </div>
        <span className="font-mono text-[13px] font-medium tabular shrink-0">{vnd(o.total_amount)}</span>
        <ChevronRight size={14} className={`text-faint shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-line">
          {o.status === "delivered" && o.escrow_expires_at && (
            <p className="text-[12px] text-muted mt-2.5">
              Ký quỹ giữ đến {new Date(o.escrow_expires_at).toLocaleString("vi-VN")} — sau đó tự chuyển cho bạn nếu khách không xác nhận hoặc khiếu nại.
            </p>
          )}

          <div className="rounded-lg bg-raised/60 border border-line/70">
            <StatusTimeline status={o.status} />
          </div>

          {o.delivered_data && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10.5px] text-faint uppercase tracking-wider">Đã bàn giao</span>
                <CopyButton text={o.delivered_data} />
              </div>
              <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-2.5 whitespace-pre-wrap break-all">{o.delivered_data}</pre>
            </div>
          )}

          {o.has_dispute && <OrderDispute orderId={o.id} />}

          <ServiceDashboard orderId={o.id} viewerRole="seller" />
          <OrderResources orderId={o.id} />
        </div>
      )}
    </Card>
  );
}
