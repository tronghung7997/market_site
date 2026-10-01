"use client";

import * as React from "react";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import { Button, Input, Spinner, buttonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Download } from "@/components/Icons";
import { useToast } from "@/components/toast";
import { useCloseChecklist, useClosePeriod } from "../data";
import { periodLabel, type Period } from "../model";

type Check = { ok: boolean; blocking?: boolean; label: React.ReactNode; detail?: React.ReactNode; action?: React.ReactNode };

/** Kiểm tra trước khi chốt → ghi chú → tải gói / chốt và khoá số liệu. */
export function CloseDialog({ open, onClose, period, range }: {
  open: boolean; onClose: () => void; period: Period; range: { start: string; end: string };
}) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const checklistQ = useCloseChecklist(range, open);
  const close = useClosePeriod();
  const [note, setNote] = React.useState("");
  React.useEffect(() => { if (open) setNote(""); }, [open]);
  const c = checklistQ.data;

  const checks: Check[] = c ? [
    {
      ok: c.period_ended, blocking: true,
      label: c.period_ended ? "Kỳ đã kết thúc" : "Kỳ chưa kết thúc — chưa chốt được",
    },
    {
      ok: !c.overlaps, blocking: true,
      label: c.overlaps ? <>Trùng với kỳ đã chốt <b>{c.overlaps.label}</b></> : "Không trùng kỳ nào đã chốt",
    },
    {
      ok: Boolean(c.reconcile?.ok && c.reconcile.after_period),
      label: !c.reconcile ? "Chưa có lần đối soát sổ nào"
        : !c.reconcile.ok ? <>Đối soát gần nhất có <b>{c.reconcile.mismatch_count} chỗ lệch</b></>
        : !c.reconcile.after_period ? "Đối soát gần nhất chạy trước khi kỳ kết thúc" : "Đối soát sổ sau kỳ: không lệch",
      detail: c.reconcile ? `Lần chạy ${formatDateTime(c.reconcile.ran_at, "vi")}` : undefined,
      action: <Link href="/admin/alerts" className="text-iris-hi hover:underline">Xem</Link>,
    },
    {
      ok: c.pending_deposits.count === 0,
      label: c.pending_deposits.count ? <><b>{c.pending_deposits.count} lệnh nạp</b> trong kỳ vẫn chờ thanh toán</> : "Không còn lệnh nạp chờ thanh toán",
      detail: c.pending_deposits.count ? vnd(c.pending_deposits.amount) : undefined,
    },
    {
      ok: c.unmatched_deposits.count === 0,
      label: c.unmatched_deposits.count ? <><b>{c.unmatched_deposits.count} khoản nạp</b> chưa gán tài khoản</> : "Không có khoản nạp treo",
      detail: c.unmatched_deposits.count ? `${vnd(c.unmatched_deposits.amount)} — chốt được, sẽ ghi là khoản treo` : undefined,
      action: c.unmatched_deposits.count ? <Link href="/admin/deposits" className="text-iris-hi hover:underline">Xử lý</Link> : undefined,
    },
    {
      ok: c.pending_withdrawals.count === 0,
      label: c.pending_withdrawals.count ? <><b>{c.pending_withdrawals.count} lệnh rút</b> chờ duyệt</> : "Không có lệnh rút chờ duyệt",
      detail: c.pending_withdrawals.count ? vnd(c.pending_withdrawals.amount) : undefined,
      action: c.pending_withdrawals.count ? <Link href="/admin/withdrawals" className="text-iris-hi hover:underline">Xem</Link> : undefined,
    },
    {
      ok: c.manual_adjustments.without_proof === 0,
      label: c.manual_adjustments.count === 0 ? "Không có khoản cộng/trừ tay"
        : c.manual_adjustments.without_proof ? <><b>{c.manual_adjustments.without_proof}/{c.manual_adjustments.count}</b> khoản cộng/trừ tay chưa có ảnh chứng từ</>
        : `Cả ${c.manual_adjustments.count} khoản cộng/trừ tay đều có chứng từ`,
    },
  ] : [];

  const submit = () => close.mutate({ ...range, note: note.trim() || undefined }, {
    onSuccess: (row) => { toast.success(`Đã chốt ${row.label}`); onClose(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Không chốt được kỳ")),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[17px] text-fg">Chốt kỳ {periodLabel(period)}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">
            {period.from.split("-").reverse().join("/")} 00:00 → {period.to.split("-").reverse().join("/")} 23:59 (giờ VN). Chốt xong, số liệu kỳ được khoá lại; bút toán phát sinh sau sẽ hiện là điều chỉnh sau chốt.
          </DialogDescription>
        </DialogHeader>

        {checklistQ.isLoading ? (
          <div className="flex justify-center py-8"><Spinner label="Đang kiểm tra" /></div>
        ) : checklistQ.isError || !c ? (
          <div className="space-y-2 py-4 text-center">
            <p className="text-[13px] text-bad">Không kiểm tra được kỳ này.</p>
            <Button variant="secondary" size="sm" onClick={() => checklistQ.refetch()}>Thử lại</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <ul aria-label="Kiểm tra trước khi chốt" className="divide-y divide-line rounded-lg border border-line">
              {checks.map((ch, i) => (
                <li key={i} className="flex items-start gap-3 px-3 py-2.5 text-[13px]">
                  <span className={cn("mt-0.5 shrink-0", ch.ok ? "text-good" : ch.blocking ? "text-bad" : "text-warn")} aria-label={ch.ok ? "Đạt" : ch.blocking ? "Chặn" : "Cần lưu ý"}>
                    {ch.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  </span>
                  <span className="min-w-0 flex-1 text-fg">
                    {ch.label}
                    {ch.detail && <span className="block text-[11.5px] text-muted">{ch.detail}</span>}
                  </span>
                  {ch.action && !ch.ok && <span className="shrink-0 text-[12.5px]">{ch.action}</span>}
                </li>
              ))}
            </ul>
            <div>
              <label htmlFor="close-note" className="text-[12.5px] font-medium text-fg">Ghi chú chốt kỳ</label>
              <Input id="close-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="vd: còn 3 khoản nạp treo, xử lý tháng sau" className="mt-1 h-9 text-[13px]" />
              <p className="mt-1 text-[11.5px] text-muted">Gói kế toán: báo cáo, sổ chi tiết, nạp, rút, cộng/trừ tay, số dư cuối kỳ (CSV trong một file ZIP).</p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <a href={api.adminFinanceExportUrl(range)} download className={buttonClass({ variant: "secondary" })}>
            <Download size={14} /> Chỉ tải gói, chưa chốt
          </a>
          <Button onClick={submit} loading={close.isPending} disabled={!c?.can_close}>Chốt kỳ và khoá số liệu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
