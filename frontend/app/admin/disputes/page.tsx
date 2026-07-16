"use client";

import * as React from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { motion } from "motion/react";
import Link from "next/link";

import { api, vnd } from "@/lib/api";
import { Card, Spinner, Button, Textarea, Input } from "@/components/ui";
import {
  FilterPills,
  SearchInput,
  SlidePanel,
  ConfirmModal,
  StatsCard,
} from "@/components/admin";
import { DisputeStatusBadge, OrderStatusBadge } from "@/components/admin/status-badge";
import type { Dispute, AdminDisputeDetail } from "@/lib/types";
import { evidenceFieldLabel, evidenceTypeLabel } from "@/lib/dispute-evidence";

// Status filter options
const STATUS_FILTER = [
  { key: "all", label: "Tất cả" },
  { key: "open", label: "Đang mở" },
  { key: "resolved_refund", label: "Đã hoàn tiền" },
  { key: "resolved_reject", label: "Đã từ chối" },
  { key: "resolved_partial_refund", label: "Hoàn một phần" },
  { key: "resolved_replace", label: "Đã đổi sản phẩm" },
  { key: "resolved_extend_warranty", label: "Đã gia hạn" },
];

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
};

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
    cell: ({ row }) => (
      <span className="text-slate-600 truncate max-w-[160px] block">
        {row.original.buyer_email ?? `#${row.original.buyer_id}`}
      </span>
    ),
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
        <span className="block text-slate-700 whitespace-pre-wrap">
          {row.original.reason}
        </span>
        {row.original.seller_note && (
          <span className="block text-[12px] text-indigo-600 mt-1">
            Phản hồi NB: {row.original.seller_note}
          </span>
        )}
        {row.original.admin_note && (
          <span className="block text-[12px] text-slate-400 mt-1">
            Ghi chú: {row.original.admin_note}
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Trạng thái",
    cell: ({ row }) => <DisputeStatusBadge status={row.original.status} />,
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
  // State
  const [disputes, setDisputes] = React.useState<Dispute[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedDisputeId, setSelectedDisputeId] = React.useState<number | null>(null);
  const [selectedStatus, setSelectedStatus] = React.useState("all");

  // Action modal state
  const [actionModal, setActionModal] = React.useState<{
    id: number;
    action: DisputeAction;
  } | null>(null);
  const [note, setNote] = React.useState("");
  const [amountInput, setAmountInput] = React.useState("");
  const [daysInput, setDaysInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Fetch disputes
  const load = React.useCallback(() => {
    setLoading(true);
    api
      .adminDisputes()
      .then(setDisputes)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // Handle action
  const handleAction = async () => {
    if (!actionModal) return;
    const adminNote = note.trim() || "—";
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
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Xử lý thất bại");
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

  // Filter disputes
  const filteredDisputes = React.useMemo(() => {
    let result = disputes;
    if (selectedStatus !== "all") {
      result = result.filter((d) => d.status === selectedStatus);
    }
    return result;
  }, [disputes, selectedStatus]);

  // Stats
  const openCount = disputes.filter((d) => d.status === "open").length;
  const refundedCount = disputes.filter((d) => d.status === "resolved_refund").length;
  const rejectedCount = disputes.filter((d) => d.status === "resolved_reject").length;

  // Add action column with access to setActionModal
  const allColumns = React.useMemo<ColumnDef<Dispute>[]>(
    () => [
      ...columns,
      {
        id: "actions",
        header: "Hành động",
        cell: ({ row }) =>
          row.original.status === "open" ? (
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setActionModal({ id: row.original.id, action: "refund" });
                }}
              >
                Hoàn tiền
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  setActionModal({ id: row.original.id, action: "reject" });
                }}
              >
                Từ chối
              </Button>
            </div>
          ) : (
            <span className="text-slate-400 text-[12px]">Đã xử lý</span>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Table setup
  const table = useReactTable({
    data: filteredDisputes,
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (loading) {
    return <Spinner label="Đang tải khiếu nại…" />;
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-3 gap-3"
      >
        <StatsCard
          label="Đang mở"
          value={openCount}
          tone="warn"
        />
        <StatsCard
          label="Đã hoàn tiền"
          value={refundedCount}
          tone="bad"
        />
        <StatsCard
          label="Đã từ chối"
          value={rejectedCount}
          tone="good"
        />
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="p-0">
          <div className="px-4 py-3 border-b border-slate-200">
            <FilterPills
              options={STATUS_FILTER}
              value={selectedStatus}
              onChange={setSelectedStatus}
            />
          </div>

          {disputes.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[13px] text-slate-500">Chưa có khiếu nại nào.</p>
            </div>
          ) : filteredDisputes.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[13px] text-slate-500">
                Không có khiếu nại nào ở trạng thái này.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    {table.getHeaderGroups()[0].headers.map((header) => (
                      <th
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        className="px-5 py-2.5 font-medium"
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
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedDisputeId(row.original.id)}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-5 py-3">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>

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
      >
        <div className="space-y-2">
          {actionModal?.action === "partial_refund" && (
            <Input
              type="number"
              placeholder="Số tiền hoàn cho người mua (VNĐ)"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              min="1"
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
