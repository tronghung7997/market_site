"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import type { AdminSellerApplicationRow, SellerApplicationInfoField } from "@/lib/types";
import { Button, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check } from "@/components/Icons";
import {
  composeRejectMessage, INFO_FIELDS, INFO_NOTE_MAX, REJECT_MAX, REJECT_TEMPLATES, rejectMessageValid, RESUBMIT_DAYS, resubmitDate,
} from "../model";

function ChoiceChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
        on ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg",
      )}
    >
      {on && <Check size={12} />}
      {children}
    </button>
  );
}

export function RejectDialog({ app, open, onClose, onConfirm }: {
  app: AdminSellerApplicationRow | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string, resubmitAfterDays: number) => void;
}) {
  const [picked, setPicked] = React.useState<string[]>([]);
  const [extra, setExtra] = React.useState("");
  const [days, setDays] = React.useState<number>(0);
  React.useEffect(() => { if (open) { setPicked([]); setExtra(""); setDays(0); } }, [open, app?.id]);
  const message = composeRejectMessage(REJECT_TEMPLATES.filter((t) => picked.includes(t)), extra);
  const valid = rejectMessageValid(message);
  const until = resubmitDate(days);
  const toggle = (t: string) => setPicked((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[16px] text-fg">Từ chối đơn đăng ký</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">
            {app ? `“${app.business_name}” — ` : ""}lý do được gửi qua email và hiện trên trang đăng ký của người nộp.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset>
            <legend className="text-[12.5px] font-medium text-muted">Lý do thường gặp</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {REJECT_TEMPLATES.map((t) => <ChoiceChip key={t} on={picked.includes(t)} onClick={() => toggle(t)}>{t}</ChoiceChip>)}
            </div>
          </fieldset>
          <label className="block">
            <span className="text-[12.5px] font-medium text-muted">Ghi thêm</span>
            <Textarea value={extra} onChange={(e) => setExtra(e.target.value)} className="mt-1.5 min-h-[72px] text-[12.5px]" placeholder="Giải thích cụ thể để người nộp biết cần sửa gì" />
          </label>
          <div className="flex items-center justify-between text-[11.5px]">
            <span className={cn(valid ? "text-faint" : "text-bad")}>{message.trim().length < 3 ? "Cần ít nhất 3 ký tự" : message.length > REJECT_MAX ? "Quá dài" : "Nội dung gửi đi"}</span>
            <span className={cn("font-mono", message.length > REJECT_MAX ? "text-bad" : "text-faint")}>{message.length}/{REJECT_MAX}</span>
          </div>
          <fieldset>
            <legend className="text-[12.5px] font-medium text-muted">Cho phép nộp lại sau</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {RESUBMIT_DAYS.map((d) => <ChoiceChip key={d} on={days === d} onClick={() => setDays(d)}>{d === 0 ? "Ngay" : `${d} ngày`}</ChoiceChip>)}
            </div>
          </fieldset>
          <section aria-label="Xem trước email" className="rounded-lg border border-line bg-raised/40 p-3 text-[12.5px]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Xem trước email</p>
            <p className="mt-1.5 text-fg">Chào {app?.applicant.email ?? "bạn"},</p>
            <p className="mt-1 text-fg">Đơn đăng ký gian hàng “{app?.business_name}” chưa được duyệt vì:</p>
            <p className="mt-1 whitespace-pre-line break-words text-fg">{message || <span className="text-faint">(chưa có lý do)</span>}</p>
            <p className="mt-1 text-muted">{until ? `Bạn có thể gửi đơn mới từ ${formatDate(until, "vi")}.` : "Bạn có thể sửa và gửi lại đơn ngay."}</p>
          </section>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button variant="danger" disabled={!valid} onClick={() => onConfirm(message.trim(), days)}>Từ chối</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RequestInfoDialog({ app, open, onClose, onConfirm }: {
  app: AdminSellerApplicationRow | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (note: string, fields: SellerApplicationInfoField[]) => void;
}) {
  const [fields, setFields] = React.useState<SellerApplicationInfoField[]>([]);
  const [note, setNote] = React.useState("");
  React.useEffect(() => { if (open) { setFields([]); setNote(""); } }, [open, app?.id]);
  const toggle = (f: SellerApplicationInfoField) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  const valid = note.trim().length >= 1 && note.length <= INFO_NOTE_MAX;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[16px] text-fg">Yêu cầu bổ sung thông tin</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">
            Người nộp nhận ghi chú qua email; các mục được chọn sẽ được đánh dấu trong form đăng ký.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset>
            <legend className="text-[12.5px] font-medium text-muted">Mục cần sửa</legend>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {INFO_FIELDS.map((f) => (
                <label key={f.key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-fg hover:border-line-2">
                  <input type="checkbox" className="accent-[var(--color-iris)]" checked={fields.includes(f.key)} onChange={() => toggle(f.key)} />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="text-[12.5px] font-medium text-muted">Ghi chú cho người nộp</span>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={INFO_NOTE_MAX} className="mt-1.5 min-h-[88px] text-[12.5px]" placeholder="VD: Cho biết nguồn hàng và chính sách bảo hành" />
            <span className="mt-1 block text-right font-mono text-[11px] text-faint">{note.length}/{INFO_NOTE_MAX}</span>
          </label>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button disabled={!valid} onClick={() => onConfirm(note.trim(), fields)}>Gửi yêu cầu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Approving is the one decision with public side effects (seller role, open
 *  shop, email), so it is never a single keystroke: A or the button opens this. */
export function ApproveDialog({ app, open, onClose, onConfirm }: {
  app: AdminSellerApplicationRow | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [ack, setAck] = React.useState(false);
  React.useEffect(() => { if (open) setAck(false); }, [open, app?.id]);
  const risky = (app?.risk_count ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-md"
        // Focus Huỷ, not Duyệt: a stray Enter right after A must not approve.
        onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.querySelector<HTMLButtonElement>("[data-autofocus]")?.focus(); }}
      >
        <DialogHeader>
          <DialogTitle className="text-[16px] text-fg">Duyệt gian hàng “{app?.business_name}”?</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">
            Người nộp: <span className="font-medium text-fg">{app?.applicant.email}</span>
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 rounded-lg border border-line bg-surface px-3.5 py-3 text-[12.5px] text-fg">
          <li>• Tài khoản được cấp vai trò Người bán và đăng bán được ngay.</li>
          <li>• Gian hàng hiện công khai trên chợ.</li>
          <li>• Người nộp nhận email và thông báo đã được duyệt.</li>
        </ul>
        {risky && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-bad/30 bg-bad-soft/40 px-3.5 py-3 text-[12.5px] text-bad">
            <input type="checkbox" className="mt-0.5 accent-[var(--color-bad)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>Đơn này có {app?.risk_count} cảnh báo rủi ro. Tôi đã xem và vẫn muốn duyệt.</span>
          </label>
        )}
        <p className="text-[11.5px] text-faint">Sau khi bấm Duyệt vẫn có 8 giây để hoàn tác.</p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button data-autofocus variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button disabled={risky && !ack} onClick={onConfirm}>Duyệt &amp; mở gian hàng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
