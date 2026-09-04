"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { ListFilter, Search, X } from "lucide-react";
import { useDebounce } from "@/lib/hooks/useDebounce";

import { api, vnd } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Banner, Card, Spinner, Button, Textarea, Input } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";
import {
  FacetSelect,
  buildFacetOptions,
  SlidePanel,
  ConfirmModal,
} from "@/components/admin";
import { DisputeStatusBadge, OrderStatusBadge } from "@/components/admin/status-badge";
import type { Dispute, AdminDisputeDetail } from "@/lib/types";
import { evidenceFieldLabel, evidenceTypeLabel } from "@/lib/dispute-evidence";

const DEFAULT_PAGE_SIZE = 20;

// Tab trạng thái — color dùng chung cho chấm trên tab và đoạn tương ứng
// trong thanh phân bố (đồng bộ khuôn console với các trang admin khác).
const STATUS_TABS: { key: string; label: string; color?: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "pending_review", label: "Chờ review", color: "bg-fuchsia-400" },
  { key: "open", label: "Đang mở", color: "bg-amber-400" },
  { key: "resolved_refund", label: "Hoàn tiền", color: "bg-red-400" },
  { key: "resolved_partial_refund", label: "Hoàn một phần", color: "bg-rose-300" },
  { key: "resolved_replace", label: "Đổi sản phẩm", color: "bg-indigo-400" },
  { key: "resolved_extend_warranty", label: "Gia hạn", color: "bg-sky-400" },
  { key: "resolved_reject", label: "Từ chối", color: "bg-emerald-400" },
  { key: "resolved_timeout", label: "Buyer im", color: "bg-teal-400" },
  { key: "withdrawn_by_buyer", label: "Buyer rút", color: "bg-slate-400" },
  { key: "resolved_abandoned", label: "Bỏ cuộc", color: "bg-teal-300" },
];

// Cột số căn phải (header lẫn cell)
const RIGHT_COLS = new Set(["order_amount"]);

const SKELETON_WIDTHS = ["30%", "40%", "75%", "60%", "50%", "85%", "55%", "45%"];

interface DisputesTableMeta {
  filterBuyer: (key: string) => void;
  openAction: (id: number, action: DisputeAction) => void;
}

// Event labels for timeline
const EVENT_LABELS: Record<string, string> = {
  order_placed: "Đặt hàng",
  order_confirmed: "Xác nhận",
  order_delivered_manual: "Giao hàng (thủ công)",
  resources_assigned: "Cấp phát tài nguyên",
  dispute_opened: "Mở khiếu nại",
  dispute_refunded: "Hoàn tiền khiếu nại",
  dispute_rejected: "Từ chối khiếu nại",
  dispute_partial_refunded: "Hoàn tiền một phần",
  dispute_replaced: "Đổi sản phẩm",
  dispute_warranty_extended: "Gia hạn bảo hành",
  dispute_resolution_timeout: "Tự đóng — buyer không phản hồi",
  dispute_abandoned: "Tự đóng — không thao tác sau hạn ký quỹ",
  dispute_marketplace_review: "Chờ review Marketplace",
};

function isPendingReview(d: Dispute) {
  return d.status === "open" && Boolean(d.review_requested_at);
}

type DisputeAction = "refund" | "reject" | "partial_refund" | "replace" | "extend_warranty";

// Table columns
const columns: ColumnDef<Dispute>[] = [
  {
    accessorKey: "id",
    header: "#",
    cell: ({ row }) => (
      <span className="font-mono text-slate-400">#{row.original.id}</span>
    ),
  },
  {
    accessorKey: "order_id",
    header: "Đơn",
    cell: ({ row }) => (
      <Link
        href={`/admin/orders?highlight=${row.original.order_id}`}
        className="text-indigo-600 hover:underline font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        #{row.original.order_id}
      </Link>
    ),
  },
  {
    accessorKey: "product_title",
    header: "Sản phẩm",
    cell: ({ row }) => (
      <div className="max-w-[200px]">
        <span className="truncate block">
          {row.original.product_title || "—"}
        </span>
        {row.original.variant_name && (
          <span className="text-[12px] text-slate-400 truncate block">
            {row.original.variant_name}
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "buyer_email",
    header: "Người mua",
    cell: ({ row, table }) => {
      const label = row.original.buyer_email ?? `#${row.original.buyer_id}`;
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            (table.options.meta as DisputesTableMeta).filterBuyer(label);
          }}
          title="Lọc theo người mua này"
          className="group/party flex max-w-[160px] items-center gap-1 text-slate-600 hover:text-indigo-700 transition-colors"
        >
          <span className="truncate">{label}</span>
          <ListFilter
            size={11}
            className="shrink-0 text-indigo-500 opacity-0 group-hover/party:opacity-100 transition-opacity"
          />
        </button>
      );
    },
  },
  {
    accessorKey: "order_amount",
    header: "Số tiền",
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {row.original.order_amount != null ? vnd(row.original.order_amount) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "reason",
    header: "Lý do",
    cell: ({ row }) => (
      <div className="max-w-[280px]">
        <span className="block text-slate-700 line-clamp-2" title={row.original.reason}>
          {row.original.reason}
        </span>
        {row.original.seller_note && (
          <span className="block truncate text-[12px] text-indigo-600 mt-1" title={row.original.seller_note}>
            Người bán: {row.original.seller_note}
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Trạng thái",
    cell: ({ row }) => (
      <div className="flex flex-col items-start gap-1">
        <DisputeStatusBadge status={row.original.status} />
        {isPendingReview(row.original) && (
          <span className="inline-flex items-center rounded-md border border-fuchsia-200 bg-fuchsia-50 px-1.5 py-0.5 text-[11px] font-medium text-fuchsia-700">
            Chờ review
          </span>
        )}
      </div>
    ),
  },
  {
    id: "actions",
    header: "Hành động",
    cell: ({ row, table }) => {
      const meta = table.options.meta as DisputesTableMeta;
      return row.original.status === "open" ? (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="danger"
            onClick={(e) => {
              e.stopPropagation();
              meta.openAction(row.original.id, "refund");
            }}
          >
            Hoàn tiền
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              meta.openAction(row.original.id, "reject");
            }}
          >
            Từ chối
          </Button>
        </div>
      ) : (
        <span className="text-slate-400 text-[12px]">Đã xử lý</span>
      );
    },
  },
];

// Detail Panel Content
function DisputeDetailContent({
  disputeId,
  onAction,
}: {
  disputeId: number;
  onAction: (action: DisputeAction) => void;
}) {
  const [detail, setDetail] = React.useState<AdminDisputeDetail | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    api
      .adminDisputeDetail(disputeId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [disputeId]);

  if (loading) {
    return <Spinner />;
  }

  if (!detail) {
    return (
      <p className="text-[13px] text-slate-500 p-5">
        Không thể tải thông tin khiếu nại.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dispute Info */}
      <section>
        <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Thông tin khiếu nại
        </h3>
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <div>
            <p className="text-slate-500 text-[11.5px]">Lý do</p>
            <p className="font-medium">{detail.reason}</p>
          </div>
          <div>
            <p className="text-slate-500 text-[11.5px]">Trạng thái</p>
            <DisputeStatusBadge status={detail.status} />
            {detail.status === "open" && detail.review_requested_at && (
              <p className="mt-1 text-[12px] text-fuchsia-700">Chờ review Marketplace</p>
            )}
          </div>
          {detail.evidence && Object.keys(detail.evidence).length > 0 && (
            <div className="col-span-2">
              <p className="text-slate-500 text-[11.5px]">
                Bằng chứng — {evidenceTypeLabel(detail.evidence_type)}
              </p>
              <div className="mt-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] space-y-0.5">
                {Object.entries(detail.evidence).map(([key, value]) => (
                  <p key={key}>
                    <span className="text-slate-500">{evidenceFieldLabel(detail.evidence_type, key)}: </span>
                    <span className="font-medium">{value}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-slate-500 text-[11.5px]">Người mua</p>
            <p>{detail.order?.buyer_email ?? `#${detail.buyer_id}`}</p>
          </div>
          <div>
            <p className="text-slate-500 text-[11.5px]">Số tiền</p>
            <p className="font-mono font-semibold">
              {detail.order?.total_amount != null
                ? vnd(detail.order.total_amount)
                : "—"}
            </p>
          </div>
          {detail.review_requested_at && (
            <div className="col-span-2 rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-[12px] text-fuchsia-800">
              Auto-settlement đang tạm dừng. Chat với các bên tại{" "}
              <Link href="/admin/support" className="font-medium text-indigo-600 hover:underline">
                Chat Marketplace
              </Link>
              . Hoàn hoặc từ chối ở đây để chốt tiền.
            </div>
          )}
          {detail.resolved_at && (
            <div>
              <p className="text-slate-500 text-[11.5px]">Giải quyết lúc</p>
              <p className="text-[12px]">
                {new Date(detail.resolved_at).toLocaleString("vi-VN")}
              </p>
            </div>
          )}
          {detail.seller_note && (
            <div className="col-span-2">
              <p className="text-slate-500 text-[11.5px]">Phản hồi nhà bán</p>
              <div className="mt-1 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 text-[12px] text-indigo-800">
                {detail.seller_note}
              </div>
            </div>
          )}
          {detail.admin_note && (
            <div className="col-span-2">
              <p className="text-slate-500 text-[11.5px]">Ghi chú admin</p>
              <p className="text-[12px] italic">{detail.admin_note}</p>
            </div>
          )}
        </div>
      </section>

      {/* Order Info */}
      {detail.order && (
        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Đơn hàng liên quan
          </h3>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <p className="text-slate-500 text-[11.5px]">Mã đơn</p>
              <Link
                href={`/admin/orders?highlight=${detail.order.id}`}
                className="font-mono text-indigo-600 hover:underline"
              >
                #{detail.order.id}
              </Link>
            </div>
            <div>
              <p className="text-slate-500 text-[11.5px]">Sản phẩm</p>
              <p className="font-medium">
                {detail.order.product_title ?? `Variant #${detail.order.variant_id}`}
              </p>
              {detail.order.variant_name && (
                <p className="text-[11.5px] text-slate-400">
                  {detail.order.variant_name}
                </p>
              )}
            </div>
            <div>
              <p className="text-slate-500 text-[11.5px]">Người bán</p>
              <p>{detail.order.seller_email ?? `#${detail.order.seller_id}`}</p>
            </div>
            <div>
              <p className="text-slate-500 text-[11.5px]">Số lượng</p>
              <p className="font-mono">{detail.order.quantity}</p>
            </div>
            <div>
              <p className="text-slate-500 text-[11.5px]">Trạng thái đơn</p>
              <OrderStatusBadge status={detail.order.status} />
            </div>
            <div>
              <p className="text-slate-500 text-[11.5px]">Ngày đặt</p>
              <p>{new Date(detail.order.created_at).toLocaleDateString("vi-VN")}</p>
            </div>
            {detail.order.delivered_data && (
              <div className="col-span-2">
                <p className="text-slate-500 text-[11.5px]">Dữ liệu giao hàng</p>
                <pre className="text-[12px] bg-slate-50 px-2 py-1.5 rounded border border-slate-200 overflow-x-auto whitespace-pre-wrap">
                  {detail.order.delivered_data}
                </pre>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Timeline */}
      {detail.timeline.length > 0 && (
        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Dòng thời gian
          </h3>
          <div className="relative pl-5">
            <div className="absolute left-[7px] top-1 bottom-1 w-px bg-slate-200" />
            {detail.timeline.map((evt, i) => {
              const isLast = i === detail.timeline.length - 1;
              return (
                <div key={i} className="relative pb-4 last:pb-0">
                  <div
                    className={`absolute -left-5 top-[5px] w-[10px] h-[10px] rounded-full border-2 ${
                      isLast
                        ? "bg-indigo-500 border-indigo-500"
                        : "bg-white border-slate-200"
                    }`}
                  />
                  <p
                    className={`text-[13px] font-medium ${
                      isLast ? "text-slate-900" : "text-slate-500"
                    }`}
                  >
                    {EVENT_LABELS[evt.event] || evt.event}
                  </p>
                  <p className="text-[11.5px] text-slate-400">
                    {new Date(evt.timestamp).toLocaleString("vi-VN")}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Resources */}
      {detail.resources.length > 0 && (
        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Tài nguyên ({detail.resources.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                  <th className="px-3 py-2 font-medium">Hết hạn</th>
                </tr>
              </thead>
              <tbody>
                {detail.resources.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-mono">#{r.id}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
                          r.status === "assigned"
                            ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                            : r.status === "expired"
                            ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-slate-100 text-slate-600 border-slate-200"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.expires_at
                        ? new Date(r.expires_at).toLocaleDateString("vi-VN")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Additional resolution actions */}
      {detail.status === "open" && (
        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Xử lý khác
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => onAction("partial_refund")}>
              Hoàn tiền một phần
            </Button>
            {detail.resources.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => onAction("replace")}>
                Đổi sản phẩm
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => onAction("extend_warranty")}>
              Gia hạn bảo hành
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

export default function AdminDisputesPage() {
  const apiErrorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();
  const linkedDisputeId = React.useMemo(() => {
    const value = Number(searchParams.get("dispute_id"));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }, [searchParams]);
  // Filter & pagination state
  const [status, setStatus] = React.useState("all");
  const [buyerKey, setBuyerKey] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [selectedDisputeId, setSelectedDisputeId] = React.useState<number | null>(linkedDisputeId);

  React.useEffect(() => {
    if (linkedDisputeId !== null) setSelectedDisputeId(linkedDisputeId);
  }, [linkedDisputeId]);

  // Action modal state
  const [actionModal, setActionModal] = React.useState<{
    id: number;
    action: DisputeAction;
  } | null>(null);
  const [note, setNote] = React.useState("");
  const [amountInput, setAmountInput] = React.useState("");
  const [daysInput, setDaysInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const debouncedSearch = useDebounce(search, 300);

  React.useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [status, buyerKey, debouncedSearch]);

  const queryResult = useQuery({
    queryKey: ["admin", "disputes"] as const,
    queryFn: () => api.adminDisputes(),
    staleTime: 30_000,
  });

  const allDisputes = React.useMemo(() => queryResult.data?.items ?? [], [queryResult.data]);

  const buyerOf = (d: Dispute) => d.buyer_email ?? `#${d.buyer_id}`;

  // Tầng lọc: search → người mua → trạng thái
  const searchScope = React.useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return allDisputes;
    return allDisputes.filter(
      (d) =>
        d.reason.toLowerCase().includes(q) ||
        d.buyer_email?.toLowerCase().includes(q) ||
        d.product_title?.toLowerCase().includes(q) ||
        String(d.order_id).includes(q)
    );
  }, [allDisputes, debouncedSearch]);

  const buyerOptions = React.useMemo(
    () => buildFacetOptions(searchScope, allDisputes, buyerKey, buyerOf, buyerOf),
    [searchScope, allDisputes, buyerKey]
  );

  const scope = React.useMemo(
    () => (buyerKey === null ? searchScope : searchScope.filter((d) => buyerOf(d) === buyerKey)),
    [searchScope, buyerKey]
  );

  const tabCounts = React.useMemo(() => {
    const counts: Record<string, number> = { all: scope.length };
    for (const tab of STATUS_TABS) {
      if (tab.key === "all") continue;
      counts[tab.key] = tab.key === "pending_review"
        ? scope.filter(isPendingReview).length
        : scope.filter((d) => d.status === tab.key).length;
    }
    return counts;
  }, [scope]);

  const barSegments = React.useMemo(() => {
    const segments = STATUS_TABS.filter((t) => t.key !== "all").map((t) => ({
      key: t.key,
      label: t.label,
      count: tabCounts[t.key] ?? 0,
      color: t.color!,
    }));
    return segments.filter((s) => s.count > 0);
  }, [tabCounts]);

  // Đang mở xếp trước (việc cần xử lý), mới nhất trước trong cùng nhóm
  const filteredDisputes = React.useMemo(() => {
    const base = status === "all"
      ? scope
      : status === "pending_review"
        ? scope.filter(isPendingReview)
        : scope.filter((d) => d.status === status);
    return [...base].sort((a, b) => {
      const reviewDiff = Number(isPendingReview(b)) - Number(isPendingReview(a));
      if (reviewDiff !== 0) return reviewDiff;
      const openDiff = Number(b.status === "open") - Number(a.status === "open");
      if (openDiff !== 0) return openDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [scope, status]);

  const total = filteredDisputes.length;
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));

  React.useEffect(() => {
    setPagination((p) =>
      p.pageIndex > 0 && p.pageIndex >= totalPages ? { ...p, pageIndex: 0 } : p
    );
  }, [totalPages]);

  const tableMeta = React.useMemo<DisputesTableMeta>(
    () => ({
      filterBuyer: (key: string) => setBuyerKey(key),
      openAction: (id: number, action: DisputeAction) => setActionModal({ id, action }),
    }),
    []
  );

  const table = useReactTable({
    data: filteredDisputes,
    columns,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    meta: tableMeta,
  });

  const page = pagination.pageIndex + 1;
  const loadingOrFetching = queryResult.isLoading || queryResult.isFetching;
  const hasFilters = status !== "all" || buyerKey !== null || search.trim() !== "";

  const clearFilters = () => {
    setStatus("all");
    setBuyerKey(null);
    setSearch("");
  };

  // Handle action
  const handleAction = async () => {
    if (!actionModal) return;
    const adminNote = note.trim();
    setBusy(true);
    try {
      switch (actionModal.action) {
        case "refund":
          await api.refundDispute(actionModal.id, adminNote);
          break;
        case "reject":
          await api.rejectDispute(actionModal.id, adminNote);
          break;
        case "partial_refund": {
          const amount = parseInt(amountInput) || 0;
          if (amount <= 0) { alert("Vui lòng nhập số tiền hoàn hợp lệ"); setBusy(false); return; }
          await api.partialRefundDispute(actionModal.id, adminNote, amount);
          break;
        }
        case "replace":
          await api.replaceDispute(actionModal.id, adminNote);
          break;
        case "extend_warranty": {
          const days = parseInt(daysInput) || 0;
          if (days <= 0) { alert("Vui lòng nhập số ngày gia hạn hợp lệ"); setBusy(false); return; }
          await api.extendWarrantyDispute(actionModal.id, adminNote, days);
          break;
        }
      }
      setActionModal(null);
      setNote("");
      setAmountInput("");
      setDaysInput("");
      queryResult.refetch();
    } catch (err) {
      alert(apiErrorMessage(err, "Xử lý thất bại"));
    } finally {
      setBusy(false);
    }
  };

  const ACTION_LABELS: Record<DisputeAction, { title: string; description: string; confirmText: string; variant: "danger" | "primary" }> = {
    refund: { title: "Hoàn tiền cho người mua", description: "Tiền ký quỹ sẽ được hoàn về ví người mua.", confirmText: "Hoàn tiền", variant: "danger" },
    reject: { title: "Từ chối khiếu nại", description: "Đơn sẽ hoàn tất và tiền chuyển cho người bán.", confirmText: "Từ chối", variant: "primary" },
    partial_refund: { title: "Hoàn tiền một phần", description: "Một phần tiền hoàn về người mua, phần còn lại chuyển cho người bán.", confirmText: "Hoàn tiền một phần", variant: "danger" },
    replace: { title: "Đổi sản phẩm", description: "Tài nguyên hiện tại được thu hồi, cấp phát tài nguyên mới cho người mua và mở lại thời gian ký quỹ.", confirmText: "Đổi sản phẩm", variant: "primary" },
    extend_warranty: { title: "Gia hạn bảo hành", description: "Thời gian ký quỹ của đơn được kéo dài thêm, người mua có thêm thời gian kiểm tra.", confirmText: "Gia hạn", variant: "primary" },
  };

  return (
    <div className="animate-rise">
      <Card className="p-0">
        {/* Dải chỉ số + thanh phân bố trạng thái (theo phạm vi đang lọc) */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-4 pt-4 pb-3">
          <div className="flex items-baseline gap-8">
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
                Khiếu nại
              </p>
              <p className="text-[26px] leading-8 font-semibold font-mono tabular-nums text-slate-900">
                {scope.length.toLocaleString("vi-VN")}
              </p>
            </div>
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
                Đang mở
              </p>
              <p
                className={`text-[26px] leading-8 font-semibold font-mono tabular-nums ${
                  (tabCounts.open ?? 0) > 0 ? "text-amber-600" : "text-slate-900"
                }`}
              >
                {(tabCounts.open ?? 0).toLocaleString("vi-VN")}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">cần xử lý trước</p>
            </div>
          </div>

          {scope.length > 0 && (
            <div className="w-full min-w-[240px] flex-1 sm:w-auto sm:max-w-sm">
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                {barSegments.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStatus(s.key)}
                    title={`${s.label}: ${s.count.toLocaleString("vi-VN")} khiếu nại`}
                    aria-label={`${s.label}: ${s.count.toLocaleString("vi-VN")} khiếu nại`}
                    className={`${s.color} min-w-[5px] transition-opacity hover:opacity-75`}
                    style={{ flexGrow: s.count, flexBasis: 0 }}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-right text-[11px] text-slate-400">
                Phân bố trạng thái — bấm một đoạn để lọc
              </p>
            </div>
          )}
        </div>

        {/* Bộ lọc: người mua · tìm kiếm */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <FacetSelect
            label="Người mua"
            options={buyerOptions}
            value={buyerKey}
            onChange={setBuyerKey}
          />
          <div className="relative min-w-[180px] max-w-xs flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm lý do, mã đơn, sản phẩm…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-8 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Xóa tìm kiếm"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              <X size={13} />
              Xóa lọc
            </button>
          )}
        </div>

        {/* Tab trạng thái với số đếm */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-slate-200 px-2">
          {STATUS_TABS.map((t) => {
            const active = status === t.key;
            const count = tabCounts[t.key] ?? 0;
            return (
              <button
                key={t.key}
                onClick={() => setStatus(t.key)}
                aria-pressed={active}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? "border-indigo-600 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.color && <span className={`h-1.5 w-1.5 rounded-full ${t.color}`} />}
                {t.label}
                <span
                  className={`tabular-nums text-[11px] ${
                    active ? "font-semibold text-indigo-600" : "text-slate-400"
                  }`}
                >
                  {count.toLocaleString("vi-VN")}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div className="relative">
          {loadingOrFetching && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
            </div>
          )}

          {queryResult.isError && (
            <div className="px-4 py-3">
              <Banner tone="bad">Không tải được danh sách khiếu nại. Thử tải lại trang.</Banner>
            </div>
          )}

          {total === 0 && !queryResult.isLoading ? (
            <div className="px-4 py-14 text-center">
              <p className="text-[13px] text-slate-500">
                {allDisputes.length === 0
                  ? "Chưa có khiếu nại nào."
                  : "Không có khiếu nại khớp bộ lọc hiện tại."}
              </p>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                >
                  <X size={13} />
                  Xóa bộ lọc
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                    {table.getHeaderGroups()[0].headers.map((header) => (
                      <th
                        key={header.id}
                        className={`px-4 py-2.5 font-medium ${
                          RIGHT_COLS.has(header.column.id) ? "text-right" : ""
                        }`}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queryResult.isLoading ? (
                    // Skeleton rows
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        {columns.map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div
                              className="h-4 animate-pulse rounded bg-slate-100"
                              style={{ width: SKELETON_WIDTHS[j % SKELETON_WIDTHS.length] }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedDisputeId(row.original.id)}
                        className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={`px-4 py-2.5 ${
                              RIGHT_COLS.has(cell.column.id) ? "text-right" : ""
                            }`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <span className="text-[12px] text-slate-500 tabular-nums">
              Hiển thị {(page - 1) * pagination.pageSize + 1}–
              {Math.min(page * pagination.pageSize, total)} / {total.toLocaleString("vi-VN")} khiếu nại
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ←
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => table.setPageIndex(pageNum - 1)}
                    className={`h-8 w-8 rounded-lg text-[12px] font-medium transition-colors ${
                      page === pageNum
                        ? "bg-indigo-600 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                →
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail Panel */}
      <SlidePanel
        isOpen={selectedDisputeId !== null}
        onClose={() => setSelectedDisputeId(null)}
        title={`Khiếu nại #${selectedDisputeId}`}
        width="lg"
      >
        {selectedDisputeId !== null && (
          <DisputeDetailContent
            disputeId={selectedDisputeId}
            onAction={(action) => setActionModal({ id: selectedDisputeId, action })}
          />
        )}
      </SlidePanel>

      {/* Action Modal */}
      <ConfirmModal
        isOpen={actionModal !== null}
        onClose={() => {
          setActionModal(null);
          setNote("");
          setAmountInput("");
          setDaysInput("");
        }}
        onConfirm={handleAction}
        title={actionModal ? ACTION_LABELS[actionModal.action].title : ""}
        description={actionModal ? ACTION_LABELS[actionModal.action].description : ""}
        confirmText={actionModal ? ACTION_LABELS[actionModal.action].confirmText : "Xác nhận"}
        variant={actionModal ? ACTION_LABELS[actionModal.action].variant : "primary"}
        isLoading={busy}
        confirmDisabled={actionModal?.action === "partial_refund" && !(parseInt(amountInput, 10) > 0)}
      >
        <div className="space-y-2">
          {actionModal?.action === "partial_refund" && (
            <MoneyInput
              placeholder="Số tiền hoàn cho người mua"
              value={amountInput}
              onValueChange={setAmountInput}
            />
          )}
          {actionModal?.action === "extend_warranty" && (
            <Input
              type="number"
              placeholder="Số ngày gia hạn"
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
              min="1"
            />
          )}
          <Textarea
            placeholder="Ghi chú (không bắt buộc)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-[60px]"
          />
        </div>
      </ConfirmModal>
    </div>
  );
}
