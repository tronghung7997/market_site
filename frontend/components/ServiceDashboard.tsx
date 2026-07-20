"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { DashboardData, DashboardResource, DashboardTask, UsageRecordItem } from "@/lib/types";
import { Banner, Button, Card, Spinner, Tag } from "@/components/ui";
import { Info } from "@/components/Icons";

// RapidAPI cảnh báo buyer ở 85% hạn mức thay vì đợi tới lúc hết hẳn — báo
// trước để buyer chủ động mua thêm, không bị chặn giữa chừng lúc đang dùng.
const LOW_BALANCE_THRESHOLD = 0.8;

/* ── Helpers ── */

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("vi-VN");
}

function daysRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "Vĩnh viễn";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Hết hạn";
  return `${Math.ceil(ms / 86400000)} ngày`;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-raised border border-line rounded-lg p-3">
      <div className="text-[11px] text-faint">{label}</div>
      <div className="text-[18px] font-semibold tabular mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-md bg-raised border border-line hover:border-line-2 transition-colors"
    >
      {copied ? "Đã sao chép!" : label ?? "Sao chép"}
    </button>
  );
}

function MaskedValue({ value }: { value: string }) {
  const [visible, setVisible] = useState(false);
  const masked = value.length > 8 ? value.slice(0, 4) + "****" + value.slice(-4) : "****";
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[12.5px]">
      <span>{visible ? value : masked}</span>
      <button
        onClick={() => setVisible((v) => !v)}
        className="text-[11px] text-iris-hi hover:underline"
      >
        {visible ? "Ẩn" : "Hiện"}
      </button>
      <CopyButton text={value} />
    </span>
  );
}

/* ── Proxy Dashboard ── */

function ProxyDashboard({ data }: { data: DashboardData }) {
  const resources = data.resources ?? [];
  const activeCount = resources.filter((r) => r.status === "assigned" || r.status === "available").length;

  // Find earliest expiry for days remaining
  const expiringResource = resources
    .filter((r) => r.expires_at)
    .sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime())[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Trạng thái" value={data.status === "delivered" ? "Hoạt động" : data.status} />
        <StatCard label="Còn lại" value={daysRemaining(expiringResource?.expires_at ?? null)} />
        <StatCard label="Số IP" value={resources.length} sub={`${activeCount} hoạt động`} />
        <StatCard label="Uptime" value="99.9%" sub="30 ngày qua" />
      </div>

      {resources.length > 0 && (
        <div>
          <h4 className="text-[12.5px] font-medium text-muted mb-2">Danh sách IP / Proxy</h4>
          <div className="space-y-1.5">
            {resources.map((r) => (
              <ResourceRow key={r.id} resource={r} />
            ))}
          </div>
        </div>
      )}

      {resources.length > 0 && (
        <div className="flex gap-2">
          <CopyButton
            text={resources.map((r) => r.data).join("\n")}
            label="Sao chép tất cả"
          />
        </div>
      )}
    </div>
  );
}

function ResourceRow({ resource }: { resource: DashboardResource }) {
  const tone = resource.status === "assigned" ? "good" as const
    : resource.status === "expired" ? "warn" as const
    : resource.status === "error" ? "bad" as const
    : "neutral" as const;
  const label = { assigned: "Hoạt động", expired: "Hết hạn", error: "Lỗi", available: "Sẵn sàng" }[resource.status] ?? resource.status;

  return (
    <div className="flex items-center gap-3 text-[12.5px] px-3 py-2 rounded-lg bg-surface border border-line">
      <span className="font-mono text-faint">#{resource.id}</span>
      <MaskedValue value={resource.data} />
      <Tag tone={tone}>{label}</Tag>
      <span className="ml-auto text-muted text-[11px]">{daysRemaining(resource.expires_at)}</span>
    </div>
  );
}

/* ── Endpoint Dashboard ── */

const USAGE_STATUS_MAP: Record<string, { label: string; tone: "good" | "bad" | "warn" }> = {
  ok: { label: "Thành công", tone: "good" },
  rejected_quota: { label: "Hết credit", tone: "bad" },
  rejected_expired: { label: "Hết hạn", tone: "warn" },
};

function UsageProgressBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const tone = pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-good";
  return (
    <div className="h-2 rounded-full bg-raised overflow-hidden">
      <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function UsageRecordRow({ record }: { record: UsageRecordItem }) {
  const st = USAGE_STATUS_MAP[record.status] ?? { label: record.status, tone: "neutral" as const };
  return (
    <div className="flex items-center gap-3 text-[12px] px-3 py-1.5 rounded-lg bg-surface border border-line">
      <span className="font-mono text-faint">{fmtDate(record.created_at)}</span>
      <span className="font-medium">{record.endpoint}</span>
      <span className="text-faint">−{record.units}</span>
      <Tag tone={st.tone as "good" | "bad" | "warn"} className="ml-auto">{st.label}</Tag>
    </div>
  );
}

function EndpointDashboard({ data, onRefresh }: { data: DashboardData; onRefresh: () => void }) {
  const balance = data.balance;
  const apiKey = data.delivered_data;
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const simulate = async () => {
    setSimulating(true);
    setSimError(null);
    try {
      await api.chargeUsage(data.order_id, "profile", 1);
      onRefresh();
    } catch (e) {
      setSimError(e instanceof ApiError ? e.message : "Không giả lập được request");
      onRefresh(); // vẫn refresh để thấy bản ghi bị từ chối trong lịch sử
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-4">
      {apiKey && (
        <div className="bg-raised border border-line rounded-lg p-3">
          <div className="text-[11px] text-faint mb-1">API Key</div>
          <MaskedValue value={apiKey} />
        </div>
      )}

      {!balance ? (
        <Banner tone="warn" icon={<Info size={15} />} title="Chưa có số dư request">
          Đơn này chưa có số dư theo dõi request — hoặc chưa giao xong, hoặc được mua trước khi
          tính năng này có (không ảnh hưởng key đã nhận ở trên).
        </Banner>
      ) : (
        <>
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <span className="text-[12px] text-muted">Số dư request</span>
              <span className="font-mono text-[13px] font-semibold tabular">
                {balance.units_used.toLocaleString("vi-VN")} / {balance.units_total.toLocaleString("vi-VN")}
              </span>
            </div>
            <UsageProgressBar used={balance.units_used} total={balance.units_total} />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-faint">
                Còn lại {balance.units_remaining.toLocaleString("vi-VN")} request
              </span>
              {balance.expires_at && (
                <span className="text-[11px] text-faint">Hết hạn {fmtDate(balance.expires_at)}</span>
              )}
            </div>
          </div>

          {balance.units_remaining <= 0 ? (
            <Banner
              tone="bad"
              icon={<Info size={15} />}
              title="Hết credit"
              action={data.product_id ? (
                <Link href={`/products/${data.product_id}`}>
                  <Button size="sm" variant="secondary">Mua thêm gói</Button>
                </Link>
              ) : undefined}
            >
              Đã dùng hết số request trong gói này — mua thêm gói mới để tiếp tục.
            </Banner>
          ) : balance.units_used / balance.units_total >= LOW_BALANCE_THRESHOLD && (
            <Banner
              tone="warn"
              icon={<Info size={15} />}
              title="Sắp hết credit"
              action={data.product_id ? (
                <Link href={`/products/${data.product_id}`}>
                  <Button size="sm" variant="secondary">Mua thêm gói</Button>
                </Link>
              ) : undefined}
            >
              Chỉ còn {balance.units_remaining.toLocaleString("vi-VN")} request — mua thêm sớm để không bị gián đoạn.
            </Banner>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={simulate}
              disabled={simulating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md bg-raised border border-line hover:border-line-2 transition-colors disabled:opacity-50"
            >
              {simulating ? "Đang gửi…" : "Giả lập 1 request"}
            </button>
            <span className="text-[11px] text-faint">Dùng để test key — chưa có nhà cung cấp thật gọi vào đây.</span>
          </div>
          {simError && <p className="text-[12px] text-bad">{simError}</p>}

          {balance.records.length > 0 && (
            <div>
              <h4 className="text-[12.5px] font-medium text-muted mb-2">Lịch sử request gần đây</h4>
              <div className="space-y-1.5">
                {balance.records.map((r) => (
                  <UsageRecordRow key={r.id} record={r} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Takedown Dashboard ── */

const TASK_STATUS_MAP: Record<string, { label: string; tone: "good" | "bad" | "warn" | "iris" | "neutral" }> = {
  pending: { label: "Chờ xử lý", tone: "warn" },
  assigned: { label: "Đã nhận", tone: "iris" },
  processing: { label: "Đang xử lý", tone: "iris" },
  completed: { label: "Hoàn tất", tone: "good" },
  failed: { label: "Thất bại", tone: "bad" },
};

function TakedownDashboard({ data }: { data: DashboardData }) {
  const tasks = data.tasks ?? [];
  const completed = tasks.filter((t) => t.status === "completed").length;
  const processing = tasks.filter((t) => t.status === "processing" || t.status === "assigned").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Tổng task" value={tasks.length} />
        <StatCard label="Hoàn tất" value={completed} />
        <StatCard label="Đang xử lý" value={processing} />
      </div>

      {tasks.length > 0 && (
        <div>
          <h4 className="text-[12.5px] font-medium text-muted mb-2">Chi tiết task</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-2 pr-3 font-medium text-faint">ID</th>
                  <th className="py-2 pr-3 font-medium text-faint">Nền tảng</th>
                  <th className="py-2 pr-3 font-medium text-faint">URL</th>
                  <th className="py-2 pr-3 font-medium text-faint">Trạng thái</th>
                  <th className="py-2 pr-3 font-medium text-faint">Người xử lý</th>
                  <th className="py-2 font-medium text-faint">Tạo lúc</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: DashboardTask }) {
  const st = TASK_STATUS_MAP[task.status] ?? { label: task.status, tone: "neutral" as const };
  return (
    <tr className="border-b border-line/50">
      <td className="py-2 pr-3 font-mono text-faint">#{task.id}</td>
      <td className="py-2 pr-3">{task.platform}</td>
      <td className="py-2 pr-3 max-w-[200px] truncate">
        <span className="font-mono text-[11px]">{task.target_url}</span>
      </td>
      <td className="py-2 pr-3"><Tag tone={st.tone}>{st.label}</Tag></td>
      <td className="py-2 pr-3 text-muted">{task.assignee ?? "Chưa có"}</td>
      <td className="py-2 text-muted">{fmtDate(task.created_at)}</td>
    </tr>
  );
}

/* ── Default Dashboard ── */

function DefaultDashboard({ data }: { data: DashboardData }) {
  return (
    <div>
      {data.delivered_data ? (
        <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-2.5 whitespace-pre-wrap break-all">
          {data.delivered_data}
        </pre>
      ) : (
        <p className="text-[12.5px] text-muted">Không có dữ liệu dashboard cho dịch vụ này.</p>
      )}
    </div>
  );
}

/* ── Main ServiceDashboard ── */

export default function ServiceDashboard({ orderId }: { orderId: number }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const d = await api.orderDashboard(orderId);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (loading) return <Spinner label="Đang tải dashboard..." />;
  if (error) return <p className="text-[12px] text-bad py-2">{error}</p>;
  if (!data) return null;

  return (
    <Card className="p-4 mt-3 bg-raised/40">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold">
          Dashboard{data.product_title ? ` — ${data.product_title}` : ""}
        </h3>
        <Tag tone={data.status === "delivered" ? "iris" : data.status === "completed" ? "good" : "neutral"}>
          {data.service_type}
        </Tag>
      </div>
      {data.service_type === "proxy" ? <ProxyDashboard data={data} />
        : data.service_type === "endpoint" ? <EndpointDashboard data={data} onRefresh={load} />
        : data.service_type === "takedown" ? <TakedownDashboard data={data} />
        : <DefaultDashboard data={data} />}
    </Card>
  );
}
