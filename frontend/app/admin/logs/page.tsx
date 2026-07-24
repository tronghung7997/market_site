"use client";
/* Hallmark · component: admin activity log console · theme: project Proxora (slate canvas · iris accent) · P4 H5 E4 S5 R4 V4 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, RotateCw, Search, X } from "lucide-react";
import { api, vnd } from "@/lib/api";
import { Banner, Card } from "@/components/ui";
import type { LogEntry } from "@/lib/types";

const LIMIT = 200;

type Md = Record<string, unknown>;
type Cat = "order" | "dispute" | "money" | "system";

// ============================================================
// Danh mục sự kiện — dịch mọi event backend ghi ra câu tiếng Việt
// đọc được, kèm nhóm nghiệp vụ để admin lọc theo cách họ tư duy
// (đơn hàng / khiếu nại / dòng tiền) thay vì theo mã kỹ thuật.
// ============================================================

const num = (m: Md, k: string): number | undefined =>
  typeof m[k] === "number" ? (m[k] as number) : undefined;
const arrLen = (m: Md, k: string): number | undefined =>
  Array.isArray(m[k]) ? (m[k] as unknown[]).length : undefined;

const money = (m: Md, k = "amount") => {
  const v = num(m, k);
  return v != null ? vnd(v) : null;
};

interface EventMeta {
  cat: Cat;
  describe: (m: Md) => string;
}

const EVENT_META: Record<string, EventMeta> = {
  // ---- Đơn hàng ----
  order_placed: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} được đặt${money(m) ? ` — ${money(m)}` : ""}`,
  },
  resources_assigned: {
    cat: "order",
    describe: (m) => `Cấp ${arrLen(m, "resource_ids") ?? ""} tài nguyên cho đơn #${num(m, "order_id")}`,
  },
  order_processing: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} chờ người bán giao thủ công`,
  },
  order_provisioned: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — nguồn hàng cấp thành công`,
  },
  order_provision_failed: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — nguồn hàng cấp THẤT BẠI`,
  },
  order_adapter_error: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — lỗi kết nối nguồn hàng`,
  },
  order_provider_strategy_mismatch: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — cấu hình nguồn hàng không khớp chiến lược giá`,
  },
  order_provision_error: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — lỗi provision chạy nền`,
  },
  order_confirmed: {
    cat: "order",
    describe: (m) => `Người mua xác nhận đơn #${num(m, "order_id")}${money(m) ? ` — ${money(m)}` : ""}`,
  },
  order_delivered_manual: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} được giao thủ công`,
  },
  escrow_released: {
    cat: "order",
    describe: (m) => `Giải ngân ký quỹ đơn #${num(m, "order_id")}${money(m) ? ` — ${money(m)}` : ""} cho người bán`,
  },
  sla_refund: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} tự hoàn tiền — người bán trễ hạn giao (SLA)`,
  },
  provision_deadline_refund: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} tự hoàn tiền — nguồn hàng không cấp được trong 15 phút`,
  },
  resource_expired: {
    cat: "order",
    describe: (m) =>
      `Tài nguyên #${num(m, "resource_id")} hết hạn${num(m, "order_id") != null ? ` (đơn #${num(m, "order_id")})` : ""}`,
  },
  task_webhook_sla_timeout: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — ${num(m, "task_count")} tác vụ quá hạn chờ người bán phản hồi`,
  },

  // ---- Khiếu nại ----
  dispute_opened: {
    cat: "dispute",
    describe: (m) => `Đơn #${num(m, "order_id")} bị khiếu nại`,
  },
  dispute_seller_responded: {
    cat: "dispute",
    describe: (m) => `Người bán phản hồi khiếu nại (đơn #${num(m, "order_id")})`,
  },
  dispute_refunded: {
    cat: "dispute",
    describe: (m) => `Khiếu nại đơn #${num(m, "order_id")} — hoàn toàn bộ${money(m) ? ` ${money(m)}` : " tiền"} cho người mua`,
  },
  dispute_partial_refunded: {
    cat: "dispute",
    describe: (m) =>
      `Khiếu nại đơn #${num(m, "order_id")} — hoàn một phần${money(m, "refund_amount") ? ` ${money(m, "refund_amount")}` : ""}`,
  },
  dispute_rejected: {
    cat: "dispute",
    describe: (m) => `Khiếu nại đơn #${num(m, "order_id")} — từ chối, tiền về người bán`,
  },
  dispute_replaced: {
    cat: "dispute",
    describe: (m) => `Khiếu nại đơn #${num(m, "order_id")} — xử lý bằng đổi sản phẩm mới`,
  },
  dispute_warranty_extended: {
    cat: "dispute",
    describe: (m) => `Khiếu nại đơn #${num(m, "order_id")} — gia hạn bảo hành ${num(m, "extra_days")} ngày`,
  },

  // ---- Dòng tiền ----
  deposit_created: {
    cat: "money",
    describe: (m) => `Lệnh nạp #${num(m, "intent_id")} được tạo — ${money(m)} (tài khoản #${num(m, "account_id")})`,
  },
  deposit_paid: {
    cat: "money",
    describe: (m) =>
      `Lệnh nạp #${num(m, "intent_id")} ĐÃ NHẬN ${money(m, "amount") ?? "tiền"}${typeof m.source === "string" ? ` qua ${m.source}` : ""}`,
  },
  deposit_cancelled: {
    cat: "money",
    describe: (m) => `Lệnh nạp #${num(m, "intent_id")} bị người dùng huỷ`,
  },
  deposit_webhook_unknown: {
    cat: "money",
    describe: (m) => `Webhook PayOS không khớp lệnh nạp nào (orderCode ${num(m, "order_code")})`,
  },
  deposit_expired_sweep: {
    cat: "money",
    describe: (m) => `${arrLen(m, "intent_ids") ?? ""} lệnh nạp quá hạn đã chốt hết hạn`,
  },
  manual_topup: {
    cat: "money",
    describe: (m) => `Admin nạp tay ${money(m)} vào tài khoản #${num(m, "account_id")}`,
  },
  withdraw_requested: {
    cat: "money",
    describe: (m) => `Yêu cầu rút #${num(m, "withdraw_id")} — ${money(m)} (đã khoá tiền, chờ duyệt)`,
  },
  withdraw_approved: {
    cat: "money",
    describe: (m) => `Lệnh rút #${num(m, "withdraw_id")} được duyệt — chờ chi ${money(m)}`,
  },
  withdraw_rejected: {
    cat: "money",
    describe: (m) => `Lệnh rút #${num(m, "withdraw_id")} bị từ chối — hoàn ${money(m)} về ví`,
  },
  withdraw_paid: {
    cat: "money",
    describe: (m) => `Lệnh rút #${num(m, "withdraw_id")} đã chi ${money(m)}`,
  },

  // ---- Hệ thống ----
  provider_down: {
    cat: "system",
    describe: (m) => `Nguồn hàng #${num(m, "provider_id")} bị TẮT — lỗi 3 lần kiểm tra liên tiếp`,
  },
};

const CAT_TABS: { key: string; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "order", label: "Đơn hàng" },
  { key: "dispute", label: "Khiếu nại" },
  { key: "money", label: "Dòng tiền" },
  { key: "system", label: "Hệ thống" },
];

// Một hệ màu duy nhất trên trang: mức độ nghiêm trọng (chấm dòng +
// thanh phân bố dùng chung).
const LEVEL_META: Record<string, { label: string; color: string }> = {
  info: { label: "Thông tin", color: "bg-slate-300" },
  warning: { label: "Cảnh báo", color: "bg-amber-400" },
  error: { label: "Lỗi", color: "bg-red-400" },
  critical: { label: "Nghiêm trọng", color: "bg-red-600" },
};
const LEVEL_ORDER = ["info", "warning", "error", "critical"];

// Nhãn tiếng Việt cho các khóa metadata trong phần chi tiết
const META_KEY_LABELS: Record<string, string> = {
  order_id: "Mã đơn",
  buyer_id: "Người mua",
  seller_id: "Người bán",
  account_id: "Tài khoản",
  amount: "Số tiền",
  refund_amount: "Tiền hoàn",
  intent_id: "Lệnh nạp",
  intent_ids: "Các lệnh nạp",
  withdraw_id: "Lệnh rút",
  resource_id: "Tài nguyên",
  resource_ids: "Tài nguyên",
  provider_id: "Nguồn hàng",
  order_code: "PayOS orderCode",
  reference: "Mã tham chiếu",
  payout_reference: "Mã chi tiền",
  source: "Nguồn ghi nhận",
  task_count: "Số tác vụ",
  extra_days: "Ngày bảo hành cộng thêm",
  error: "Chi tiết lỗi",
};
const MONEY_KEYS = new Set(["amount", "refund_amount"]);

interface LogRow {
  log: LogEntry;
  event: string;
  cat: Cat;
  title: string;
  error: string | null;
  orderId: number | null;
  dateKey: string;
}

function toRow(l: LogEntry): LogRow {
  const md = (l.metadata ?? {}) as Md;
  const event = typeof md.event === "string" ? md.event : "";
  const meta = EVENT_META[event];
  return {
    log: l,
    event,
    cat: meta?.cat ?? "system",
    // Sự kiện chưa có trong danh mục thì rơi về message gốc của backend
    title: meta ? meta.describe(md) : l.message,
    error: typeof md.error === "string" ? md.error : null,
    orderId: num(md, "order_id") ?? null,
    dateKey: new Date(l.created_at).toDateString(),
  };
}

function dayLabel(dateKey: string): string {
  const d = new Date(dateKey);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const dateStr = d.toLocaleDateString("vi-VN");
  if (dateKey === today.toDateString()) return `Hôm nay · ${dateStr}`;
  if (dateKey === yesterday.toDateString()) return `Hôm qua · ${dateStr}`;
  return dateStr;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debouncedValue;
}

export default function AdminLogsPage() {
  const [cat, setCat] = React.useState("all");
  const [level, setLevel] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  // Truy vết chuỗi: lọc phía server theo request (thao tác người dùng)
  // hoặc job (tác vụ nền) — bấm nhãn nguồn trên một dòng để kích hoạt.
  const [trace, setTrace] = React.useState<{ request_id?: string; job_id?: string } | null>(null);
  const [expandedId, setExpandedId] = React.useState<number | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  // "#12" hoặc "12" → truy vết đơn phía server; chữ thường → lọc nội dung tại chỗ
  const orderIdSearch = React.useMemo(() => {
    const m = debouncedSearch.trim().match(/^#?(\d+)$/);
    return m ? Number(m[1]) : undefined;
  }, [debouncedSearch]);

  const apiParams = React.useMemo(
    () => ({
      order_id: trace ? undefined : orderIdSearch,
      request_id: trace?.request_id,
      job_id: trace?.job_id,
      limit: LIMIT,
    }),
    [trace, orderIdSearch]
  );

  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "logs", apiParams] as const,
    queryFn: () => api.adminLogs(apiParams),
    staleTime: 15_000,
  });

  const allRows = React.useMemo(() => (data ?? []).map(toRow), [data]);

  // Lọc nội dung tại chỗ (khi search không phải mã đơn)
  const scope = React.useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q || orderIdSearch !== undefined) return allRows;
    return allRows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.log.message.toLowerCase().includes(q) ||
        (r.error?.toLowerCase().includes(q) ?? false)
    );
  }, [allRows, debouncedSearch, orderIdSearch]);

  const catCounts = React.useMemo(() => {
    const counts: Record<string, number> = { all: scope.length };
    for (const t of CAT_TABS) {
      if (t.key === "all") continue;
      counts[t.key] = scope.filter((r) => r.cat === t.key).length;
    }
    return counts;
  }, [scope]);

  const levelCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const lv of LEVEL_ORDER) counts[lv] = 0;
    for (const r of scope) counts[r.log.level] = (counts[r.log.level] ?? 0) + 1;
    return counts;
  }, [scope]);

  const attentionCount =
    scope.length - (levelCounts.info ?? 0);

  const rows = React.useMemo(
    () =>
      scope.filter(
        (r) =>
          (cat === "all" || r.cat === cat) &&
          (level === null || r.log.level === level)
      ),
    [scope, cat, level]
  );

  // Nhóm theo ngày, giữ thứ tự mới → cũ từ server
  const groups = React.useMemo(() => {
    const out: { dateKey: string; rows: LogRow[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.dateKey === r.dateKey) last.rows.push(r);
      else out.push({ dateKey: r.dateKey, rows: [r] });
    }
    return out;
  }, [rows]);

  const hasFilters =
    cat !== "all" || level !== null || search.trim() !== "" || trace !== null;

  const clearFilters = () => {
    setCat("all");
    setLevel(null);
    setSearch("");
    setTrace(null);
    setExpandedId(null);
  };

  const startTrace = (t: { request_id?: string; job_id?: string }) => {
    setTrace(t);
    setSearch("");
    setCat("all");
    setLevel(null);
  };

  return (
    <div className="animate-rise">
      <Card className="p-0">
        {/* Dải chỉ số + thanh phân bố mức độ (trong cửa sổ đang xem) */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-4 pt-4 pb-3">
          <div className="flex items-baseline gap-8">
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
                Sự kiện
              </p>
              <p className="text-[26px] leading-8 font-semibold font-mono tabular-nums text-slate-900">
                {scope.length.toLocaleString("vi-VN")}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {LIMIT} sự kiện gần nhất · cập nhật{" "}
                {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("vi-VN") : "—"}
              </p>
            </div>
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
                Cần chú ý
              </p>
              <p
                className={`text-[26px] leading-8 font-semibold font-mono tabular-nums ${
                  attentionCount > 0 ? "text-red-600" : "text-slate-900"
                }`}
              >
                {attentionCount.toLocaleString("vi-VN")}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">cảnh báo trở lên</p>
            </div>
          </div>

          {scope.length > 0 && (
            <div className="w-full min-w-[240px] flex-1 sm:w-auto sm:max-w-sm">
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                {LEVEL_ORDER.filter((lv) => (levelCounts[lv] ?? 0) > 0).map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setLevel(level === lv ? null : lv)}
                    title={`${LEVEL_META[lv].label}: ${(levelCounts[lv] ?? 0).toLocaleString("vi-VN")} sự kiện`}
                    aria-label={`${LEVEL_META[lv].label}: ${(levelCounts[lv] ?? 0).toLocaleString("vi-VN")} sự kiện`}
                    aria-pressed={level === lv}
                    className={`${LEVEL_META[lv].color} min-w-[5px] transition-opacity hover:opacity-75 ${
                      level !== null && level !== lv ? "opacity-30" : ""
                    }`}
                    style={{ flexGrow: levelCounts[lv], flexBasis: 0 }}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-right text-[11px] text-slate-400">
                Phân bố mức độ — bấm một đoạn để lọc
              </p>
            </div>
          )}
        </div>

        {/* Bộ lọc: tìm kiếm (chữ = nội dung, #số = truy vết đơn) + mức độ đang chọn */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm nội dung, hoặc gõ #mã-đơn để truy vết…"
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

          {level !== null && (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50/60 px-3 text-[12.5px] font-medium text-indigo-800">
              <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_META[level].color}`} />
              {LEVEL_META[level].label}
              <button
                onClick={() => setLevel(null)}
                aria-label="Bỏ lọc mức độ"
                className="ml-0.5 text-indigo-400 hover:text-indigo-700"
              >
                <X size={12} />
              </button>
            </span>
          )}

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[12.5px] font-medium text-slate-600 transition-colors hover:border-slate-400 disabled:opacity-50"
          >
            <RotateCw size={13} className={isFetching ? "animate-spin" : ""} />
            Làm mới
          </button>

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

        {/* Banner truy vết chuỗi */}
        {(trace !== null || orderIdSearch !== undefined) && (
          <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[12.5px] text-indigo-800">
            {trace?.request_id && (
              <>
                Đang truy vết thao tác{" "}
                <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px]">
                  {trace.request_id.slice(0, 8)}…
                </code>
              </>
            )}
            {trace?.job_id && (
              <>
                Đang truy vết job nền{" "}
                <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px]">
                  {trace.job_id.slice(0, 8)}…
                </code>
              </>
            )}
            {trace === null && orderIdSearch !== undefined && (
              <>Đang truy vết đơn <span className="font-mono font-semibold">#{orderIdSearch}</span></>
            )}
            <span className="text-indigo-500">— {rows.length.toLocaleString("vi-VN")} sự kiện liên quan</span>
            <button
              onClick={() => { setTrace(null); setSearch(""); }}
              className="ml-auto inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800"
            >
              <X size={12} /> Bỏ truy vết
            </button>
          </div>
        )}

        {/* Tab nhóm nghiệp vụ với số đếm */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-slate-200 px-2">
          {CAT_TABS.map((t) => {
            const active = cat === t.key;
            const count = catCounts[t.key] ?? 0;
            return (
              <button
                key={t.key}
                onClick={() => setCat(t.key)}
                aria-pressed={active}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? "border-indigo-600 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
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

        {/* Nhật ký — nhóm theo ngày */}
        <div className="relative">
          {isFetching && !isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
            </div>
          )}

          {isError && (
            <div className="px-4 py-3">
              <Banner tone="bad">Không tải được nhật ký. Thử tải lại trang.</Banner>
            </div>
          )}

          {isLoading ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-4 w-14 animate-pulse rounded bg-slate-100" />
                  <div className="h-2 w-2 animate-pulse rounded-full bg-slate-100" />
                  <div
                    className="h-4 animate-pulse rounded bg-slate-100"
                    style={{ width: `${[62, 45, 70, 38, 55, 48, 66, 42][i]}%` }}
                  />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <p className="text-[13px] text-slate-500">
                {allRows.length === 0
                  ? "Chưa có sự kiện nào được ghi nhận."
                  : "Không có sự kiện khớp bộ lọc hiện tại."}
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
            <div>
              {groups.map((g) => (
                <div key={g.dateKey}>
                  <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {dayLabel(g.dateKey)}
                  </div>
                  {g.rows.map((r) => {
                    const expanded = expandedId === r.log.id;
                    const md = (r.log.metadata ?? {}) as Md;
                    const lvl = LEVEL_META[r.log.level] ?? LEVEL_META.info;
                    return (
                      <div key={r.log.id} className="border-b border-slate-100 last:border-0">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : r.log.id)}
                          aria-expanded={expanded}
                          className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
                        >
                          <span className="mt-0.5 w-14 shrink-0 font-mono text-[11.5px] tabular-nums text-slate-400">
                            {new Date(r.log.created_at).toLocaleTimeString("vi-VN")}
                          </span>
                          <span
                            className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${lvl.color}`}
                            title={lvl.label}
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block text-[13px] ${
                                r.log.level === "info" ? "text-slate-700" : "font-medium text-slate-900"
                              }`}
                            >
                              {r.title}
                            </span>
                            {r.error && (
                              <span className="mt-0.5 block truncate text-[12px] text-red-600" title={r.error}>
                                {r.error}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 hidden shrink-0 items-center gap-2 sm:flex">
                            <span className="text-[11px] text-slate-400">
                              {r.log.request_id ? "Thao tác người dùng" : r.log.job_id ? "Job nền" : ""}
                            </span>
                            <ChevronDown
                              size={13}
                              className={`text-slate-300 transition-transform ${expanded ? "rotate-180" : ""}`}
                            />
                          </span>
                        </button>

                        {expanded && (
                          <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 pl-[76px]">
                            <p className="mb-2 font-mono text-[11.5px] text-slate-500">{r.log.message}</p>
                            <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-[12px] sm:grid-cols-2">
                              {Object.entries(md)
                                .filter(([k]) => k !== "event")
                                .map(([k, v]) => (
                                  <div key={k} className="flex items-baseline gap-2">
                                    <dt className="shrink-0 text-slate-400">{META_KEY_LABELS[k] ?? k}</dt>
                                    <dd className="min-w-0 truncate font-medium text-slate-700">
                                      {MONEY_KEYS.has(k) && typeof v === "number"
                                        ? vnd(v)
                                        : Array.isArray(v)
                                          ? v.join(", ")
                                          : String(v)}
                                    </dd>
                                  </div>
                                ))}
                              {(r.log.request_id ?? r.log.job_id) && (
                                <div className="flex items-baseline gap-2">
                                  <dt className="shrink-0 text-slate-400">
                                    {r.log.request_id ? "Request" : "Job"}
                                  </dt>
                                  <dd className="min-w-0 truncate font-mono text-[11px] text-slate-500">
                                    {r.log.request_id ?? r.log.job_id}
                                  </dd>
                                </div>
                              )}
                            </dl>
                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                              {r.orderId != null && (
                                <Link
                                  href={`/admin/orders?highlight=${r.orderId}`}
                                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-indigo-600 transition-colors hover:border-indigo-300"
                                >
                                  Xem đơn #{r.orderId}
                                </Link>
                              )}
                              {r.log.request_id && (
                                <button
                                  onClick={() => startTrace({ request_id: r.log.request_id! })}
                                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                                >
                                  Truy vết thao tác này
                                </button>
                              )}
                              {r.log.job_id && (
                                <button
                                  onClick={() => startTrace({ job_id: r.log.job_id! })}
                                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                                >
                                  Truy vết job này
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chân trang */}
        {!isLoading && rows.length > 0 && (
          <div className="border-t border-slate-200 px-4 py-3">
            <span className="text-[12px] text-slate-500 tabular-nums">
              Hiển thị {rows.length.toLocaleString("vi-VN")} / {allRows.length.toLocaleString("vi-VN")} sự kiện trong cửa sổ {LIMIT} bản ghi gần nhất
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
