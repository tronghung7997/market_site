"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { orderStatus } from "@/lib/order-status";
import type { Dispute, Order } from "@/lib/types";
import { Card, Input, Spinner } from "@/components/ui";
import { ArrowRight, Clock, Inbox, Info, Search } from "@/components/Icons";
import SellerOrderCard from "@/components/seller/SellerOrderCard";
import SellerHistoryRow from "@/components/seller/SellerHistoryRow";
import { TerminalOrderRow } from "@/components/orders/OrderCardPrimitives";

const HISTORY_STATUSES = ["delivered", "completed", "refunded", "cancelled"] as const;

export default function SellerOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [disputes, setDisputes] = useState<Record<number, Dispute>>({});
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [search, setSearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.sellerOrders();
      setOrders(list);
      // Cần biết seller_note trước khi render để phân "chưa phản hồi" (khẩn) và
      // "đã phản hồi, chờ admin" (bình thường) — không thể chờ mỗi card tự lazy
      // load rồi mới xếp nhóm, sẽ giật layout.
      const disputedIds = list.filter((o) => o.status === "disputed").map((o) => o.id);
      const entries = await Promise.all(
        disputedIds.map(async (id) => {
          try { return [id, await api.sellerDispute(id)] as const; } catch { return null; }
        }),
      );
      setDisputes(Object.fromEntries(entries.filter((e): e is readonly [number, Dispute] => e != null)));
    } catch { /* ignore — trang hiện rỗng, seller thử tải lại */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const accept = async (orderId: number) => {
    setActing(true);
    try { await api.sellerAcceptOrder(orderId); await load(); }
    catch { } finally { setActing(false); }
  };

  const deliver = async (orderId: number, data: string) => {
    setActing(true);
    try { await api.sellerDeliverOrder(orderId, data); await load(); }
    catch { } finally { setActing(false); }
  };

  if (loading) return <Spinner />;

  const pending = orders.filter((o) => o.status === "pending");
  const processing = orders.filter((o) => o.status === "processing");
  const disputed = orders.filter((o) => o.status === "disputed");
  const disputesUnresponded = disputed.filter((o) => !disputes[o.id]?.seller_note);
  const disputesResponded = disputed.filter((o) => disputes[o.id]?.seller_note);
  const history = orders.filter((o) => (HISTORY_STATUSES as readonly string[]).includes(o.status));

  const historyCounts = history.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  const q = search.trim().toLowerCase();
  const filteredHistory = history
    .filter((o) => historyFilter === "all" || o.status === historyFilter)
    .filter((o) => {
      if (!q) return true;
      const haystack = [String(o.id), o.product_title, o.variant_name, o.buyer_email].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });

  const needsAction = pending.length + processing.length + disputesUnresponded.length;

  return (
    <div className="space-y-7">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[16px] font-semibold">Đơn hàng</h2>
          <p className="text-[13px] text-muted mt-1">
            {orders.length} đơn
            {needsAction > 0 && <> · <span className="text-warn font-medium">{needsAction} cần xử lý</span></>}
          </p>
        </div>
        <Link href="/seller" className="text-[12.5px] text-iris-hi hover:underline flex items-center gap-1 shrink-0">
          Xem thống kê doanh thu <ArrowRight size={12} />
        </Link>
      </div>

      {orders.length === 0 && (
        <Card className="p-8 text-center">
          <Inbox size={40} className="mx-auto text-faint mb-3" />
          <p className="text-[14px] text-muted">Chưa có đơn hàng nào</p>
        </Card>
      )}

      {disputesUnresponded.length > 0 && (
        <Section title={`Khiếu nại cần bạn phản hồi (${disputesUnresponded.length})`} icon={<Info size={14} />} tone="bad">
          {disputesUnresponded.map((o) => (
            <SellerOrderCard key={o.id} order={o} dispute={disputes[o.id]} acting={acting}
              onAccept={accept} onDeliver={deliver} onDisputeResponded={load} />
          ))}
        </Section>
      )}

      {pending.length > 0 && (
        <Section title={`Đơn mới — cần chấp nhận (${pending.length})`} icon={<Clock size={14} />} tone="warn">
          {pending.map((o) => (
            <SellerOrderCard key={o.id} order={o} acting={acting}
              onAccept={accept} onDeliver={deliver} onDisputeResponded={load} />
          ))}
        </Section>
      )}

      {processing.length > 0 && (
        <Section title={`Đang chuẩn bị giao (${processing.length})`} icon={<Clock size={14} />} tone="iris">
          {processing.map((o) => (
            <SellerOrderCard key={o.id} order={o} acting={acting}
              onAccept={accept} onDeliver={deliver} onDisputeResponded={load} />
          ))}
        </Section>
      )}

      {disputesResponded.length > 0 && (
        <Section title={`Khiếu nại đã phản hồi — chờ admin xử lý (${disputesResponded.length})`} icon={<Info size={14} />} tone="neutral">
          {disputesResponded.map((o) => (
            <SellerOrderCard key={o.id} order={o} dispute={disputes[o.id]} acting={acting}
              onAccept={accept} onDeliver={deliver} onDisputeResponded={load} />
          ))}
        </Section>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-muted mb-3">Lịch sử ({history.length})</h3>

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="flex gap-1 flex-wrap">
              <FilterTab active={historyFilter === "all"} onClick={() => setHistoryFilter("all")}>
                Tất cả ({history.length})
              </FilterTab>
              {HISTORY_STATUSES.map((s) => {
                const c = historyCounts[s];
                if (!c) return null;
                return (
                  <FilterTab key={s} active={historyFilter === s} onClick={() => setHistoryFilter(s)}>
                    {orderStatus(s).label} ({c})
                  </FilterTab>
                );
              })}
            </div>
            <div className="relative ml-auto w-full sm:w-[240px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo sản phẩm, mã đơn, email khách…"
                className="pl-8"
              />
            </div>
          </div>

          <div className="space-y-2">
            {filteredHistory.map((o) => (
              o.status === "delivered" || o.status === "completed"
                ? <SellerHistoryRow key={o.id} order={o} />
                : <TerminalOrderRow key={o.id} order={o} viewerRole="seller" />
            ))}
            {filteredHistory.length === 0 && (
              <p className="px-2 py-6 text-center text-[13px] text-muted">Không tìm thấy đơn nào khớp.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, tone, children }: {
  title: string; icon: React.ReactNode; tone: "bad" | "warn" | "iris" | "neutral"; children: React.ReactNode;
}) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "iris" ? "text-iris" : "text-muted";
  return (
    <div>
      <h3 className={`text-[13px] font-semibold mb-3 flex items-center gap-2 ${color}`}>
        {icon} {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[12px] font-medium rounded-md transition-colors ${
        active ? "bg-iris text-white" : "bg-raised text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
