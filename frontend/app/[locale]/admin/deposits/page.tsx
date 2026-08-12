"use client";

/* Trang rà soát nạp tiền multi-provider. PayOS được tra từng order; hosted
 * NOWPayments được tra theo invoice ID đã lưu, nên admin không phải dò payment ID. */

import * as React from "react";
import { motion } from "motion/react";

import { api, vnd } from "@/lib/api";
import type { AdminDepositIntent, PayosWebhookEventRow } from "@/lib/types";
import { Button, Card, Spinner } from "@/components/ui";
import { StatsCard, SlidePanel, FilterPills, DepositStatusBadge } from "@/components/admin";

const STATUS_FILTERS = [
  { key: "", label: "Tất cả" },
  { key: "pending", label: "Chờ thanh toán" },
  { key: "paid", label: "Đã nhận tiền" },
  { key: "expired", label: "Hết hạn" },
  { key: "cancelled", label: "Đã huỷ" },
];

function fmtTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.toLocaleDateString("vi-VN")} ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function AdminDepositsPage() {
  const [deposits, setDeposits] = React.useState<AdminDepositIntent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState("");
  const [reconcilingId, setReconcilingId] = React.useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  // Sổ webhook trong panel trượt
  const [eventsFor, setEventsFor] = React.useState<AdminDepositIntent | null>(null);
  const [events, setEvents] = React.useState<PayosWebhookEventRow[] | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setDeposits(await api.adminDeposits(statusFilter || undefined));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không tải được danh sách lệnh nạp");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);
  React.useEffect(() => { load(); }, [load]);

  const reconcile = async (deposit: AdminDepositIntent) => {
    setReconcilingId(deposit.id);
    setMsg(null); setErr(null);
    try {
      const r = await api.adminReconcileDeposit(deposit.id);
      const provider = (deposit.provider || "payos") === "nowpayments" ? "NOWPayments" : "PayOS";
      setMsg(`Lệnh #${deposit.id}: ${provider} xác nhận trạng thái "${r.status}".`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : `Đối soát lệnh #${deposit.id} thất bại`);
    } finally {
      setReconcilingId(null);
    }
  };

  // Hosted NOW invoices lacking IPN are reconciled through payment history by invoice ID.
  const reconcileAll = async () => {
    const targets = deposits.filter((d) => d.status !== "paid");
    if (targets.length === 0) return;
    setBulkBusy(true);
    setMsg(null); setErr(null);
    let changed = 0;
    for (const d of targets) {
      try {
        const r = await api.adminReconcileDeposit(d.id);
        if (r.status !== d.status) changed++;
      } catch {
        // lệnh lỗi bỏ qua — kết quả tổng hợp báo bên dưới, chi tiết xem /admin/logs
      }
    }
    setMsg(`Đã đối soát ${targets.length} lệnh — ${changed} lệnh đổi trạng thái.`);
    setBulkBusy(false);
    await load();
  };

  const openEvents = async (d: AdminDepositIntent) => {
    setEventsFor(d);
    setEvents(null);
    try {
      if ((d.provider || "payos") === "nowpayments") {
        const rows = await api.adminNowpaymentsEvents(d.now_payment_id || undefined);
        // Normalize shape for the existing panel (amount/reference optional).
        setEvents(rows.map((r) => ({
          id: Number(r.id),
          order_code: d.id,
          payment_link_id: String(r.payment_id ?? ""),
          reference: String(r.payment_status ?? ""),
          amount: d.amount,
          signature_valid: Boolean(r.signature_valid),
          received_at: String(r.received_at ?? ""),
          raw: (r.raw as Record<string, unknown>) ?? r,
        })));
      } else {
        setEvents(await api.adminPayosEvents(d.id));
      }
    } catch {
      setEvents([]);
    }
  };

  const pendingCount = deposits.filter((d) => d.status === "pending").length;
  const paidToday = deposits.filter(
    (d) => d.status === "paid" && d.paid_at && new Date(d.paid_at).toDateString() === new Date().toDateString(),
  );
  const paidTodaySum = paidToday.reduce((s, d) => s + (d.paid_amount ?? d.amount), 0);
  const unfinished = deposits.filter((d) => d.status === "expired" || d.status === "cancelled").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">Nạp tiền (PayOS / USDT)</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Rà soát lệnh nạp multi-provider. NOWPayments tự tìm payment bằng hosted invoice đã lưu.
          </p>
        </div>
        <Button variant="secondary" onClick={reconcileAll} disabled={bulkBusy || loading}>
          {bulkBusy ? "Đang đối soát…" : "Đối soát tất cả lệnh chưa chốt"}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatsCard label="Đang chờ thanh toán" value={pendingCount} tone={pendingCount > 0 ? "warn" : "neutral"} />
        <StatsCard label="Đã nhận hôm nay" value={vnd(paidTodaySum)} tone="good" sub={`${paidToday.length} lệnh`} />
        <StatsCard label="Hết hạn / huỷ" value={unfinished} tone="neutral" sub="tự đối soát lại trong 48h" />
      </div>

      {msg && <p className="text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}
      {err && <p className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

      <FilterPills options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />

      {loading ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-0 overflow-hidden">
            {deposits.length === 0 ? (
              <p className="p-6 text-[13px] text-slate-500">Không có lệnh nạp nào khớp bộ lọc.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="px-5 py-2.5 font-medium">#</th>
                      <th className="px-5 py-2.5 font-medium">Tài khoản</th>
                      <th className="px-5 py-2.5 font-medium">Provider</th>
                      <th className="px-5 py-2.5 font-medium text-right">Số tiền</th>
                      <th className="px-5 py-2.5 font-medium">Trạng thái</th>
                      <th className="px-5 py-2.5 font-medium">Tạo lúc</th>
                      <th className="px-5 py-2.5 font-medium">Nhận tiền</th>
                      <th className="px-5 py-2.5 font-medium text-right">Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.map((d) => (
                      <tr key={d.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-5 py-3 font-mono text-slate-400">#{d.id}</td>
                        <td className="px-5 py-3 truncate max-w-[200px]">{d.account_email ?? `Tài khoản #${d.account_id}`}</td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-[11px] uppercase text-slate-600">
                            {d.provider || "payos"}
                          </span>
                          {d.now_payment_id && (
                            <div className="font-mono text-[10px] text-slate-400 truncate max-w-[120px]">
                              {d.now_payment_id}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="font-mono font-semibold tabular-nums">{vnd(d.paid_amount ?? d.amount)}</span>
                          {d.paid_amount != null && d.paid_amount !== d.amount && (
                            <div className="text-[11px] text-amber-600">dự kiến {vnd(d.amount)}</div>
                          )}
                        </td>
                        <td className="px-5 py-3"><DepositStatusBadge status={d.status} /></td>
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{fmtTime(d.created_at)}</td>
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                          {d.paid_at ? (
                            <div>
                              {fmtTime(d.paid_at)}
                              {(d.payos_reference || d.external_reference) && (
                                <div className="font-mono text-[11px] text-slate-400 truncate max-w-[160px]">
                                  ref {d.payos_reference || d.external_reference}
                                </div>
                              )}
                            </div>
                          ) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" variant="secondary" onClick={() => openEvents(d)}>
                              Sổ webhook
                            </Button>
                            {d.status !== "paid" && (
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={reconcilingId === d.id || bulkBusy}
                                onClick={() => void reconcile(d)}
                              >
                                {reconcilingId === d.id ? "…" : "Đối soát"}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </motion.div>
      )}

      <SlidePanel
        isOpen={eventsFor !== null}
        onClose={() => setEventsFor(null)}
        title={eventsFor ? `Sổ webhook — lệnh nạp #${eventsFor.id}` : ""}
        width="xl"
      >
        {events === null ? (
          <div className="grid place-items-center py-12"><Spinner /></div>
        ) : events.length === 0 ? (
          <div className="text-[13px] text-slate-500 space-y-2">
            <p>Chưa nhận webhook nào cho lệnh này.</p>
            <p>
              Nếu lệnh đã <b>paid</b> mà không có webhook: tiền được chốt qua <b>đối soát chủ động</b> (backend
              tự hỏi PayOS) — đó là hành vi đúng khi webhook bị lỡ (mất mạng, tắt tunnel…).
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((e) => (
              <div key={e.id} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 flex items-center justify-between text-[12.5px]">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold tabular-nums">{vnd(e.amount)}</span>
                    <span className="font-mono text-slate-500">ref {e.reference}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={e.signature_valid ? "text-emerald-600" : "text-red-600"}>
                      {e.signature_valid ? "✓ Chữ ký hợp lệ" : "✗ Chữ ký sai"}
                    </span>
                    <span className="text-slate-400">{fmtTime(e.received_at)}</span>
                  </div>
                </div>
                <pre className="p-4 text-[11.5px] leading-relaxed overflow-x-auto bg-white text-slate-700 max-h-[320px]">
{JSON.stringify(e.raw, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </SlidePanel>

    </div>
  );
}
