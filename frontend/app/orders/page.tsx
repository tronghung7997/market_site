"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { Dispute, Order, OrderStats, Resource } from "@/lib/types";
import { Shield, Star, Package, Clock, Info, Wallet, Copy, ChevronRight } from "@/components/Icons";
import ServiceDashboard from "@/components/ServiceDashboard";
import { Button, Card, Input, Select, Spinner, Tag, Textarea } from "@/components/ui";

const STATUS: Record<string, { label: string; tone: "good" | "bad" | "warn" | "iris" | "neutral"; hint: string }> = {
  pending: { label: "Chờ xử lý", tone: "warn", hint: "Người bán đang chuẩn bị đơn của bạn." },
  processing: { label: "Đang xử lý", tone: "warn", hint: "Người bán đã nhận đơn và đang giao." },
  delivered: { label: "Đã giao", tone: "iris", hint: "Hàng đã giao — kiểm tra rồi bấm xác nhận để hoàn tất." },
  completed: { label: "Hoàn tất", tone: "good", hint: "Đơn đã hoàn tất, tiền đã chuyển cho người bán." },
  disputed: { label: "Khiếu nại", tone: "bad", hint: "Khiếu nại đang được quản trị viên xử lý." },
  refunded: { label: "Đã hoàn tiền", tone: "bad", hint: "Tiền đã được hoàn về ví của bạn." },
  cancelled: { label: "Đã huỷ", tone: "neutral", hint: "Đơn đã bị huỷ." },
};

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

function CopyIconButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted hover:text-iris-hi transition-colors"
    >
      <Copy size={11} /> {copied ? "Đã sao chép" : "Sao chép"}
    </button>
  );
}

function Disclosure({ label, labelOpen, open, onToggle, children }: {
  label: string; labelOpen: string; open: boolean; onToggle: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-line">
      <button onClick={onToggle} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:text-iris transition-colors">
        <ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} />
        {open ? labelOpen : label}
      </button>
      {open && children}
    </div>
  );
}

function DisputeModal({ orderId, onClose, onSuccess }: { orderId: number; onClose: () => void; onSuccess: () => void }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!reason.trim()) return;
    setSubmitting(true); setError("");
    try {
      await api.openDispute(orderId, reason.trim());
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <Card className="w-full max-w-[420px] p-6 flex flex-col gap-4" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-[16px] font-semibold">Mở khiếu nại — Đơn #{orderId}</h3>
        <Textarea rows={4} placeholder="Mô tả lý do khiếu nại…" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p className="text-[12px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button variant="danger" onClick={handleSubmit} disabled={submitting || !reason.trim()}>
            {submitting ? "Đang gửi…" : "Gửi khiếu nại"}
          </Button>
        </div>
      </Card>
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
            <div className="flex items-center gap-2 flex-wrap">
              <Tag tone={info.tone}>{info.label}</Tag>
              {dispute.resolved_at && (
                <span className="text-faint">Xử lý lúc {new Date(dispute.resolved_at).toLocaleString("vi-VN")}</span>
              )}
            </div>
            <div className="px-3 py-2 rounded-lg bg-raised border border-line">
              <p className="text-faint text-[11px] uppercase tracking-wider mb-0.5">Lý do bạn đã gửi</p>
              <p>{dispute.reason}</p>
            </div>
            {dispute.seller_note && (
              <div className="px-3 py-2 rounded-lg bg-iris/5 border border-iris/15">
                <p className="text-faint text-[11px] uppercase tracking-wider mb-0.5">Phản hồi từ người bán</p>
                <p>{dispute.seller_note}</p>
              </div>
            )}
            {dispute.admin_note && (
              <div className="px-3 py-2 rounded-lg bg-raised border border-line">
                <p className="text-faint text-[11px] uppercase tracking-wider mb-0.5">Ghi chú từ quản trị viên</p>
                <p>{dispute.admin_note}</p>
              </div>
            )}
          </>
        )}
      </div>
    </Disclosure>
  );
}

/* ─── Tabs ─── */
const TABS = [
  { key: "", label: "Tất cả" },
  { key: "active", label: "Hoạt động" },
  { key: "disputed", label: "Khiếu nại" },
  { key: "deleted", label: "Đã xoá" },
] as const;

const SORT_OPTIONS = [
  { value: "newest", label: "Mới nhất" },
  { value: "oldest", label: "Cũ nhất" },
  { value: "price_desc", label: "Giá cao → thấp" },
  { value: "price_asc", label: "Giá thấp → cao" },
];

const PER_PAGE_OPTIONS = [10, 20, 50];

export default function OrdersPage() {
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [disputeOrderId, setDisputeOrderId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [reviewOrderId, setReviewOrderId] = useState<number | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewedOrders, setReviewedOrders] = useState<Set<number>>(new Set());
  const [dashboardOpen, setDashboardOpen] = useState<Set<number>>(new Set());

  // Filters
  const [tab, setTab] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);

  // Applied filters (only change on Lọc click or tab change)
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedDateFrom, setAppliedDateFrom] = useState("");
  const [appliedDateTo, setAppliedDateTo] = useState("");
  const [appliedSort, setAppliedSort] = useState("newest");

  const fetchOrders = useCallback(async (params: {
    status?: string; search?: string; date_from?: string; date_to?: string;
    sort?: string; page?: number; per_page?: number;
  }) => {
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
    fetchOrders({
      status: tab || undefined,
      search: appliedSearch || undefined,
      date_from: appliedDateFrom || undefined,
      date_to: appliedDateTo || undefined,
      sort: appliedSort,
      page,
      per_page: perPage,
    });
  }, [account, authLoading, router, tab, appliedSearch, appliedDateFrom, appliedDateTo, appliedSort, page, perPage, fetchOrders]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function applyFilters() {
    setAppliedSearch(search);
    setAppliedDateFrom(dateFrom);
    setAppliedDateTo(dateTo);
    setAppliedSort(sort);
    setPage(1);
  }

  function resetFilters() {
    setSearch(""); setDateFrom(""); setDateTo(""); setSort("newest");
    setAppliedSearch(""); setAppliedDateFrom(""); setAppliedDateTo(""); setAppliedSort("newest");
    setPage(1);
  }

  function handleTabChange(t: string) {
    setTab(t);
    setPage(1);
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

  async function handleReviewSubmit(orderId: number) {
    setReviewSubmitting(true);
    try {
      await api.submitReview(orderId, reviewRating, reviewComment || undefined);
      setReviewedOrders((prev) => new Set(prev).add(orderId));
      setReviewOrderId(null); setReviewRating(5); setReviewComment("");
      showToast("Đánh giá thành công!");
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setReviewSubmitting(false);
    }
  }

  function handleDisputeSuccess() {
    setDisputeOrderId(null);
    showToast("Đã gửi khiếu nại thành công!");
    fetchOrders({
      status: tab || undefined, search: appliedSearch || undefined,
      date_from: appliedDateFrom || undefined, date_to: appliedDateTo || undefined,
      sort: appliedSort, page, per_page: perPage,
    });
    api.orderStats().then(setStats).catch(() => {});
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (authLoading) return <div className="w-full mx-auto max-w-[1200px] px-6 py-16"><Spinner /></div>;

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

      <div className="grid lg:grid-cols-[280px_1fr] gap-6 min-w-0">
        {/* ─── Left sidebar: stats + filters ─── */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start space-y-4">
          <div>
            <h2 className="font-serif text-[24px] tracking-tight">Đơn hàng</h2>
            <p className="text-[12.5px] text-muted mt-0.5">Theo dõi và quản lý các đơn đã đặt</p>
          </div>

          {stats && (
            <Card className="p-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Tổng đơn", value: stats.total, tone: "text-fg", icon: Package, chip: "bg-raised text-muted border-line" },
                  { label: "Hoạt động", value: stats.active, tone: "text-iris-hi", icon: Clock, chip: "bg-iris-soft text-iris border-iris/15" },
                  { label: "Khiếu nại", value: stats.disputed, tone: "text-bad", icon: Info, chip: "bg-bad-soft text-bad border-bad/15" },
                  { label: "Chi tiêu", value: vnd(stats.total_spend), tone: "text-fg", icon: Wallet, chip: "bg-good-soft text-good border-good/15" },
                ].map((c) => (
                  <div key={c.label} className="flex items-start gap-2.5">
                    <span className={cn("grid place-items-center h-7 w-7 shrink-0 rounded-md border", c.chip)}>
                      <c.icon size={14} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[10.5px] text-faint uppercase tracking-wider truncate">{c.label}</div>
                      <div className={cn("text-[15px] font-semibold tabular leading-tight mt-0.5", c.tone)}>{c.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-4 space-y-3.5">
            <div className="flex flex-wrap gap-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => handleTabChange(t.key)}
                  className={cn(
                    "px-2.5 py-1 text-[12px] font-medium rounded-md transition-colors",
                    tab === t.key
                      ? "bg-iris text-white"
                      : "bg-raised text-muted hover:text-fg",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div>
              <label className="text-[11px] text-faint uppercase tracking-wider block mb-1.5">Mã đơn</label>
              <Input
                placeholder="Tìm theo mã đơn…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 min-w-0">
              <div className="min-w-0">
                <label className="text-[11px] text-faint uppercase tracking-wider block mb-1.5">Từ ngày</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="min-w-0" />
              </div>
              <div className="min-w-0">
                <label className="text-[11px] text-faint uppercase tracking-wider block mb-1.5">Đến ngày</label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="min-w-0" />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-faint uppercase tracking-wider block mb-1.5">Sắp xếp</label>
              <Select value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={applyFilters} className="flex-1">Lọc</Button>
              <Button size="sm" variant="ghost" onClick={resetFilters}>Reset</Button>
            </div>
          </Card>
        </aside>

        {/* ─── Right: order list ─── */}
        <div className="min-w-0">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[12.5px] text-muted">
              {total} đơn hàng
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">Hiển thị</span>
              <select
                value={perPage}
                onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
                className="h-8 rounded-lg bg-surface border border-line px-2 text-[12px] text-fg"
              >
                {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

      {/* ─── Order List ─── */}
      {loading ? (
        <Spinner />
      ) : orders.length === 0 ? (
        <Card className="p-7 flex flex-col items-center gap-4 text-center">
          <p className="text-[13px] text-muted">Không tìm thấy đơn hàng nào.</p>
          <Link href="/"><Button>Khám phá chợ</Button></Link>
        </Card>
      ) : (
        <div className="flex flex-col gap-3.5">
          {orders.map((o) => {
            const st = STATUS[o.status] ?? { label: o.status, tone: "neutral" as const, hint: "" };
            return (
              <Card key={o.id} className="p-5">
                {/* Header row: only this row splits left/right — everything below spans full card width */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="grid place-items-center h-11 w-11 shrink-0 rounded-lg bg-raised border border-line font-serif text-[14px] font-semibold text-iris">
                      {(o.product_title ?? "??").slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-[14.5px] truncate">{o.product_title ?? `Đơn #${o.id}`}</div>
                      {o.variant_name && <div className="text-[12.5px] text-muted truncate">{o.variant_name}</div>}
                      <div className="text-[11.5px] text-faint mt-0.5">
                        Đơn #{o.id} · SL {o.quantity} · {new Date(o.created_at).toLocaleString("vi-VN")}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-faint uppercase tracking-wider mb-0.5">Tổng tiền</div>
                    <div className="font-mono text-[15.5px] font-semibold tabular">{vnd(o.total_amount)}</div>
                    {o.escrow_expires_at && o.status === "delivered" && (
                      <div className="text-[11px] text-faint mt-1.5 flex items-center gap-1 justify-end">
                        <Shield size={11} className="text-good" /> Ký quỹ đến {new Date(o.escrow_expires_at).toLocaleDateString("vi-VN")}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <Tag tone={st.tone}>{st.label}</Tag>
                  <span className="text-[12px] text-muted">{st.hint}</span>
                </div>

                {o.has_dispute && <OrderDispute orderId={o.id} />}

                {!["disputed", "refunded", "cancelled"].includes(o.status) && (
                  <div className="mt-3 rounded-lg bg-raised/60 border border-line/70">
                    <StatusTimeline status={o.status} />
                  </div>
                )}

                {o.delivered_data && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10.5px] text-faint uppercase tracking-wider">Dữ liệu bàn giao</span>
                      <CopyIconButton text={o.delivered_data} />
                    </div>
                    <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-2.5 whitespace-pre-wrap break-all">{o.delivered_data}</pre>
                  </div>
                )}

                {o.status === "delivered" && (
                  <div className="flex gap-2 mt-3.5">
                    <Button size="sm" onClick={() => handleConfirm(o.id)} disabled={confirmingId === o.id}>
                      {confirmingId === o.id ? "Đang xác nhận…" : "Xác nhận đã nhận"}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setDisputeOrderId(o.id)}>Mở khiếu nại</Button>
                  </div>
                )}

                {o.status === "completed" && !o.has_review && !reviewedOrders.has(o.id) && reviewOrderId !== o.id && (
                  <div className="mt-3.5">
                    <Button size="sm" variant="secondary" onClick={() => { setReviewOrderId(o.id); setReviewRating(5); setReviewComment(""); }}>
                      <Star size={13} /> Đánh giá
                    </Button>
                  </div>
                )}
                {o.status === "completed" && (o.has_review || reviewedOrders.has(o.id)) && (
                  <p className="flex items-center gap-1.5 text-[12px] mt-2.5 text-good font-medium">
                    <Star size={12} className="fill-good" /> Đã đánh giá
                  </p>
                )}
                {reviewOrderId === o.id && (
                  <div className="mt-3 p-3.5 rounded-lg border border-line bg-raised">
                    <div className="flex gap-1 mb-2">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button key={s} onClick={() => setReviewRating(s)} className="p-0.5">
                          <Star size={18} className={s <= reviewRating ? "text-warn fill-warn" : "text-line-2"} />
                        </button>
                      ))}
                    </div>
                    <Textarea rows={3} placeholder="Nhận xét (tuỳ chọn)…" value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} />
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" onClick={() => handleReviewSubmit(o.id)} disabled={reviewSubmitting}>
                        {reviewSubmitting ? "Đang gửi…" : "Gửi đánh giá"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReviewOrderId(null)}>Huỷ</Button>
                    </div>
                  </div>
                )}

                {(o.status === "delivered" || o.status === "completed") && (
                  <Disclosure
                    label="Xem dashboard" labelOpen="Ẩn dashboard"
                    open={dashboardOpen.has(o.id)}
                    onToggle={() => setDashboardOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                      return next;
                    })}
                  >
                    <ServiceDashboard orderId={o.id} />
                  </Disclosure>
                )}
                {(o.status === "delivered" || o.status === "completed") && <OrderResources orderId={o.id} />}
              </Card>
            );
          })}
        </div>
      )}

          {/* ─── Pagination ─── */}
          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Trước
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce<(number | "...")[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === "..." ? (
                    <span key={`ellipsis-${i}`} className="text-muted px-1">...</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className={cn(
                        "w-8 h-8 rounded-lg text-[13px] font-medium",
                        page === p ? "bg-iris text-white" : "text-muted hover:bg-raised",
                      )}
                    >
                      {p}
                    </button>
                  ),
                )}
              <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Sau
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
