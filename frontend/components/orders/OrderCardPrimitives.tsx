"use client";

/* Ba khối hiển thị dùng chung cho MỌI nơi hiện "một đơn hàng" — buyer's
 * OrderCard và seller's SellerOrderCard đều lắp cùng bộ này, tránh 2 bản
 * timeline/dispute-thread trôi lệch nhau (đã xảy ra với status vocab trước
 * khi có lib/order-status.ts). */

import { useState } from "react";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { orderStatus } from "@/lib/order-status";
import type { Dispute, Order, Resource } from "@/lib/types";
import { evidenceFieldLabel, evidenceTypeLabel } from "@/lib/dispute-evidence";
import { Card, Disclosure, Monogram, Tag } from "@/components/ui";
import { Check } from "@/components/Icons";

const TIMELINE_STEPS = [
  { key: "pending", label: "Đặt hàng" },
  { key: "processing", label: "Xử lý" },
  { key: "delivered", label: "Giao hàng" },
  { key: "completed", label: "Hoàn tất" },
];

function stepIndex(status: string): number {
  return TIMELINE_STEPS.findIndex((s) => s.key === status);
}

export function StatusTimeline({ status }: { status: string }) {
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

export function OrderResources({ orderId }: { orderId: number }) {
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

export const DISPUTE_STATUS_INFO: Record<string, { label: string; tone: "good" | "bad" | "warn" | "iris" | "neutral" }> = {
  open: { label: "Đang chờ quản trị viên xử lý", tone: "warn" },
  resolved_refund: { label: "Đã hoàn tiền toàn bộ", tone: "bad" },
  resolved_reject: { label: "Đã từ chối — giữ nguyên đơn", tone: "neutral" },
  resolved_partial_refund: { label: "Đã hoàn tiền một phần", tone: "bad" },
  resolved_replace: { label: "Đã đổi sản phẩm mới", tone: "iris" },
  resolved_extend_warranty: { label: "Đã gia hạn bảo hành", tone: "iris" },
};

/** Khiếu nại là một cuộc hội thoại — hiển thị đúng như vậy: mỗi bên một vạch
 *  màu, đọc từ trên xuống là hết chuyện. `initialDispute` cho phép cha đã có
 *  sẵn dữ liệu (seller page fetch trước để phân nhóm "cần xử lý") truyền
 *  thẳng vào thay vì gọi lại API buyer-only `/orders/{id}/dispute`. */
export function OrderDispute({ orderId, initialDispute }: { orderId: number; initialDispute?: Dispute | null }) {
  const [dispute, setDispute] = useState<Dispute | null>(initialDispute ?? null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(!!initialDispute);

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

            <div className="mt-1 space-y-3">
              <div className="border-l-2 border-iris/40 pl-3">
                <p className="text-[11px] font-semibold text-iris-hi mb-0.5">
                  Người mua <span className="font-normal text-faint">· {new Date(dispute.created_at).toLocaleString("vi-VN")}</span>
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
 *  xác nhận tiền đã đi đâu. Sân khấu nhường cho các đơn đang sống.
 *  `viewerRole` đổi câu tiền-đi-đâu: buyer đọc "về ví [của tôi]", seller đọc
 *  "hoàn cho người mua" — cùng một khoản tiền, hai hướng khác nhau, im lặng
 *  dùng chung một câu cho cả hai phía sẽ đọc nhầm thành tiền của chính mình. */
export function TerminalOrderRow({ order: o, viewerRole = "buyer" }: { order: Order; viewerRole?: "buyer" | "seller" }) {
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
            {viewerRole === "seller" && o.buyer_email && <> · {o.buyer_email}</>}
          </p>
          {o.cancel_reason && (
            <p className="text-[11.5px] text-muted mt-0.5 leading-relaxed">{o.cancel_reason}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-[13px] tabular text-muted">{vnd(o.total_amount)}</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-good">
            <Check size={11} /> {viewerRole === "seller" ? "Đã hoàn cho người mua" : "Đã hoàn về ví"}
          </p>
        </div>
      </div>
      {o.has_dispute && <OrderDispute orderId={o.id} />}
    </Card>
  );
}
