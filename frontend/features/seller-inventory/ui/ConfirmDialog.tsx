"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Radix-based replacement for window.confirm(): keyboard-friendly, themed,
 *  and never blocks the event loop (or browser automation). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "primary",
  pending,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  /** Optional extra content between the description and the buttons (an input, a note). */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "primary" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !pending) onCancel(); }}>
      <DialogContent className="max-w-sm border-line bg-surface p-5 text-fg">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-fg">{title}</DialogTitle>
          {description && <DialogDescription className="text-[12.5px] text-muted">{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter className="mt-2 flex-row justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>{cancelLabel}</Button>
          <Button size="sm" variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={pending}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
