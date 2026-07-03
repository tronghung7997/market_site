"use client";

import { useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import type { Order } from "@/lib/types";
import { Button, Card, Field, Spinner, Tag, Textarea, Tooltip } from "@/components/ui";
import { Check, Clock, Inbox } from "@/components/Icons";

const STATUS_MAP: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" | "iris" }> = {
  pending: { label: "Chờ xử lý", tone: "warn" },
  processing: { label: "Đang xử lý", tone: "iris" },
  delivered: { label: "Đã giao", tone: "good" },
  completed: { label: "Hoàn thành", tone: "good" },
  disputed: { label: "Tranh chấp", tone: "bad" },
  refunded: { label: "Hoàn tiền", tone: "bad" },
  cancelled: { label: "Đã huỷ", tone: "neutral" },
};

export default function SellerOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [delivering, setDelivering] = useState<number | null>(null);
  const [deliverData, setDeliverData] = useState("");
  const [acting, setActing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = () => {
    setLoading(true);
    api.sellerOrders().then(setOrders).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const accept = async (orderId: number) => {
    setActing(true);
    try { await api.sellerAcceptOrder(orderId); load(); }
    catch { } finally { setActing(false); }
  };

  const deliver = async (orderId: number) => {
    if (!deliverData.trim()) return;
    setActing(true);
    try {
      await api.sellerDeliverOrder(orderId, deliverData.trim());
      setDelivering(null); setDeliverData("");
      load();
    } catch { } finally { setActing(false); }
  };

  if (loading) return <Spinner />;

  const ACTION_STATUSES = new Set(["pending", "processing", "disputed"]);
  const pending = orders.filter((o) => ACTION_STATUSES.has(o.status));
  const rest = orders.filter((o) => !ACTION_STATUSES.has(o.status));
  const filteredRest = statusFilter === "all" ? rest : rest.filter((o) => o.status === statusFilter);

  /* Status counts — from all orders for summary, from rest for filter tabs */
  const counts = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
  const restCounts = rest.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  const FILTER_TABS = [
    { key: "all", label: "Tất cả" },
    { key: "delivered", label: "Đã giao" },
    { key: "completed", label: "Hoàn thành" },
    { key: "refunded", label: "Hoàn tiền" },
    { key: "cancelled", label: "Đã huỷ" },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-[16px] font-semibold">Đơn hàng ({orders.length})</h2>

      {/* Status summary bar */}
      {orders.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
          {Object.entries(STATUS_MAP).map(([key, { label, tone }]) => {
            const c = counts[key];
            if (!c) return null;
            const cls = tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : tone === "iris" ? "text-iris" : "text-muted";
            return (
              <span key={key} className="flex items-center gap-1">
                <span className={`font-mono font-semibold tabular ${cls}`}>{c}</span> {label}
              </span>
            );
          })}
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-warn mb-3 flex items-center gap-2">
            <Clock size={14} /> Cần xử lý ({pending.length})
          </h3>
          <div className="space-y-3">
            {pending.map((o) => (
              <OrderCard key={o.id} order={o}
                onAccept={() => accept(o.id)}
                onDeliver={() => delivering === o.id ? deliver(o.id) : (setDelivering(o.id), setDeliverData(""))}
                delivering={delivering === o.id}
                deliverData={deliverData}
                setDeliverData={setDeliverData}
                acting={acting}
                onLoad={load}
              />
            ))}
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-muted mb-3">Lịch sử ({rest.length})</h3>
          <div className="flex gap-1 mb-3 flex-wrap">
            {FILTER_TABS.map((t) => {
              const c = t.key === "all" ? rest.length : (restCounts[t.key] ?? 0);
              if (t.key !== "all" && c === 0) return null;
              return (
                <button
                  key={t.key}
                  onClick={() => setStatusFilter(t.key)}
                  className={`px-2.5 py-1 text-[12px] font-medium rounded-md transition-colors ${
                    statusFilter === t.key ? "bg-iris text-white" : "bg-raised text-muted hover:text-fg"
                  }`}
                >
                  {t.label} ({c})
                </button>
              );
            })}
          </div>
          <Card className="overflow-visible">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[12px] text-faint border-b border-line">
                  <th className="font-medium px-5 py-3">#</th>
                  <th className="font-medium px-3 py-3">Sản phẩm</th>
                  <th className="font-medium px-3 py-3">SL</th>
                  <th className="font-medium px-3 py-3">Tổng</th>
                  <th className="font-medium px-3 py-3">Trạng thái</th>
                  <th className="font-medium px-3 py-3 hidden sm:table-cell">Ngày</th>
                </tr>
              </thead>
              <tbody>
                {filteredRest.map((o) => {
                  const st = STATUS_MAP[o.status] ?? { label: o.status, tone: "neutral" as const };
                  const name = o.variant_name ?? o.product_title ?? `#${o.variant_id}`;
                  return (
                    <tr key={o.id} className="border-b border-line last:border-0 hover:bg-raised transition-colors text-[13px]">
                      <td className="px-5 py-3 font-mono">{o.id}</td>
                      <td className="px-3 py-3 max-w-[260px]">
                        <Tooltip text={[o.product_title, o.variant_name].filter(Boolean).join("\n") || name} position="bottom">
                          <div className="flex flex-col gap-0.5 cursor-default">
                            <span className="truncate font-medium">{name}</span>
                            {o.product_title && o.variant_name && (
                              <span className="truncate text-[11px] text-faint">{o.product_title}</span>
                            )}
                          </div>
                        </Tooltip>
                      </td>
                      <td className="px-3 py-3">{o.quantity}</td>
                      <td className="px-3 py-3 font-mono font-medium tabular">{vnd(o.total_amount)}</td>
                      <td className="px-3 py-3"><Tag tone={st.tone}>{st.label}</Tag></td>
                      <td className="px-3 py-3 text-muted hidden sm:table-cell">{new Date(o.created_at).toLocaleDateString("vi-VN")}</td>
                    </tr>
                  );
                })}
                {filteredRest.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-6 text-center text-[13px] text-muted">Không có đơn hàng nào</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {orders.length === 0 && (
        <Card className="p-8 text-center">
          <Inbox size={40} className="mx-auto text-faint mb-3" />
          <p className="text-[14px] text-muted">Chưa có đơn hàng nào</p>
        </Card>
      )}
    </div>
  );
}

function OrderCard({ order, onAccept, onDeliver, delivering, deliverData, setDeliverData, acting, onLoad }: {
  order: Order;
  onAccept: () => void;
  onDeliver: () => void;
  delivering: boolean;
  deliverData: string;
  setDeliverData: (v: string) => void;
  acting: boolean;
  onLoad: () => void;
}) {
  const st = STATUS_MAP[order.status] ?? { label: order.status, tone: "neutral" as const };
  const [dispute, setDispute] = useState<{ id: number; reason: string; seller_note: string | null } | null>(null);
  const [responding, setResponding] = useState(false);
  const [sellerNote, setSellerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (order.status === "disputed") {
      api.sellerDispute(order.id).then(setDispute).catch(() => {});
    }
  }, [order.id, order.status]);

  const submitResponse = async () => {
    if (!dispute || !sellerNote.trim()) return;
    setSubmitting(true);
    try {
      await api.sellerRespondDispute(dispute.id, sellerNote.trim());
      setResponding(false);
      setSellerNote("");
      onLoad();
    } catch { } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[14px] font-semibold">#{order.id}</span>
            <Tag tone={st.tone}>{st.label}</Tag>
          </div>
          <div className="flex items-center gap-3 mt-2 text-[13px] text-muted">
            <Tooltip text={[order.product_title, order.variant_name].filter(Boolean).join("\n") || `Variant #${order.variant_id}`}>
              <span className="max-w-[220px] truncate cursor-default">
                {order.variant_name ?? order.product_title ?? `Variant #${order.variant_id}`}
              </span>
            </Tooltip>
            <span>SL: {order.quantity}</span>
            <span className="font-mono font-medium text-fg tabular">{vnd(order.total_amount)}</span>
          </div>
          <div className="text-[12px] text-faint mt-1">
            {new Date(order.created_at).toLocaleString("vi-VN")}
          </div>
          {order.status === "delivered" && order.escrow_expires_at && (
            <div className="text-[12px] text-warn mt-1">
              Ký quỹ hết hạn: {new Date(order.escrow_expires_at).toLocaleString("vi-VN")}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {order.status === "pending" && (
            <Button size="sm" disabled={acting} onClick={onAccept}>
              <Check size={13} /> Chấp nhận
            </Button>
          )}
          {order.status === "processing" && (
            <Button size="sm" disabled={acting} onClick={onDeliver}>
              Giao hàng
            </Button>
          )}
          {order.status === "disputed" && !dispute?.seller_note && (
            <Button size="sm" variant="secondary" onClick={() => setResponding(true)}>
              Phản hồi
            </Button>
          )}
        </div>
      </div>

      {/* Dispute info */}
      {order.status === "disputed" && dispute && (
        <div className="mt-3 pt-3 border-t border-line">
          <div className="rounded-lg bg-bad-soft border border-bad/20 px-3 py-2.5 text-[13px]">
            <p className="text-[11px] font-semibold text-bad uppercase tracking-wide mb-1">Lý do khiếu nại</p>
            <p className="text-fg">{dispute.reason}</p>
          </div>
          {dispute.seller_note && (
            <div className="mt-2 rounded-lg bg-surface border border-line px-3 py-2.5 text-[13px]">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">Phản hồi của bạn</p>
              <p className="text-fg">{dispute.seller_note}</p>
            </div>
          )}
        </div>
      )}

      {/* Respond form */}
      {responding && order.status === "disputed" && (
        <div className="mt-4 pt-4 border-t border-line space-y-3">
          <Field label="Phản hồi khiếu nại" hint="Giải thích hoặc cung cấp bằng chứng cho admin xem xét">
            <Textarea rows={3} value={sellerNote} onChange={(e) => setSellerNote(e.target.value)}
              placeholder="Nhập phản hồi của bạn..." />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" disabled={submitting || !sellerNote.trim()} onClick={submitResponse}>
              {submitting ? "Đang gửi…" : "Gửi phản hồi"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setResponding(false); setSellerNote(""); }}>
              Huỷ
            </Button>
          </div>
        </div>
      )}

      {delivering && order.status === "processing" && (
        <div className="mt-4 pt-4 border-t border-line space-y-3">
          <Field label="Dữ liệu bàn giao" hint="Nhập thông tin giao cho người mua">
            <Textarea rows={4} value={deliverData} onChange={(e) => setDeliverData(e.target.value)}
              placeholder="username|password|email&#10;hoặc nội dung bàn giao..." />
          </Field>
          <Button size="sm" disabled={acting || !deliverData.trim()} onClick={onDeliver}>
            {acting ? "Đang giao…" : "Xác nhận giao hàng"}
          </Button>
        </div>
      )}
    </Card>
  );
}
