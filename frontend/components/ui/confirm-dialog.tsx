"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

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
          <Button size="sm" variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={pending}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type ConfirmRequest = {
  title: string;
  description?: string;
  confirmLabel: string;
  /** Defaults to common.cancel. */
  cancelLabel?: string;
  tone?: "primary" | "danger";
};

/** Promise-based drop-in for `window.confirm()`:
 *  `const [confirm, confirmDialog] = useConfirm();`
 *  `if (!(await confirm({ title, confirmLabel }))) return;` and render `{confirmDialog}`. */
export function useConfirm(): [(request: ConfirmRequest) => Promise<boolean>, ReactNode] {
  const tc = useTranslations("common");
  // The request stays set after closing so the dialog keeps its text while it animates out.
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
  const [open, setOpen] = useState(false);

  const confirm = useCallback(
    (next: ConfirmRequest) => new Promise<boolean>((resolve) => {
      setRequest({ ...next, resolve });
      setOpen(true);
    }),
    [],
  );
  const settle = (ok: boolean) => {
    request?.resolve(ok);
    setOpen(false);
  };
  const dialog = (
    <ConfirmDialog
      open={open}
      title={request?.title ?? ""}
      description={request?.description}
      confirmLabel={request?.confirmLabel ?? ""}
      cancelLabel={request?.cancelLabel ?? tc("cancel")}
      tone={request?.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
  return [confirm, dialog];
}
