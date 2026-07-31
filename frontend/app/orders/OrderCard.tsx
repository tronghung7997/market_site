"use client";

/** Card một đơn hàng trong danh sách — cụm "mọi thứ về MỘT đơn":
 *  - TerminalOrderRow: đơn kết thúc (huỷ/hoàn) nén một dòng yên tĩnh
 *  - OrderCard: đơn đang sống — biển số, timeline, dữ liệu bàn giao, panel
 *    proxy, nút xác nhận/khiếu nại, form đánh giá, dashboard & tài nguyên
 *  Mọi state chéo-đơn (đơn nào đang mở form review, toast) vẫn ở page;
 *  state riêng-từng-đơn (mở dashboard, disclosure) sống ngay trong card. */

import { useState } from "react";
import { vnd } from "@/lib/api";
import { orderStatus } from "@/lib/order-status";
import type { Order } from "@/lib/types";
import ServiceDashboard from "@/components/ServiceDashboard";
import { StatusTimeline, OrderResources, OrderDispute } from "@/components/orders/OrderCardPrimitives";
import { Button, Card, CopyButton, Disclosure, Monogram, Tag } from "@/components/ui";
import { Shield, Star } from "@/components/Icons";
import OrderProxyPanel from "./OrderProxyPanel";
import ReviewForm from "./ReviewForm";

// Đơn kết thúc (huỷ/hoàn) giờ dùng chung với seller — xem
// components/orders/OrderCardPrimitives.tsx.
export { TerminalOrderRow } from "@/components/orders/OrderCardPrimitives";

export default function OrderCard({
  order: o, confirming, plateHidden, reviewOpen, reviewDone,
  onConfirm, onOpenDispute, onOpenReview, onReviewDone, onCloseReview, onDelivered, onPlate,
}: {
  order: Order;
  /** Đang gọi API xác nhận cho chính đơn này. */
  confirming: boolean;
  /** Panel proxy đã có tấm địa chỉ → ẩn khối "Dữ liệu bàn giao" thô. */
  plateHidden: boolean;
  reviewOpen: boolean;
  /** has_review từ backend HOẶC vừa đánh giá xong trong phiên này. */
  reviewDone: boolean;
  onConfirm: (orderId: number) => void;
  onOpenDispute: (orderId: number) => void;
  onOpenReview: (orderId: number) => void;
  onReviewDone: (orderId: number, ok: boolean, message: string) => void;
  onCloseReview: () => void;
  onDelivered: (orderId: number, deliveredData: string) => void;
  onPlate: (orderId: number) => void;
}) {
  const st = orderStatus(o.status);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [askConfirm, setAskConfirm] = useState(false);
  const delivered = o.status === "delivered" || o.status === "completed";

  return (
    <Card className="p-0 overflow-hidden">
      {/* Thanh định danh — "biển số" của đơn: mã + ngày trái, trạng thái + tiền phải.
          Đây là ranh giới thị giác giữa các đơn trong danh sách. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-raised/50 border-b border-line">
        <span className="font-mono text-[13px] font-semibold">#{o.id}</span>
        <span className="text-[11.5px] text-faint">{new Date(o.created_at).toLocaleString("vi-VN")}</span>
        <div className="ml-auto flex items-center gap-2.5">
          <Tag tone={st.tone}>{st.label}</Tag>
          <span className="font-mono text-[14px] font-semibold tabular">{vnd(o.total_amount)}</span>
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="flex items-center gap-3 min-w-0">
          <Monogram text={o.product_title ?? "??"} />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[14px] truncate">{o.product_title ?? `Đơn #${o.id}`}</div>
            <div className="text-[12px] text-muted truncate">
              {o.variant_name ? `${o.variant_name} · ` : ""}SL {o.quantity}
            </div>
          </div>
          {o.escrow_expires_at && o.status === "delivered" && (
            <div className="text-[11px] text-faint flex items-center gap-1 shrink-0">
              <Shield size={11} className="text-good" /> Ký quỹ đến {new Date(o.escrow_expires_at).toLocaleDateString("vi-VN")}
            </div>
          )}
        </div>

        {st.hint && <p className="text-[12px] text-muted mt-2.5">{st.hint}</p>}

        {o.has_dispute && <OrderDispute orderId={o.id} />}

        {!["disputed", "refunded", "cancelled"].includes(o.status) && (
          <div className="mt-3 rounded-lg bg-raised/60 border border-line/70">
            <StatusTimeline status={o.status} />
          </div>
        )}

        {o.delivered_data && !plateHidden && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10.5px] text-faint uppercase tracking-wider">Dữ liệu bàn giao</span>
              <CopyButton text={o.delivered_data} />
            </div>
            <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-2.5 whitespace-pre-wrap break-all">{o.delivered_data}</pre>
          </div>
        )}

        {delivered && (
          <OrderProxyPanel
            orderId={o.id}
            deliveredData={o.delivered_data}
            onPlate={onPlate}
            onDelivered={onDelivered}
          />
        )}

        {o.status === "delivered" && (
          askConfirm ? (
            /* Bước xác nhận thứ hai: nhả ký quỹ là KHÔNG ĐẢO NGƯỢC ĐƯỢC — tiền
               sang người bán, và sau đó không mở khiếu nại được nữa. Một cú
               nhấp cho một hành động như vậy là quá ít, nhất là khi nút nằm
               ngay cạnh "Mở khiếu nại". */
            <div className="mt-3.5 rounded-lg border border-warn/30 bg-warn-soft p-3">
              <p className="text-[13px] font-semibold">Chuyển {vnd(o.total_amount)} cho người bán?</p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                Hãy kiểm tra hàng trước — xác nhận xong, tiền rời khỏi ký quỹ và bạn không mở
                khiếu nại cho đơn này được nữa.
              </p>
              <div className="flex gap-2 mt-2.5">
                <Button size="sm" onClick={() => onConfirm(o.id)} disabled={confirming}>
                  {confirming ? "Đang xác nhận…" : "Đồng ý, chuyển tiền"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setAskConfirm(false)} disabled={confirming}>
                  Để kiểm tra thêm
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 mt-3.5">
              <Button size="sm" onClick={() => setAskConfirm(true)}>Xác nhận đã nhận</Button>
              <Button size="sm" variant="danger" onClick={() => onOpenDispute(o.id)}>Mở khiếu nại</Button>
            </div>
          )
        )}

        {o.status === "completed" && !reviewDone && !reviewOpen && (
          <div className="mt-3.5">
            <Button size="sm" variant="secondary" onClick={() => onOpenReview(o.id)}>
              <Star size={13} /> Đánh giá
            </Button>
          </div>
        )}
        {o.status === "completed" && reviewDone && (
          <p className="flex items-center gap-1.5 text-[12px] mt-2.5 text-good font-medium">
            <Star size={12} className="fill-good" /> Đã đánh giá
          </p>
        )}
        {reviewOpen && (
          <ReviewForm
            orderId={o.id}
            onDone={(ok, message) => onReviewDone(o.id, ok, message)}
            onCancel={onCloseReview}
          />
        )}

        {delivered && (
          <Disclosure
            label="Xem dashboard" labelOpen="Ẩn dashboard"
            open={dashboardOpen}
            onToggle={() => setDashboardOpen((v) => !v)}
          >
            <ServiceDashboard orderId={o.id} />
          </Disclosure>
        )}
        {delivered && <OrderResources orderId={o.id} />}
      </div>
    </Card>
  );
}
