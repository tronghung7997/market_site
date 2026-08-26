"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { DashboardData, DashboardResource, DashboardTask, GatewayCallLogItem, UsageRecordItem } from "@/lib/types";
import { Banner, Button, Card, Spinner, Tag } from "@/components/ui";
import { Info } from "@/components/Icons";

// RapidAPI cảnh báo buyer ở 85% hạn mức thay vì đợi tới lúc hết hẳn — báo
// trước để buyer chủ động mua thêm, không bị chặn giữa chừng lúc đang dùng.
const LOW_BALANCE_THRESHOLD = 0.8;

/* ── Helpers ── */

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function fmtDate(iso: string, locale = "vi") {
  return new Date(iso).toLocaleString(locale === "en" ? "en-US" : "vi-VN");
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
  const locale = useLocale();
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
      {copied ? (locale === "en" ? "Copied!" : "Đã sao chép!") : label ?? (locale === "en" ? "Copy" : "Sao chép")}
    </button>
  );
}

function maskSecret(value: string): string {
  return value.length > 8 ? value.slice(0, 4) + "****" + value.slice(-4) : "****";
}

/** `value` là thứ hiển thị/che; `copyValue` là thứ thực sự cần dán đi.
 *  Hai thứ tách nhau vì địa chỉ gọi CHỨA key: che key ở dòng trên rồi in
 *  nguyên nó trong URL dòng dưới thì việc che chỉ là hình thức. Nút Sao chép
 *  vẫn đưa bản đầy đủ nên buyer không mất gì. */
function MaskedValue({ value, display, copyValue }: { value: string; display?: string; copyValue?: string }) {
  const locale = useLocale();
  const [visible, setVisible] = useState(false);
  const masked = display ?? maskSecret(value);
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[12.5px] break-all">
      <span>{visible ? (copyValue ?? value) : masked}</span>
      <button
        onClick={() => setVisible((v) => !v)}
        className="text-[11px] text-iris-hi hover:underline"
      >
        {visible ? (locale === "en" ? "Hide" : "Ẩn") : (locale === "en" ? "Show" : "Hiện")}
      </button>
      <CopyButton text={copyValue ?? value} />
    </span>
  );
}

/* ── Proxy Dashboard ── */

// Trạng thái đến từ HAI nguồn: bảng `resources` (đơn kiểu cũ) và
// `proxy_allocations` (đơn mua qua adapter). Gộp nhãn về một chỗ để dashboard
// không hiện ra mã máy như "allocated"/"offline".
const PROXY_STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  assigned: { label: "Hoạt động", tone: "good" },
  available: { label: "Sẵn sàng", tone: "neutral" },
  allocated: { label: "Hoạt động", tone: "good" },
  offline: { label: "Tạm ngoại tuyến", tone: "warn" },
  expired: { label: "Hết hạn", tone: "warn" },
  released: { label: "Đã thu hồi", tone: "neutral" },
  error: { label: "Lỗi", tone: "bad" },
};
const PROXY_ACTIVE_STATUSES = new Set(["assigned", "available", "allocated"]);

function ProxyDashboard({ data }: { data: DashboardData }) {
  const resources = data.resources ?? [];
  const activeCount = resources.filter((r) => PROXY_ACTIVE_STATUSES.has(r.status)).length;

  // Find earliest expiry for days remaining
  const expiringResource = resources
    .filter((r) => r.expires_at)
    .sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime())[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Trạng thái" value={data.status === "delivered" ? "Hoạt động" : data.status} />
        <StatCard label="Còn lại" value={daysRemaining(expiringResource?.expires_at ?? null)} />
        <StatCard label="Số IP" value={resources.length} sub={`${activeCount} hoạt động`} />
        {/* Ô "Uptime 99.9% / 30 ngày qua" đã bị bỏ: đó là chuỗi hardcode, không
            hề đo đạc gì — một con số bịa đặt hiển thị như dữ liệu thật. Không
            có nguồn uptime nào ở backend thì đừng hứa với buyer. */}
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

      {/* Chỉ hiện khi thật sự có gì để chép — lọc bỏ binding chưa có IP, không
          thì nút chép ra một chuỗi toàn dòng trống. */}
      {resources.some((r) => r.data) && (
        <div className="flex gap-2">
          <CopyButton
            text={resources.filter((r) => r.data).map((r) => r.data).join("\n")}
            label="Sao chép tất cả"
          />
        </div>
      )}
    </div>
  );
}

function ResourceRow({ resource }: { resource: DashboardResource }) {
  const { label, tone } = PROXY_STATUS[resource.status] ?? { label: resource.status, tone: "neutral" as const };
  // `data` có thể rỗng: binding key xoay chỉ mang IP hiện hành (và chưa có IP
  // nào trước lần lấy proxy đầu tiên). MaskedValue giả định chuỗi khác rỗng —
  // đưa undefined/"" vào là nổ ngay khi render.
  // Chỉ che thứ thật sự là bí mật. Resource kiểu cũ mang nguyên chuỗi
  // "ip:port:user:pass" — che là đúng. Binding proxy mua qua adapter chỉ mang
  // IP hiện hành, mà IP đó đã hiện nguyên văn ở panel proxy và "Dữ liệu bàn
  // giao" ngay phía trên — che ở đây chỉ tạo ra "160.****6.34" vô nghĩa.
  const isCredential = resource.data.includes(":");

  return (
    <div className="flex items-center gap-3 text-[12.5px] px-3 py-2 rounded-lg bg-surface border border-line">
      {!resource.data ? (
        <span className="font-mono text-faint">Chưa có IP — bấm “Lấy proxy mới”</span>
      ) : isCredential ? (
        <MaskedValue value={resource.data} />
      ) : (
        <span className="inline-flex items-center gap-2 font-mono text-[12.5px]">
          <span>{resource.data}</span>
          <CopyButton text={resource.data} />
        </span>
      )}
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

function statusCodeTone(code: number | null): "good" | "bad" | "warn" | "neutral" {
  if (code === null) return "neutral";
  if (code >= 200 && code < 300) return "good";
  if (code === 429 || code === 402) return "warn";
  return "bad";
}

/** Chi tiết 1 lần gọi thật qua gateway — có payload/response nên xổ ra khi
 *  bấm, không hiện sẵn để danh sách không bị dài vô ích. `open`/`onToggle` do
 *  cha điều khiển (accordion — chỉ 1 dòng mở cùng lúc): mở dòng mới tự thu
 *  gọn dòng cũ, tránh nhiều khối JSON dài chồng nhau khó hình dung. */
function GatewayCallRow({
  call, open, onToggle,
}: { call: GatewayCallLogItem; open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-lg bg-surface border border-line overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 text-[12px] px-3 py-1.5 text-left hover:bg-raised transition-colors"
      >
        <span className="font-mono text-faint">{fmtDate(call.created_at)}</span>
        <span className="font-medium">{call.endpoint}</span>
        <span className="text-faint">{call.latency_ms}ms</span>
        <Tag tone={statusCodeTone(call.status_code)} className="ml-auto">
          {call.status_code ?? "Lỗi kết nối"}
        </Tag>
        <span className="text-faint text-[11px]">{open ? "Thu gọn" : "Chi tiết"}</span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-2 border-t border-line pt-2">
          {call.request_payload && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-faint">Request</span>
                <CopyButton text={JSON.stringify(call.request_payload, null, 2)} />
              </div>
              <pre className="font-mono text-[11px] bg-base border border-line rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(call.request_payload, null, 2)}
              </pre>
            </div>
          )}
          {call.response_snippet && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-faint">Response</span>
                <CopyButton text={call.response_snippet} />
              </div>
              <pre className="font-mono text-[11px] bg-base border border-line rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                {call.response_snippet}
              </pre>
            </div>
          )}
          {call.error && (
            <div>
              <div className="text-[11px] text-faint mb-1">Lỗi</div>
              <p className="text-[11px] text-bad">{call.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Tách bản bàn giao gateway thành (key, URL gọi).
 *
 *  `delivered_data` của đơn gateway là 2 dòng ("Gateway key: gwk_…" +
 *  "Gọi qua: …/<endpoint>"), không phải một chuỗi key trần. Đưa nguyên khối
 *  đó vào MaskedValue cho ra "Gate****int>" — che nhầm cả nhãn lẫn URL và
 *  giấu mất đúng phần buyer cần đọc. Chỉ KEY là bí mật; URL gọi thì không,
 *  nên hiện đầy đủ. */
function parseGatewayDelivery(raw: string | null | undefined): { key: string | null; callUrl: string | null } {
  if (!raw) return { key: null, callUrl: null };
  let key: string | null = null;
  let callUrl: string | null = null;
  for (const line of raw.split("\n")) {
    const keyMatch = line.match(/^\s*Gateway key:\s*(\S+)\s*$/);
    if (keyMatch) key = keyMatch[1];
    const urlMatch = line.match(/^\s*Gọi qua:\s*(\S+)\s*$/);
    if (urlMatch) callUrl = urlMatch[1];
  }
  // Bàn giao không theo khuôn (đơn cũ, provider khác): coi cả khối là key —
  // giữ nguyên hành vi trước đây thay vì hiện trống.
  if (!key && !callUrl) return { key: raw.trim(), callUrl: null };
  return { key, callUrl };
}

function EndpointDashboard({ data, onRefresh, viewerRole }: { data: DashboardData; onRefresh: () => void; viewerRole: "buyer" | "seller" }) {
  const locale = useLocale();
  const isEnglish = locale === "en";
  const balance = data.balance;
  const { key: apiKey, callUrl } = parseGatewayDelivery(data.delivered_data);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [openCallId, setOpenCallId] = useState<number | null>(null);

  const simulate = async () => {
    setSimulating(true);
    setSimError(null);
    try {
      await api.chargeUsage(data.order_id, "profile", 1);
      onRefresh();
    } catch (e) {
      setSimError(e instanceof ApiError ? e.message : isEnglish ? "Could not simulate the request" : "Không giả lập được request");
      onRefresh(); // vẫn refresh để thấy bản ghi bị từ chối trong lịch sử
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-4">
      {(apiKey || callUrl) && (
        <div className="bg-raised border border-line rounded-lg p-3 space-y-2.5">
          {apiKey && (
            <div>
              <div className="text-[11px] text-faint mb-1">API Key</div>
              <MaskedValue value={apiKey} />
            </div>
          )}
          {callUrl && (
            <div>
              <div className="text-[11px] text-faint mb-1">{isEnglish ? "Call URL" : "Địa chỉ gọi"}</div>
              <MaskedValue
                value={callUrl}
                display={apiKey ? callUrl.replace(apiKey, maskSecret(apiKey)) : callUrl}
                copyValue={callUrl}
              />
              <pre className="mt-2 font-mono text-[11px] bg-base border border-line rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {`curl -sS "${callUrl.replace("<endpoint>", "search")}"`}
              </pre>
            </div>
          )}
        </div>
      )}

      {!balance ? (
        <Banner tone="warn" icon={<Info size={15} />} title={isEnglish ? "No request balance yet" : "Chưa có số dư request"}>
          {isEnglish ? "This order has no request balance yet — it may not be delivered, or was purchased before this feature existed." : "Đơn này chưa có số dư theo dõi request — hoặc chưa giao xong, hoặc được mua trước khi tính năng này có (không ảnh hưởng key đã nhận ở trên)."}
        </Banner>
      ) : (
        <>
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <span className="text-[12px] text-muted">{isEnglish ? "Request balance" : "Số dư request"}</span>
              <span className="font-mono text-[13px] font-semibold tabular">
                {balance.units_used.toLocaleString(isEnglish ? "en-US" : "vi-VN")} / {balance.units_total.toLocaleString(isEnglish ? "en-US" : "vi-VN")}
              </span>
            </div>
            <UsageProgressBar used={balance.units_used} total={balance.units_total} />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-faint">
                {isEnglish ? `${balance.units_remaining.toLocaleString("en-US")} requests remaining` : `Còn lại ${balance.units_remaining.toLocaleString("vi-VN")} request`}
              </span>
              {balance.expires_at && (
                <span className="text-[11px] text-faint">{isEnglish ? "Expires" : "Hết hạn"} {fmtDate(balance.expires_at, locale)}</span>
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

          {/* Chỉ chủ đơn (buyer) mới gọi được POST /orders/{id}/usage — seller xem
              cùng dashboard này nhưng bấm nút sẽ luôn nhận 403 (usage/service.py::
              charge_usage_as chỉ cho buyer_id hoặc admin). Ẩn hẳn thay vì hiện một
              nút luôn báo lỗi. */}
          {viewerRole === "buyer" && (
            <div className="flex items-center gap-2">
              <button
                onClick={simulate}
                disabled={simulating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md bg-raised border border-line hover:border-line-2 transition-colors disabled:opacity-50"
              >
                {simulating ? (isEnglish ? "Sending…" : "Đang gửi…") : (isEnglish ? "Simulate 1 request" : "Trừ thử 1 request")}
              </button>
              <span className="text-[11px] text-faint">
                {isEnglish ? "Checks balance accounting by deducting one real request without calling the provider." : "Kiểm tra cách đếm số dư — trừ 1 request thật khỏi gói, không gọi ra nhà cung cấp."}
              </span>
            </div>
          )}
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

          {balance.gateway_calls && balance.gateway_calls.length > 0 && (
            <div>
              <h4 className="text-[12.5px] font-medium text-muted mb-2">
                Chi tiết request thật gần đây
                <span className="font-normal text-faint ml-1.5">(lưu 7 ngày)</span>
              </h4>
              <div className="space-y-1.5">
                {balance.gateway_calls.map((c) => (
                  <GatewayCallRow
                    key={c.id}
                    call={c}
                    open={openCallId === c.id}
                    onToggle={() => setOpenCallId((id) => (id === c.id ? null : c.id))}
                  />
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

export default function ServiceDashboard({ orderId, viewerRole = "buyer" }: { orderId: number; viewerRole?: "buyer" | "seller" }) {
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
      {data.balance ? <EndpointDashboard data={data} onRefresh={load} viewerRole={viewerRole} />
        : (data.tasks && data.tasks.length > 0) ? <TakedownDashboard data={data} />
        : (data.resources && data.resources.length > 0) ? <ProxyDashboard data={data} />
        : data.service_type === "proxy" ? <ProxyDashboard data={data} />
        : data.service_type === "endpoint" ? <EndpointDashboard data={data} onRefresh={load} viewerRole={viewerRole} />
        : data.service_type === "takedown" ? <TakedownDashboard data={data} />
        : <DefaultDashboard data={data} />}
    </Card>
  );
}
