"use client";

/* Trang rà soát nạp tiền multi-provider. SePay được đối soát theo payment code;
 * NOWPayments được tra theo invoice ID đã lưu. */

import * as React from "react";
import { motion } from "motion/react";

import { api, vnd } from "@/lib/api";
import type {
  AdminDepositIntent,
  AdminDepositLedgerQuery,
  AdminDepositLedgerResponse,
  AdminDepositTransaction,
} from "@/lib/types";
import { Button, Card, Spinner } from "@/components/ui";
import { StatsCard, FilterPills, DepositStatusBadge } from "@/components/admin";
import { DepositTransactionsDialog } from "./deposit-transactions-dialog";
import { DepositLedgerDialog } from "./deposit-ledger-dialog";

const STATUS_FILTERS = [
  { key: "", label: "Tất cả" },
  { key: "pending", label: "Chờ thanh toán" },
  { key: "paid", label: "Đã nhận tiền" },
  { key: "expired", label: "Hết hạn" },
  { key: "cancelled", label: "Đã huỷ" },
];

function fmtTime(s: string | null | undefined): string {
  if (!s) return "-";
  const d = new Date(s);
  return `${d.toLocaleDateString("vi-VN")} ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

function reconcileMessage(
  deposit: AdminDepositIntent,
  result: Awaited<ReturnType<typeof api.adminReconcileDeposit>>,
): string {
  const provider = (deposit.provider || "sepay") === "nowpayments" ? "NOWPayments" : "SePay";
  const prefix = `Lệnh #${deposit.id}`;
  if (result.reconcile_result === "not_configured") {
    return `${prefix}: chưa gọi được ${provider} vì thiếu cấu hình đối soát; trạng thái nội bộ vẫn là "${result.status}".`;
  }
  if (result.reconcile_result === "provider_error") {
    return `${prefix}: gọi ${provider} thất bại; trạng thái nội bộ vẫn là "${result.status}".`;
  }
  if (result.reconcile_result === "not_found") {
    return `${prefix}: ${provider} chưa trả về payment tương ứng; trạng thái nội bộ là "${result.status}".`;
  }
  if (result.provider_status) {
    const validation = result.reconcile_result === "validation_failed"
      ? " Payload finished chưa qua kiểm tra an toàn nên chưa credit."
      : "";
    return `${prefix}: ${provider} trả trạng thái "${result.provider_status}"; trạng thái nội bộ là "${result.status}".${validation}`;
  }
  return `${prefix}: trạng thái nội bộ là "${result.status}".`;
}

export default function AdminDepositsPage() {
  const [deposits, setDeposits] = React.useState<AdminDepositIntent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState("");
  const [reconcilingId, setReconcilingId] = React.useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [transactionsFor, setTransactionsFor] = React.useState<AdminDepositIntent | null>(null);
  const [transactions, setTransactions] = React.useState<AdminDepositTransaction[] | null>(null);
  const [transactionsError, setTransactionsError] = React.useState<string | null>(null);
  const [ledgerOpen, setLedgerOpen] = React.useState(false);
  const [ledger, setLedger] = React.useState<AdminDepositLedgerResponse | null>(null);
  const [ledgerError, setLedgerError] = React.useState<string | null>(null);
  const ledgerRequestRef = React.useRef(0);

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
      setMsg(reconcileMessage(deposit, r));
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
    let needsAttention = 0;
    for (const d of targets) {
      try {
        const r = await api.adminReconcileDeposit(d.id);
        if (r.status !== d.status) changed++;
        if (["not_configured", "provider_error", "validation_failed"].includes(r.reconcile_result)) {
          needsAttention++;
        }
      } catch {
        needsAttention++;
      }
    }
    const attention = needsAttention > 0 ? `; ${needsAttention} lệnh cần kiểm tra` : "";
    setMsg(`Đã đối soát ${targets.length} lệnh: ${changed} lệnh đổi trạng thái${attention}.`);
    setBulkBusy(false);
    await load();
  };

  const loadTransactions = async (d: AdminDepositIntent) => {
    setTransactions(null);
    setTransactionsError(null);
    try {
      setTransactions(await api.adminDepositTransactions(d.id));
    } catch (error) {
      setTransactionsError(error instanceof Error ? error.message : "Không tải được giao dịch từ provider");
    }
  };

  const openTransactions = (d: AdminDepositIntent) => {
    setTransactionsFor(d);
    void loadTransactions(d);
  };

  const loadLedger = React.useCallback(async (query: AdminDepositLedgerQuery = {}) => {
    const requestId = ++ledgerRequestRef.current;
    setLedger(null);
    setLedgerError(null);
    try {
      const result = await api.adminDepositLedger(query);
      if (requestId === ledgerRequestRef.current) setLedger(result);
    } catch (error) {
      if (requestId === ledgerRequestRef.current) {
        setLedgerError(error instanceof Error ? error.message : "Không tải được sổ giao dịch nạp tiền");
      }
    }
  }, []);

  const openLedger = () => {
    setLedgerOpen(true);
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
          <h1 className="text-[18px] font-semibold text-slate-900">Nạp tiền (SePay / USDT)</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Rà soát lệnh nạp multi-provider. NOWPayments tự tìm payment bằng hosted invoice đã lưu.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={openLedger}>
            Tất cả giao dịch
          </Button>
          <Button variant="secondary" onClick={reconcileAll} disabled={bulkBusy || loading}>
            {bulkBusy ? "Đang đối soát…" : "Đối soát tất cả lệnh chưa chốt"}
          </Button>
        </div>
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
                            {d.provider || "sepay"}
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
                              {(d.sepay_reference || d.external_reference || d.payos_reference) && (
                                <div className="font-mono text-[11px] text-slate-400 truncate max-w-[160px]">
                                  ref {d.sepay_reference || d.external_reference || d.payos_reference}
                                </div>
                              )}
                            </div>
                          ) : "-"}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" variant="secondary" onClick={() => openTransactions(d)}>
                              Xem giao dịch
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

      <DepositTransactionsDialog
        deposit={transactionsFor}
        transactions={transactions}
        error={transactionsError}
        onOpenChange={(open) => {
          if (!open) {
            setTransactionsFor(null);
            setTransactions(null);
            setTransactionsError(null);
          }
        }}
        onRetry={() => {
          if (transactionsFor) void loadTransactions(transactionsFor);
        }}
      />

      <DepositLedgerDialog
        open={ledgerOpen}
        ledger={ledger}
        error={ledgerError}
        onOpenChange={(open) => {
          setLedgerOpen(open);
          if (!open) {
            ledgerRequestRef.current += 1;
            setLedger(null);
            setLedgerError(null);
          }
        }}
        onLoad={loadLedger}
      />

    </div>
  );
}
