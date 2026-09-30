"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Button, Input, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BLOCK_REASON_MAX, blockReasonValid, NOTE_MAX, RESOLVED_NOTICE } from "../model";

/** Focus the safe button first so a stray Enter never confirms. */
function focusSafe(e: Event) {
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
}

export function ResolveDialog({ open, pending, onClose, onConfirm }: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: (outcome: string, notify: boolean) => void;
}) {
  const [outcome, setOutcome] = React.useState("");
  const [notify, setNotify] = React.useState(true);
  React.useEffect(() => { if (open) { setOutcome(""); setNotify(true); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="max-w-md border-line bg-surface text-fg">
        <DialogHeader>
          <DialogTitle className="text-[16px] text-fg">Đánh dấu đã xử lý xong</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">
            Ticket rời hàng “Chờ trả lời”. Khách nhắn lại thì tự mở lại.
          </DialogDescription>
        </DialogHeader>
        <label className="block">
          <span className="text-[12.5px] font-medium text-muted">Kết quả (nội bộ, tuỳ chọn)</span>
          <Textarea
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            maxLength={NOTE_MAX}
            className="mt-1.5 min-h-[72px] text-[12.5px]"
            placeholder="VD: Đã đổi IP, khách xác nhận dùng được."
          />
          <span className="mt-1 block text-[11px] text-faint">Lưu thành ghi chú nội bộ, khách không thấy.</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-fg">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-iris)]" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>Gửi tin “{RESOLVED_NOTICE}” cho khách</span>
        </label>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Huỷ</Button>
          <Button loading={pending} onClick={() => onConfirm(outcome.trim(), notify)}>Xong</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BlockDialog({ open, requester, pending, onClose, onConfirm }: {
  open: boolean;
  requester: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => { if (open) { setReason(""); setTouched(false); } }, [open]);
  const valid = blockReasonValid(reason);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="max-w-md border-line bg-surface text-fg" onOpenAutoFocus={focusSafe}>
        <DialogHeader>
          <DialogTitle className="text-[16px] text-fg">Chặn người gửi khỏi hỗ trợ?</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">
            <span className="font-medium text-fg">{requester}</span> không nhắn vào hỗ trợ được nữa. Tài khoản và đơn hàng không bị ảnh hưởng. Có thể bỏ chặn.
          </DialogDescription>
        </DialogHeader>
        <form
          id="block-form"
          onSubmit={(e) => { e.preventDefault(); setTouched(true); if (valid) onConfirm(reason.trim()); }}
        >
          <label className="block">
            <span className="text-[12.5px] font-medium text-muted">Lý do (bắt buộc, ghi audit)</span>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              maxLength={BLOCK_REASON_MAX}
              aria-invalid={touched && !valid}
              aria-describedby="block-reason-hint"
              className="mt-1.5 h-9 text-[12.5px]"
              placeholder="VD: Spam quảng cáo lặp lại"
            />
            <span id="block-reason-hint" className={cn("mt-1 flex justify-between text-[11px]", touched && !valid ? "text-bad" : "text-faint")}>
              <span>{touched && !valid ? "Cần 3–300 ký tự" : "3–300 ký tự"}</span>
              <span className="font-mono">{reason.length}/{BLOCK_REASON_MAX}</span>
            </span>
          </label>
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button data-autofocus variant="secondary" onClick={onClose} disabled={pending}>Huỷ</Button>
          <Button type="submit" form="block-form" variant="danger" loading={pending} disabled={!valid}>Chặn</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
