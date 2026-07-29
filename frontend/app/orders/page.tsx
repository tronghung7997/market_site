"use client";

/** Trang Đơn hàng của buyer — file này là MỤC LỤC + state chéo-đơn:
 *
 *  - Lọc & phân trang:  OrderFilters (useOrderFilters + StatusTabs + FilterCard)
 *  - Một đơn:           OrderCard / TerminalOrderRow (kèm proxy panel, review…)
 *  - Khiếu nại:         DisputeModal (radix dialog)
 *  - State ở đây:       danh sách + stats, đơn nào đang confirm/mở review,
 *                       set đơn đã review trong phiên, set đơn có "tấm địa chỉ"
 *                       (ẩn khối bàn giao thô), toast.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { Order, OrderStats } from "@/lib/types";
import { Button, Card, Pagination, Spinner } from "@/components/ui";
import OrderCard, { TerminalOrderRow } from "./OrderCard";
import DisputeModal from "./DisputeModal";
import { FilterCard, PER_PAGE_OPTIONS, StatusTabs, useOrderFilters } from "./OrderFilters";

export default function OrdersPage() {
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useOrderFilters(searchParams.get("status") ?? "");

  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [disputeOrderId, setDisputeOrderId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [reviewOrderId, setReviewOrderId] = useState<number | null>(null);
  const [reviewedOrders, setReviewedOrders] = useState<Set<number>>(new Set());
  // Đơn có tấm địa chỉ proxy cố định (key xoay): panel proxy tự trình bày cả
  // bản bàn giao, khối <pre> thô ở ngoài chỉ còn gây trùng lặp nên ẩn đi.
  const [plateOrders, setPlateOrders] = useState<Set<number>>(new Set());
  const handlePlate = useCallback((id: number) => {
    setPlateOrders((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const handleDelivered = useCallback((id: number, deliveredData: string) => {
    setOrders((prev) => prev.map((ord) => (ord.id === id ? { ...ord, delivered_data: deliveredData } : ord)));
  }, []);

  const fetchOrders = useCallback(async (params: Parameters<typeof api.orders>[0]) => {
    setLoading(true);
    try {
      const res = await api.orders(params);
      setOrders(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!account) { router.push("/login"); return; }
    api.orderStats().then(setStats).catch(() => {});
    fetchOrders(filters.params);
  }, [account, authLoading, router, fetchOrders, filters.params]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleConfirm(orderId: number) {
    setConfirmingId(orderId);
    try {
      const updated = await api.confirmOrder(orderId);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
      showToast("Đã xác nhận nhận hàng thành công!");
      api.orderStats().then(setStats).catch(() => {});
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setConfirmingId(null);
    }
  }

  function handleReviewDone(orderId: number, ok: boolean, message: string) {
    showToast(message);
    if (ok) {
      setReviewedOrders((prev) => new Set(prev).add(orderId));
      setReviewOrderId(null);
    }
  }

  function handleDisputeSuccess() {
    setDisputeOrderId(null);
    showToast("Đã gửi khiếu nại thành công!");
    fetchOrders(filters.params);
    api.orderStats().then(setStats).catch(() => {});
  }

  const totalPages = Math.max(1, Math.ceil(total / filters.perPage));

  const tabCounts: Record<string, number | undefined> = {
    "": stats?.total,
    active: stats?.active,
    disputed: stats?.disputed,
    deleted: undefined,
  };

  if (authLoading) return <div className="w-full mx-auto max-w-[920px] px-6 py-16"><Spinner /></div>;

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-10">
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-4 py-2.5 rounded-lg text-[13px] font-medium shadow-card-lg bg-good text-white">
          {toast}
        </div>
      )}

      {disputeOrderId !== null && (
        <DisputeModal orderId={disputeOrderId} onClose={() => setDisputeOrderId(null)} onSuccess={handleDisputeSuccess} />
      )}

      <div className="grid lg:grid-cols-[260px_1fr] gap-6 min-w-0">
        {/* ─── Cột trái: tiêu đề, biên lai tổng quan, thư mục trạng thái, bộ lọc ─── */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start space-y-4">
          <div>
            <h2 className="font-serif text-[24px] tracking-tight">Đơn hàng</h2>
            <p className="text-[12.5px] text-muted mt-0.5">Theo dõi và quản lý các đơn đã đặt</p>
          </div>

          {/* Tổng quan kiểu biên lai: nhãn trái, số phải, tổng chi chốt sổ */}
          {stats && (
            <Card className="px-4 py-3.5">
              <dl className="text-[12.5px] space-y-2">
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted">Tổng đơn</dt>
                  <dd className="font-semibold tabular">{stats.total}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted">Đang hoạt động</dt>
                  <dd className={cn("font-semibold tabular", stats.active > 0 ? "text-iris-hi" : "")}>{stats.active}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted">Khiếu nại</dt>
                  <dd className={cn("font-semibold tabular", stats.disputed > 0 ? "text-bad" : "")}>{stats.disputed}</dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-dashed border-line-2 pt-2.5 mt-2.5">
                  <dt className="text-muted">Đã chi</dt>
                  <dd className="font-mono font-semibold tabular text-[13px]">{vnd(stats.total_spend)}</dd>
                </div>
              </dl>
            </Card>
          )}

          <StatusTabs filters={filters} counts={tabCounts} />
          <FilterCard filters={filters} />
        </aside>

        {/* ─── Cột phải: danh sách đơn ─── */}
        <div className="min-w-0">
          {loading ? (
            <div className="flex flex-col gap-3.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="h-11 w-11 shrink-0 rounded-lg bg-raised animate-shimmer" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-4 w-1/3 rounded bg-raised animate-shimmer" />
                      <div className="h-3 w-1/2 rounded bg-raised animate-shimmer" />
                    </div>
                    <div className="h-5 w-24 rounded bg-raised animate-shimmer" />
                  </div>
                </Card>
              ))}
            </div>
          ) : orders.length === 0 ? (
            <Card className="p-8 flex flex-col items-center gap-3 text-center">
              <p className="text-[13px] text-muted">
                {filters.hasFilters || filters.tab !== "" ? "Không có đơn nào khớp bộ lọc hiện tại." : "Bạn chưa có đơn hàng nào."}
              </p>
              {filters.hasFilters ? (
                <Button variant="secondary" size="sm" onClick={filters.clear}>Xóa bộ lọc</Button>
              ) : (
                <Link href="/"><Button size="sm">Khám phá chợ</Button></Link>
              )}
            </Card>
          ) : (
            <div className="flex flex-col gap-3.5">
              {orders.map((o) =>
                o.status === "cancelled" || o.status === "refunded" ? (
                  // Đơn đã kết thúc thất bại → dòng nén, không banner
                  <TerminalOrderRow key={o.id} order={o} />
                ) : (
                  <OrderCard
                    key={o.id}
                    order={o}
                    confirming={confirmingId === o.id}
                    plateHidden={plateOrders.has(o.id)}
                    reviewOpen={reviewOrderId === o.id}
                    reviewDone={!!o.has_review || reviewedOrders.has(o.id)}
                    onConfirm={handleConfirm}
                    onOpenDispute={setDisputeOrderId}
                    onOpenReview={setReviewOrderId}
                    onReviewDone={handleReviewDone}
                    onCloseReview={() => setReviewOrderId(null)}
                    onDelivered={handleDelivered}
                    onPlate={handlePlate}
                  />
                ),
              )}
            </div>
          )}

          {/* ─── Chân trang: khoảng hiển thị + phân trang + cỡ trang ─── */}
          {!loading && total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
              <span className="text-[12px] text-faint tabular">
                Hiển thị {(filters.page - 1) * filters.perPage + 1}–{Math.min(filters.page * filters.perPage, total)} / {total} đơn
              </span>
              <div className="flex items-center gap-2">
                <Pagination page={filters.page} totalPages={totalPages} onChange={filters.setPage} />
                <select
                  value={filters.perPage}
                  onChange={(e) => filters.setPerPage(Number(e.target.value))}
                  aria-label="Số đơn mỗi trang"
                  className="h-8 rounded-lg bg-surface border border-line px-2 text-[12px] text-muted cursor-pointer focus:outline-none focus:border-iris"
                >
                  {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n} / trang</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
