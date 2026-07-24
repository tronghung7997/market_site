"use client";
/* Hallmark · component: admin alerts inbox console · theme: project Proxora (slate canvas · iris accent) · P4 H5 E4 S5 R4 V4 */

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RotateCw, Search, X } from "lucide-react";

import { api } from "@/lib/api";
import { Banner, Card } from "@/components/ui";
import { ConfirmModal, FacetSelect, buildFacetOptions } from "@/components/admin";
import type { Alert } from "@/lib/types";

// Nhãn tiếng Việt cho TOÀN BỘ loại cảnh báo backend tạo ra
// (scheduler.py, disputes, payments, resources — 13 loại).
const TYPE_LABELS: Record<string, string> = {
  provider_down: "Nguồn hàng ngừng hoạt động",
  sla_breach: "Người bán trễ hạn giao (SLA)",
  provision_stuck: "Đơn không provision được",
  resource_low: "Tồn kho sắp hết",
  resource_error: "Tài nguyên bị báo lỗi",
  dispute_opened: "Khiếu nại mới",
  task_webhook_timeout: "Người bán không phản hồi webhook",
  dproxy_auth_error: "DProxy — lỗi xác thực",
  dproxy_unavailable: "DProxy — không phản hồi",
  dproxy_contract_error: "DProxy — API thay đổi bất thường",
  dproxy_duplicate_external_id: "DProxy — tồn kho trùng lặp",
  dproxy_allocation_disappeared: "DProxy — proxy biến mất khỏi nhà cung cấp",
  deposit_anomaly: "Nạp tiền bất thường",
};

// Đối tượng liên quan → nhãn + trang admin để xử lý
const TARGET_META: Record<string, { label: string; href: (id: number) => string }> = {
  order: { label: "đơn", href: (id) => `/admin/orders?highlight=${id}` },
  provider: { label: "nguồn hàng", href: () => "/admin/providers" },
  seller: { label: "người bán", href: () => "/admin/accounts" },
  account: { label: "tài khoản", href: () => "/admin/accounts" },
  resource: { label: "tài nguyên", href: () => "/admin/resources" },
  deposit: { label: "lệnh nạp", href: () => "/admin/deposits" },
};

// Một hệ màu duy nhất: mức độ nghiêm trọng (đồng bộ với trang Nhật ký)
const SEVERITY_META: Record<string, { label: string; color: string; rank: number }> = {
  critical: { label: "Nghiêm trọng", color: "bg-red-600", rank: 0 },
  warning: { label: "Cảnh báo", color: "bg-amber-400", rank: 1 },
  info: { label: "Thông tin", color: "bg-slate-300", rank: 2 },
};
const SEVERITY_ORDER = ["critical", "warning", "info"];

const SEVERITY_TABS = [
  { key: "all", label: "Tất cả" },
  ...SEVERITY_ORDER.map((s) => ({ key: s, label: SEVERITY_META[s].label })),
];

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debouncedValue;
}

export default function AdminAlertsPage() {
  const queryClient = useQueryClient();

  const [severity, setSeverity] = React.useState("all");
  const [typeKey, setTypeKey] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [dismissing, setDismissing] = React.useState<Set<number>>(new Set());
  const [bulkModal, setBulkModal] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const debouncedSearch = useDebounce(search, 300);

  // API chỉ trả cảnh báo đang hoạt động — trang này là "hộp trực ban":
  // xử lý xong thì dòng biến mất. Tự làm mới mỗi phút.
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "alerts"] as const,
    queryFn: () => api.adminAlerts(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const alerts = React.useMemo(() => data ?? [], [data]);

  // Tầng lọc: search → loại → mức độ
  const searchScope = React.useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return alerts;
    return alerts.filter(
      (a) =>
        a.message.toLowerCase().includes(q) ||
        (TYPE_LABELS[a.type] ?? a.type).toLowerCase().includes(q)
    );
  }, [alerts, debouncedSearch]);

  const typeOptions = React.useMemo(
    () =>
      buildFacetOptions(
        searchScope,
        alerts,
        typeKey,
        (a) => a.type,
        (a) => TYPE_LABELS[a.type] ?? a.type
      ),
    [searchScope, alerts, typeKey]
  );

  const scope = React.useMemo(
    () => (typeKey === null ? searchScope : searchScope.filter((a) => a.type === typeKey)),
    [searchScope, typeKey]
  );

  const sevCounts = React.useMemo(() => {
    const counts: Record<string, number> = { all: scope.length };
    for (const s of SEVERITY_ORDER) {
      counts[s] = scope.filter((a) => a.severity === s).length;
    }
    return counts;
  }, [scope]);

  // Nghiêm trọng nổi lên đầu, mới nhất trước trong cùng mức
  const rows = React.useMemo(() => {
    const filtered = severity === "all" ? scope : scope.filter((a) => a.severity === severity);
    return [...filtered].sort((a, b) => {
      const ra = SEVERITY_META[a.severity]?.rank ?? 9;
      const rb = SEVERITY_META[b.severity]?.rank ?? 9;
      if (ra !== rb) return ra - rb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [scope, severity]);

  const hasFilters = severity !== "all" || typeKey !== null || search.trim() !== "";

  const clearFilters = () => {
    setSeverity("all");
    setTypeKey(null);
    setSearch("");
  };

  const dismissOne = async (id: number) => {
    setDismissing((prev) => new Set(prev).add(id));
    try {
      await api.dismissAlert(id);
      queryClient.setQueryData<Alert[]>(["admin", "alerts"], (old) =>
        (old ?? []).filter((a) => a.id !== id)
      );
    } catch {
      // giữ nguyên dòng nếu API lỗi — admin bấm lại được
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const dismissAllVisible = async () => {
    setBulkBusy(true);
    try {
      await Promise.allSettled(rows.map((a) => api.dismissAlert(a.id)));
      await refetch();
    } finally {
      setBulkBusy(false);
      setBulkModal(false);
    }
  };

  return (
    <div className="animate-rise">
      <Card className="p-0">
        {/* Dải chỉ số + thanh phân bố mức độ (theo phạm vi đang lọc) */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-4 pt-4 pb-3">
          <div className="flex items-baseline gap-8">
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
                Đang hoạt động
              </p>
              <p className="text-[26px] leading-8 font-semibold font-mono tabular-nums text-slate-900">
                {scope.length.toLocaleString("vi-VN")}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                tự làm mới mỗi phút · cập nhật{" "}
                {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("vi-VN") : "—"}
              </p>
            </div>
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
                Nghiêm trọng
              </p>
              <p
                className={`text-[26px] leading-8 font-semibold font-mono tabular-nums ${
                  (sevCounts.critical ?? 0) > 0 ? "text-red-600" : "text-slate-900"
                }`}
              >
                {(sevCounts.critical ?? 0).toLocaleString("vi-VN")}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">cần xử lý trước</p>
            </div>
          </div>

          {scope.length > 0 && (
            <div className="w-full min-w-[240px] flex-1 sm:w-auto sm:max-w-sm">
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                {SEVERITY_ORDER.filter((s) => (sevCounts[s] ?? 0) > 0).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeverity(severity === s ? "all" : s)}
                    title={`${SEVERITY_META[s].label}: ${(sevCounts[s] ?? 0).toLocaleString("vi-VN")} cảnh báo`}
                    aria-label={`${SEVERITY_META[s].label}: ${(sevCounts[s] ?? 0).toLocaleString("vi-VN")} cảnh báo`}
                    aria-pressed={severity === s}
                    className={`${SEVERITY_META[s].color} min-w-[5px] transition-opacity hover:opacity-75 ${
                      severity !== "all" && severity !== s ? "opacity-30" : ""
                    }`}
                    style={{ flexGrow: sevCounts[s], flexBasis: 0 }}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-right text-[11px] text-slate-400">
                Phân bố mức độ — bấm một đoạn để lọc
              </p>
            </div>
          )}
        </div>

        {/* Bộ lọc: loại cảnh báo · tìm kiếm · xử lý hàng loạt */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <FacetSelect
            label="Loại cảnh báo"
            options={typeOptions}
            value={typeKey}
            onChange={setTypeKey}
          />
          <div className="relative min-w-[180px] max-w-xs flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm nội dung cảnh báo…"
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
          {rows.length > 1 && (
            <button
              onClick={() => setBulkModal(true)}
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[12.5px] font-medium text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900"
            >
              <Check size={13} />
              Xử lý tất cả ({rows.length.toLocaleString("vi-VN")})
            </button>
          )}
        </div>

        {/* Tab mức độ với số đếm */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-slate-200 px-2">
          {SEVERITY_TABS.map((t) => {
            const active = severity === t.key;
            const count = sevCounts[t.key] ?? 0;
            const meta = SEVERITY_META[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setSeverity(t.key)}
                aria-pressed={active}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? "border-indigo-600 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {meta && <span className={`h-1.5 w-1.5 rounded-full ${meta.color}`} />}
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

        {/* Hộp cảnh báo */}
        <div className="relative">
          {isFetching && !isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
            </div>
          )}

          {isError && (
            <div className="px-4 py-3">
              <Banner tone="bad">Không tải được danh sách cảnh báo. Thử tải lại trang.</Banner>
            </div>
          )}

          {isLoading ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-slate-100" />
                  <div
                    className="h-4 animate-pulse rounded bg-slate-100"
                    style={{ width: `${[62, 45, 70, 38, 55, 48][i]}%` }}
                  />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-14 text-center">
              {alerts.length === 0 ? (
                <>
                  <p className="text-[15px] font-medium text-slate-700">Không có cảnh báo nào 🎉</p>
                  <p className="mt-1 text-[13px] text-slate-500">
                    Hệ thống đang yên ổn — cảnh báo mới sẽ tự xuất hiện tại đây.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-slate-500">Không có cảnh báo khớp bộ lọc hiện tại.</p>
                  <button
                    onClick={clearFilters}
                    className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                  >
                    <X size={13} />
                    Xóa bộ lọc
                  </button>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((a) => {
                const sev = SEVERITY_META[a.severity] ?? SEVERITY_META.info;
                const target = TARGET_META[a.target_type];
                const busy = dismissing.has(a.id);
                return (
                  <li key={a.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50">
                    <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${sev.color}`} title={sev.label} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[13px] font-medium text-slate-900">
                          {TYPE_LABELS[a.type] ?? a.type}
                        </span>
                        <span className="text-[11.5px] text-slate-400">
                          {new Date(a.created_at).toLocaleString("vi-VN", {
                            day: "2-digit", month: "2-digit",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[13px] text-slate-600">{a.message}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {target && (
                        <Link
                          href={target.href(a.target_id)}
                          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-indigo-600 transition-colors hover:border-indigo-300"
                        >
                          Xem {target.label}
                          {a.target_type === "order" ? ` #${a.target_id}` : ""}
                        </Link>
                      )}
                      <button
                        onClick={() => dismissOne(a.id)}
                        disabled={busy}
                        title="Đánh dấu đã xử lý — cảnh báo sẽ rời khỏi danh sách"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
                      >
                        {busy ? (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" />
                        ) : (
                          <Check size={13} />
                        )}
                        Đã xử lý
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Chân trang */}
        {!isLoading && rows.length > 0 && (
          <div className="border-t border-slate-200 px-4 py-3">
            <span className="text-[12px] text-slate-500 tabular-nums">
              {rows.length.toLocaleString("vi-VN")} cảnh báo — nghiêm trọng xếp trước, mới nhất trong cùng mức
            </span>
          </div>
        )}
      </Card>

      {/* Xác nhận xử lý hàng loạt — hành động ảnh hưởng nhiều dòng nên mới cần hỏi */}
      <ConfirmModal
        isOpen={bulkModal}
        onClose={() => !bulkBusy && setBulkModal(false)}
        onConfirm={dismissAllVisible}
        title="Xử lý tất cả cảnh báo đang hiển thị"
        description={`Đánh dấu đã xử lý ${rows.length.toLocaleString("vi-VN")} cảnh báo khớp bộ lọc hiện tại. Chúng sẽ rời khỏi danh sách trực ban.`}
        confirmText={bulkBusy ? "Đang xử lý…" : "Xử lý tất cả"}
        variant="danger"
      />
    </div>
  );
}
