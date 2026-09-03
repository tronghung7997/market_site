"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Card, Spinner, Tag, Button, Field, Select, Input, Textarea } from "@/components/ui";
import type { ServiceTask } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  pending: "Đang chờ",
  assigned: "Đã giao",
  processing: "Đang xử lý",
  completed: "Hoàn thành",
  failed: "Thất bại",
};

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "iris"> = {
  pending: "warn",
  assigned: "iris",
  processing: "iris",
  completed: "good",
  failed: "bad",
};

const STATUS_FILTER = [
  { key: "all", label: "Tất cả" },
  { key: "pending", label: "Đang chờ" },
  { key: "assigned", label: "Đã giao" },
  { key: "processing", label: "Đang xử lý" },
  { key: "completed", label: "Hoàn thành" },
  { key: "failed", label: "Thất bại" },
];

const STATUS_OPTIONS = ["pending", "assigned", "processing", "completed", "failed"];

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Chờ",
  processing: "Đang xử lý",
  delivered: "Đã giao",
  completed: "Hoàn tất",
  disputed: "Khiếu nại",
  refunded: "Đã hoàn tiền",
  cancelled: "Đã huỷ",
};

const ORDER_STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "iris"> = {
  pending: "warn",
  processing: "iris",
  delivered: "good",
  completed: "good",
  disputed: "warn",
  refunded: "neutral",
  cancelled: "bad",
};

/* ---------- Inline Edit Row ---------- */

function TaskEditRow({
  task,
  onSaved,
  onCancel,
}: {
  task: ServiceTask;
  onSaved: (t: ServiceTask) => void;
  onCancel: () => void;
}) {
  const apiErrorMessage = useApiErrorMessage();
  const [status, setStatus] = useState(task.status);
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [resultData, setResultData] = useState(task.result_data ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateTask(task.id, {
        status,
        assignee: assignee || null,
        result_data: resultData || null,
      });
      onSaved(updated);
    } catch (e: unknown) {
      setError(apiErrorMessage(e, "Lỗi khi lưu"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-b border-line bg-raised/30">
      <td colSpan={7} className="px-4 py-4">
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] font-semibold">Chỉnh sửa tác vụ #{task.id}</span>
            <button
              onClick={onCancel}
              className="ml-auto text-muted hover:text-fg text-[14px] px-2"
            >
              &times;
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Trạng thái">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
                ))}
              </Select>
            </Field>

            <Field label="Người xử lý">
              <Input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="email hoặc tên..."
              />
            </Field>

            <div /> {/* spacer */}
          </div>

          <Field label="Kết quả (result_data)">
            <Textarea
              rows={3}
              value={resultData}
              onChange={(e) => setResultData(e.target.value)}
              placeholder="Nội dung kết quả..."
              className="font-mono text-[12px]"
            />
          </Field>

          {error && <p className="text-[12px] text-bad">{error}</p>}

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Đang lưu..." : "Lưu"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Huy
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

/* ---------- Main Page ---------- */

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<ServiceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);

  const loadTasks = useCallback(() => {
    setLoading(true);
    api
      .adminTasks()
      .catch(() => [])
      .then((t) => setTasks(t ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const filteredTasks = useMemo(() => {
    if (selectedFilter === "all") return tasks;
    return tasks.filter((t) => t.status === selectedFilter);
  }, [tasks, selectedFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tasks.length };
    for (const t of tasks) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    return counts;
  }, [tasks]);

  const handleSaved = (updated: ServiceTask) => {
    const before = tasks.find((t) => t.id === updated.id);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === updated.id) return updated;
        // order status thay đổi ảnh hưởng mọi task cùng đơn
        if (t.order_id === updated.order_id) return { ...t, order_status: updated.order_status };
        return t;
      }),
    );
    setEditingId(null);
    if (updated.order_status && before?.order_status !== updated.order_status) {
      const label = ORDER_STATUS_LABELS[updated.order_status] ?? updated.order_status;
      setOrderNotice(`Đơn #${updated.order_id} chuyển sang "${label}"`);
      setTimeout(() => setOrderNotice(null), 5000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTER.map((f) => (
          <button
            key={f.key}
            onClick={() => setSelectedFilter(f.key)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
              selectedFilter === f.key
                ? "bg-iris text-white"
                : "bg-surface text-muted hover:text-fg border border-line"
            }`}
          >
            {f.label}
            {statusCounts[f.key] != null && (
              <span className="ml-1.5 font-mono">({statusCounts[f.key]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Order status change notice */}
      {orderNotice && (
        <div className="rounded-lg bg-good-soft border border-good/25 px-3 py-2">
          <p className="text-[12px] text-good">{orderNotice}</p>
        </div>
      )}

      {/* Table */}
      <Card className="p-0">
        {loading ? (
          <Spinner />
        ) : filteredTasks.length === 0 ? (
          <p className="text-[13px] text-muted px-4 py-8 text-center">
            {tasks.length === 0 ? "Chưa có tác vụ nào." : "Không có tác vụ phù hợp."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="px-4 py-2.5 font-medium">ID</th>
                  <th className="px-4 py-2.5 font-medium">Đơn hàng</th>
                  <th className="px-4 py-2.5 font-medium">Nền tảng</th>
                  <th className="px-4 py-2.5 font-medium">URL mục tiêu</th>
                  <th className="px-4 py-2.5 font-medium">Trạng thái</th>
                  <th className="px-4 py-2.5 font-medium">Người xử lý</th>
                  <th className="px-4 py-2.5 font-medium">Tạo lúc</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((t) =>
                  editingId === t.id ? (
                    <TaskEditRow
                      key={t.id}
                      task={t}
                      onSaved={handleSaved}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <tr
                      key={t.id}
                      onClick={() => setEditingId(t.id)}
                      className="border-b border-line last:border-0 hover:bg-raised/50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-mono text-muted">#{t.id}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono">#{t.order_id}</span>
                        {t.order_status && (
                          <span className="ml-1.5 inline-block align-middle">
                            <Tag tone={ORDER_STATUS_TONE[t.order_status] ?? "neutral"}>
                              {ORDER_STATUS_LABELS[t.order_status] ?? t.order_status}
                            </Tag>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Tag tone="neutral">{t.platform}</Tag>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[12px] text-muted truncate max-w-[220px] block">
                          {t.target_url}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Tag tone={STATUS_TONE[t.status] ?? "neutral"}>
                          {STATUS_LABELS[t.status] ?? t.status}
                        </Tag>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-muted">
                        {t.assignee ?? "--"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-muted">
                        {new Date(t.created_at).toLocaleString("vi-VN")}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filteredTasks.length > 0 && (
          <div className="px-4 py-3 border-t border-line text-[12px] text-muted">
            Hiển thị {filteredTasks.length} / {tasks.length} tác vụ
          </div>
        )}
      </Card>
    </div>
  );
}
