"use client";

/** Card một đơn hàng trong danh sách — cụm "mọi thứ về MỘT đơn":
 *  - TerminalOrderRow: đơn kết thúc (huỷ/hoàn) nén một dòng yên tĩnh
 *  - OrderCard: đơn đang sống — biển số, timeline, dữ liệu bàn giao, panel
 *    proxy, nút xác nhận/khiếu nại, form đánh giá, dashboard & tài nguyên
 *  Mọi state chéo-đơn (đơn nào đang mở form review, toast) vẫn ở page;
 *  state riêng-từng-đơn (mở dashboard, disclosure) sống ngay trong card. */

import { useState } from "react";
import { vnd } from "@/lib/api";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { orderStatus } from "@/lib/order-status";
import type { Dispute, Order, Resource } from "@/lib/types";
import { evidenceFieldLabel, evidenceTypeLabel } from "@/lib/dispute-evidence";
import ServiceDashboard from "@/components/ServiceDashboard";
import { Button, Card, CopyButton, Disclosure, Monogram, Tag } from "@/components/ui";
import { Check, Shield, Star } from "@/components/Icons";
import OrderProxyPanel from "./OrderProxyPanel";
import ReviewForm from "./ReviewForm";

const TIMELINE_STEPS = [
  { key: "pending", label: "Đặt hàng" },
  { key: "processing", label: "Xử lý" },
  { key: "delivered", label: "Giao hàng" },
  { key: "completed", label: "Hoàn tất" },
];

function stepIndex(status: string): number {
  return TIMELINE_STEPS.findIndex((s) => s.key === status);
}

function StatusTimeline({ status }: { status: string }) {
  const isBad = ["disputed", "refunded", "cancelled"].includes(status);
  const current = status === "completed" ? 3 : status === "delivered" ? 2 : stepIndex(status);

  if (isBad) return null;

  return (
    <div className="flex items-center mt-4 mb-1 gap-0 px-1">
      {TIMELINE_STEPS.map((step, i) => {
        const done = current >= i;
        return (
          <div key={step.key} className={cn("flex items-center", i > 0 && "flex-1")}>
            {i > 0 && <div className={cn("h-[2px] flex-1 rounded-full transition-colors", done ? "bg-iris" : "bg-line")} />}
            <div className="flex flex-col items-center gap-1.5">
              <div className={cn(
                "w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold shrink-0 transition-colors",
                done ? "bg-iris text-white shadow-[0_0_0_3px_var(--color-iris-soft)]" : "bg-surface border-2 border-line text-faint",
              )}>
                {done ? "✓" : i + 1}
              </div>
              <span className={cn("text-[10.5px] whitespace-nowrap", done ? "text-fg font-medium" : "text-faint")}>{step.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrderResources({ orderId }: { orderId: number }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const toggle = async () => {
    setOpen((v) => !v);
    if (!loaded) {
      try { setResources(await api.orderResources(orderId)); } catch { /* ignore */ }
      setLoaded(true);
    }
  };

  const fmtExpiry = (iso: string | null) => {
    if (!iso) return "Vĩnh viễn";
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return "Đã hết hạn";
    return `Còn ${Math.ceil(ms / 86400000)} ngày`;
  };
  const tone = (s: string) => s === "assigned" ? "good" : s === "expired" ? "warn" : s === "error" ? "bad" : "neutral";
  const label = (s: string) => ({ assigned: "Đang dùng", expired: "Hết hạn", error: "Lỗi", available: "Sẵn sàng" }[s] ?? s);

  return (
    <Disclosure label="Xem trạng thái tài nguyên" labelOpen="Ẩn tài nguyên" open={open} onToggle={toggle}>
      <div className="mt-2.5 space-y-1.5">
        {loaded && resources.length === 0 && <p className="text-[12px] text-faint">Không có tài nguyên gắn với đơn này.</p>}
        {resources.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-[12.5px] px-3 py-2 rounded-lg bg-raised border border-line">
            <span className="font-mono text-faint">#{r.id}</span>
            <Tag tone={tone(r.status)}>{label(r.status)}</Tag>
            <span className="ml-auto text-muted">{fmtExpiry(r.expires_at)}</span>
          </div>
        ))}
      </div>
    </Disclosure>
  );
}

const DISPUTE_STATUS_INFO: Record<string, { label: string; tone: "good" | "bad" | "warn" | "iris" | "neutral" }> = {
  open: { label: "Đang chờ quản trị viên xử lý", tone: "warn" },
  resolved_refund: { label: "Đã hoàn tiền toàn bộ", tone: "bad" },
  resolved_reject: { label: "Đã từ chối — giữ nguyên đơn", tone: "neutral" },
  resolved_partial_refund: { label: "Đã hoàn tiền một phần", tone: "bad" },
  resolved_replace: { label: "Đã đổi sản phẩm mới", tone: "iris" },
  resolved_extend_warranty: { label: "Đã gia hạn bảo hành", tone: "iris" },
};

function OrderDispute({ orderId }: { orderId: number }) {
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const toggle = async () => {
    setOpen((v) => !v);
    if (!loaded) {
      try { setDispute(await api.orderDispute(orderId)); } catch { /* ignore */ }
      setLoaded(true);
    }
  };

  const info = dispute ? (DISPUTE_STATUS_INFO[dispute.status] ?? { label: dispute.status, tone: "neutral" as const }) : null;

  return (
    <Disclosure label="Xem khiếu nại" labelOpen="Ẩn khiếu nại" open={open} onToggle={toggle}>
      <div className="mt-2.5 space-y-2 text-[12.5px]">
        {loaded && !dispute && <p className="text-faint">Không tải được thông tin khiếu nại.</p>}
        {dispute && info && (
          <>
            <Tag tone={info.tone}>{info.label}</Tag>

            {/* Khiếu nại là một cuộc hội thoại — hiển thị đúng như vậy:
                mỗi bên một vạch màu, đọc từ trên xuống là hết chuyện. */}
            <div className="mt-1 space-y-3">
              <div className="border-l-2 border-iris/40 pl-3">
                <p className="text-[11px] font-semibold text-iris-hi mb-0.5">
                  Bạn <span className="font-normal text-faint">· {new Date(dispute.created_at).toLocaleString("vi-VN")}</span>
                </p>
                <p>{dispute.reason}</p>
                {dispute.evidence && Object.keys(dispute.evidence).length > 0 && (
                  <div className="mt-1.5 space-y-0.5 text-[11.5px]">
                    <p className="text-faint">Bằng chứng — {evidenceTypeLabel(dispute.evidence_type)}</p>
                    {Object.entries(dispute.evidence).map(([key, value]) => (
                      <p key={key} className="text-muted">
                        <span className="text-faint">{evidenceFieldLabel(dispute.evidence_type, key)}: </span>
                        {value}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {dispute.seller_note && (
                <div className="border-l-2 border-line-2 pl-3">
                  <p className="text-[11px] font-semibold text-muted mb-0.5">Người bán</p>
                  <p>{dispute.seller_note}</p>
                </div>
              )}

              {(dispute.admin_note || dispute.resolved_at) && (
                <div className="border-l-2 border-good/50 pl-3">
                  <p className="text-[11px] font-semibold text-good mb-0.5">
                    Quản trị viên
                    {dispute.resolved_at && (
                      <span className="font-normal text-faint"> · {new Date(dispute.resolved_at).toLocaleString("vi-VN")}</span>
                    )}
                  </p>
                  <p>{dispute.admin_note ?? info.label}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Disclosure>
  );
}

/** Đơn đã kết thúc (huỷ / hoàn tiền) — nén thành một dòng yên tĩnh: lý do +
 *  xác nhận tiền đã về ví. Sân khấu nhường cho các đơn đang sống. */
export function TerminalOrderRow({ order: o }: { order: Order }) {
  const st = orderStatus(o.status);
  return (
    <Card className="px-4 py-3">
      <div className="flex items-start gap-3 min-w-0">
        <Monogram text={o.product_title ?? "??"} className="h-8 w-8 text-[12px] text-faint" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-medium truncate">{o.product_title ?? `Đơn #${o.id}`}</span>
            <Tag tone={st.tone}>{st.label}</Tag>
          </div>
          <p className="text-[11.5px] text-faint mt-0.5">
            Đơn #{o.id} · {new Date(o.created_at).toLocaleDateString("vi-VN")}
          </p>
          {o.cancel_reason && (
            <p className="text-[11.5px] text-muted mt-0.5 leading-relaxed">{o.cancel_reason}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-[13px] tabular text-muted">{vnd(o.total_amount)}</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-good">
            <Check size={11} /> Đã hoàn về ví
          </p>
        </div>
      </div>
      {o.has_dispute && <OrderDispute orderId={o.id} />}
    </Card>
  );
}

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
