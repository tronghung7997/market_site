"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { UnmatchedTransfer } from "@/lib/types";
import { Button, Card, Input, Tag } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, formatTime } from "./deposit-transactions-dialog";

type Action = { kind: "assign" | "dismiss"; row: UnmatchedTransfer };

/**
 * Bank transfers that reached the platform account but credited nobody —
 * missing or mistyped top-up code, amount mismatch on an old per-request
 * code, an extra payment. An admin credits the right account (by email or
 * top-up code) or closes the row with a reason.
 */
export function UnmatchedTransfersCard({ onResolved }: { onResolved: () => void }) {
  const apiErrorMessage = useApiErrorMessage();
  const [rows, setRows] = React.useState<UnmatchedTransfer[] | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [action, setAction] = React.useState<Action | null>(null);
  const [target, setTarget] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoadError("");
    try {
      setRows(await api.adminUnmatchedTransfers());
    } catch (e) {
      setLoadError(apiErrorMessage(e, "Không tải được giao dịch chưa khớp"));
    }
  }, [apiErrorMessage]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const open = (kind: Action["kind"], row: UnmatchedTransfer) => {
    setAction({ kind, row });
    setTarget("");
    setNote("");
    setActionError("");
  };

  const submit = async () => {
    if (!action) return;
    setBusy(true);
    setActionError("");
    try {
      if (action.kind === "assign") {
        await api.adminAssignUnmatchedTransfer(action.row.id, target.trim(), note.trim() || undefined);
      } else {
        await api.adminDismissUnmatchedTransfer(action.row.id, note.trim());
      }
      setAction(null);
      await load();
      onResolved();
    } catch (e) {
      setActionError(apiErrorMessage(e, "Không xử lý được giao dịch"));
    } finally {
      setBusy(false);
    }
  };

  if (rows !== null && rows.length === 0 && !loadError) return null;

  const canSubmit = action?.kind === "assign" ? target.trim().length >= 3 : note.trim().length > 0;

  return (
    <Card className="overflow-hidden p-0 shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
            Giao dịch chưa khớp
            {rows && rows.length > 0 && <Tag tone="warn">{rows.length}</Tag>}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Tiền đã vào tài khoản nhận nhưng không cộng cho ai (thiếu hoặc sai mã nạp, lệch tiền, trả thừa).
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()}>Tải lại</Button>
      </div>

      {loadError ? (
        <p className="px-4 py-5 text-[13px] text-bad">{loadError}</p>
      ) : rows === null ? (
        <p className="px-4 py-5 text-[13px] text-muted">Đang tải…</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-mono text-[14px] font-semibold tabular text-fg">{formatMoney(row.amount, "VND")}</span>
                  <span className="text-[12px] text-muted">{formatTime(row.received_at)}</span>
                  {row.reference && <span className="font-mono text-[11.5px] text-faint">{row.reference}</span>}
                </div>
                <p className="mt-0.5 break-words text-[12.5px] text-fg">
                  {row.content || <span className="text-faint">(không có nội dung)</span>}
                </p>
                <p className="text-[11.5px] text-faint">
                  Mã nhận diện: <span className="font-mono">{row.payment_code ?? "—"}</span> · TK nhận {row.account_number}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => open("assign", row)}>Gán cho tài khoản</Button>
                <Button size="sm" variant="ghost" onClick={() => open("dismiss", row)}>Bỏ qua</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={action !== null} onOpenChange={(o) => { if (!o && !busy) setAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action?.kind === "assign" ? "Gán giao dịch cho tài khoản" : "Bỏ qua giao dịch"}</DialogTitle>
            <DialogDescription>
              {action && `${formatMoney(action.row.amount, "VND")} · ${action.row.content || "không có nội dung"}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {action?.kind === "assign" && (
              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-fg">Email hoặc mã nạp của khách</span>
                <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="khach@email.com hoặc NAP…" autoFocus />
                <span className="block text-[11.5px] text-muted">Ví của khách được cộng đúng {action && formatMoney(action.row.amount, "VND")}.</span>
              </label>
            )}
            <label className="block space-y-1">
              <span className="text-[12px] font-medium text-fg">
                {action?.kind === "assign" ? "Ghi chú (không bắt buộc)" : "Lý do (bắt buộc)"}
              </span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={action?.kind === "assign" ? "VD: khách quên ghi mã" : "VD: đã hoàn tiền ngoài hệ thống"} />
            </label>
            {actionError && <p className="text-[12px] text-bad">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>Huỷ</Button>
            <Button variant={action?.kind === "dismiss" ? "danger" : "primary"} disabled={busy || !canSubmit} onClick={() => void submit()}>
              {busy ? "Đang xử lý…" : action?.kind === "assign" ? "Cộng tiền" : "Bỏ qua giao dịch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
