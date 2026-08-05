"use client";

import * as React from "react";
import { motion } from "motion/react";

import { api, vnd } from "@/lib/api";
import { Card, Spinner, Button } from "@/components/ui";
import { StatsCard, ConfirmModal, WithdrawStatusBadge } from "@/components/admin";
import type { WithdrawRequest } from "@/lib/types";

export default function AdminWithdrawalsPage() {
  const [requests, setRequests] = React.useState<WithdrawRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [confirmId, setConfirmId] = React.useState<number | null>(null);
  const [rejectId, setRejectId] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setLoading(true);
    api
      .adminWithdrawals()
      .then(setRequests)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async () => {
    if (confirmId === null) return;
    setBusy(true);
    try {
      await api.approveWithdrawal(confirmId);
      setConfirmId(null);
      load();
    } catch (err) {
      alert(`Duyệt thất bại: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const handleMarkPaid = async (id: number) => {
    // Mã tham chiếu = số bút toán trên app bank sau khi admin chuyển tay —
    // bắt buộc để đối soát sao kê về sau.
    const ref = window.prompt("Mã tham chiếu giao dịch chuyển khoản (bắt buộc):");
    if (!ref || !ref.trim()) return;
    setBusy(true);
    try {
      await api.markWithdrawalPaid(id, ref.trim());
      load();
    } catch (err) {
      alert(`Đánh dấu đã chi thất bại: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (rejectId === null) return;
    setBusy(true);
    try {
      await api.rejectWithdrawal(rejectId);
      setRejectId(null);
      load();
    } catch (err) {
      alert(`Từ chối thất bại: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const approvedCount = requests.filter((r) => r.status === "approved").length;
  const pendingAmount = requests
    .filter((r) => r.status === "pending")
    .reduce((s, r) => s + r.amount, 0);

  if (loading) {
    return <Spinner label="Đang tải yêu cầu rút tiền…" />;
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 sm:grid-cols-3 gap-3"
      >
        <StatsCard label="Chờ duyệt" value={pendingCount} tone="warn" />
        <StatsCard label="Đã duyệt" value={approvedCount} tone="good" />
        <StatsCard
          label="Tổng tiền chờ duyệt"
          value={vnd(pendingAmount)}
          tone="neutral"
          className="col-span-2 sm:col-span-1"
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="p-0 overflow-hidden">
          {requests.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[13px] text-slate-500">Chưa có yêu cầu rút tiền nào.</p>
            </div>
          ) : (
            <>
              {/* Mobile: stacked cards */}
              <div className="sm:hidden divide-y divide-slate-100">
                {requests.map((r) => (
                  <div key={r.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-slate-400 text-[12px]">#{r.id}</span>
                      <WithdrawStatusBadge status={r.status} />
                    </div>
                    <div className="text-[13px] font-medium truncate">
                      {r.account_email ?? `Tài khoản #${r.account_id}`}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[15px] font-semibold tabular-nums">
                        {vnd(r.amount)}
                      </span>
                      {r.status === "pending" ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setRejectId(r.id)}>
                            Từ chối
                          </Button>
                          <Button size="sm" variant="primary" onClick={() => setConfirmId(r.id)}>
                            Duyệt
                          </Button>
                        </div>
                      ) : r.status === "approved" ? (
                        <Button size="sm" variant="primary" disabled={busy} onClick={() => handleMarkPaid(r.id)}>
                          Đã chi tiền
                        </Button>
                      ) : (
                        <span className="text-slate-400 text-[12px]">Đã xử lý</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {new Date(r.created_at).toLocaleString("vi-VN")}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="px-5 py-2.5 font-medium">#</th>
                      <th className="px-5 py-2.5 font-medium">Tài khoản</th>
                      <th className="px-5 py-2.5 font-medium">Số tiền</th>
                      <th className="px-5 py-2.5 font-medium">Ngày yêu cầu</th>
                      <th className="px-5 py-2.5 font-medium">Trạng thái</th>
                      <th className="px-5 py-2.5 font-medium text-right">Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-5 py-3 font-mono text-slate-400">#{r.id}</td>
                        <td className="px-5 py-3 max-w-[260px]">
                          <div className="truncate">{r.account_email ?? `Tài khoản #${r.account_id}`}</div>
                          {r.bank_account_number && (
                            <div className="text-[11px] text-slate-400 truncate">
                              {r.bank_name} · {r.bank_account_number} · {r.bank_account_holder}
                            </div>
                          )}
                          {r.payout_reference && (
                            <div className="text-[11px] text-slate-400 font-mono truncate">Ref: {r.payout_reference}</div>
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono font-semibold tabular-nums">
                          {vnd(r.amount)}
                        </td>
                        <td className="px-5 py-3 text-slate-500">
                          {new Date(r.created_at).toLocaleDateString("vi-VN")}
                        </td>
                        <td className="px-5 py-3">
                          <WithdrawStatusBadge status={r.status} />
                        </td>
                        <td className="px-5 py-3 text-right">
                          {r.status === "pending" ? (
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" variant="secondary" onClick={() => setRejectId(r.id)}>
                                Từ chối
                              </Button>
                              <Button size="sm" variant="primary" onClick={() => setConfirmId(r.id)}>
                                Duyệt
                              </Button>
                            </div>
                          ) : r.status === "approved" ? (
                            <Button size="sm" variant="primary" disabled={busy} onClick={() => handleMarkPaid(r.id)}>
                              Đã chi tiền
                            </Button>
                          ) : (
                            <span className="text-slate-400 text-[12px]">Đã xử lý</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </motion.div>

      <ConfirmModal
        isOpen={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={handleApprove}
        title="Duyệt yêu cầu rút tiền"
        description="Số tiền sẽ được trừ khỏi ví người bán ngay lập tức. Hành động này không thể hoàn tác."
        confirmText="Duyệt"
        variant="primary"
        isLoading={busy}
      />

      <ConfirmModal
        isOpen={rejectId !== null}
        onClose={() => setRejectId(null)}
        onConfirm={handleReject}
        title="Từ chối yêu cầu rút tiền"
        description="Yêu cầu sẽ bị đánh dấu từ chối, số dư trong ví người bán không thay đổi."
        confirmText="Từ chối"
        variant="danger"
        isLoading={busy}
      />

    </div>
  );
}
