"use client";

/** Pieces shared by the campaign list and the campaign page: the ⋯ menu,
 *  the pause/resume confirm, CSV download and the row/page mutations. */

import * as React from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { downloadFromBff } from "@/lib/download";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { AdminPromotion } from "@/lib/types";
import { ConfirmModal } from "@/components/admin";
import { More } from "@/components/Icons";
import { PROMOTIONS_KEY, rowActions } from "../model";

export type RowAction = "edit" | "duplicate" | "copy" | "exportCsv" | "archive" | "unarchive" | "remove";

const LABELS: Record<RowAction, string> = {
  edit: "Sửa",
  duplicate: "Nhân bản",
  copy: "Sao chép mã",
  exportCsv: "Xuất CSV lượt dùng",
  archive: "Lưu trữ",
  unarchive: "Bỏ lưu trữ",
  remove: "Xoá",
};

/** ⋯ menu. Positioned `fixed` from the button (portal: the admin content has a transform). */
export function RowMenu({ promotion, onAction, hide = [] }: {
  promotion: AdminPromotion; onAction: (a: RowAction) => void; hide?: RowAction[];
}) {
  const [pos, setPos] = React.useState<{ right: number; top?: number; bottom?: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const open = pos != null;
  const allowed = rowActions(promotion);
  const items = (Object.keys(LABELS) as RowAction[]).filter((a) => allowed[a] && !hide.includes(a));

  const toggle = () => {
    if (open) { setPos(null); return; }
    const rect = buttonRef.current!.getBoundingClientRect();
    const right = window.innerWidth - rect.right;
    setPos(rect.bottom + 260 > window.innerHeight ? { right, bottom: window.innerHeight - rect.top + 4 } : { right, top: rect.bottom + 4 });
  };
  React.useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const close = (e: Event) => {
      if (e.type === "mousedown" && (menuRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node))) return;
      setPos(null);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPos(null); buttonRef.current?.focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const list = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
      const i = list.indexOf(document.activeElement as HTMLElement);
      list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", keys);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", keys);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Thao tác cho ${promotion.code}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg"
      >
        <More size={16} />
      </button>
      {pos && createPortal(
        <div ref={menuRef} role="menu" style={pos} className="fixed z-50 w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-card-lg">
          {items.map((a) => (
            <React.Fragment key={a}>
              {a === "remove" && <div className="my-1 h-px bg-line" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => { setPos(null); onAction(a); }}
                className={cn("block w-full px-3 py-2 text-left text-[13px] hover:bg-raised focus:bg-raised focus:outline-none", a === "remove" && "text-bad")}
              >
                {LABELS[a]}
              </button>
            </React.Fragment>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Every row/page mutation plus the confirms they need. Render `dialogs` once. */
export function usePromotionActions({ onDuplicated, onRemoved }: {
  onDuplicated: (p: AdminPromotion) => void; onRemoved?: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const [confirm, setConfirm] = React.useState<{ kind: "pause" | "resume" | "remove" | "archive"; p: AdminPromotion } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: PROMOTIONS_KEY });

  const run = useMutation({
    mutationFn: async ({ kind, p }: { kind: "pause" | "resume" | "remove" | "archive" | "unarchive" | "duplicate"; p: AdminPromotion }) => {
      switch (kind) {
        case "pause": return api.adminUpdatePromotion(p.id, { is_active: false });
        case "resume": return api.adminUpdatePromotion(p.id, { is_active: true });
        case "archive": return api.adminArchivePromotion(p.id);
        case "unarchive": return api.adminUnarchivePromotion(p.id);
        case "duplicate": return api.adminDuplicatePromotion(p.id);
        case "remove": await api.adminDeletePromotion(p.id); return null;
      }
    },
    onSuccess: (res, { kind, p }) => {
      setConfirm(null);
      void refresh();
      const done: Record<typeof kind, string> = {
        pause: `Đã tạm dừng ${p.code}`, resume: `Đã bật lại ${p.code}`, archive: `Đã lưu trữ ${p.code}`,
        unarchive: `Đã bỏ lưu trữ ${p.code}`, duplicate: `Đã nhân bản ${p.code}`, remove: `Đã xoá ${p.code}`,
      };
      toast.success(done[kind]);
      if (kind === "duplicate" && res) onDuplicated(res);
      if (kind === "remove") onRemoved?.();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Không thực hiện được thao tác.")),
  });

  const exportCsv = async (p: AdminPromotion) => {
    try {
      await downloadFromBff(api.adminPromotionRedemptionsCsvUrl(p.id), { fallbackName: `${p.code}-luot-dung.csv` });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Không tải được file CSV."));
    }
  };

  const copyCode = (p: AdminPromotion) => {
    navigator.clipboard?.writeText(p.code).then(() => toast.success(`Đã sao chép ${p.code}`), () => toast.error("Trình duyệt chặn sao chép."));
  };

  const act = (a: RowAction | "pause" | "resume", p: AdminPromotion) => {
    if (a === "pause" || a === "resume" || a === "remove" || a === "archive") setConfirm({ kind: a, p });
    else if (a === "duplicate" || a === "unarchive") run.mutate({ kind: a, p });
    else if (a === "copy") copyCode(p);
    else if (a === "exportCsv") void exportCsv(p);
  };

  const c = confirm;
  const remaining = c?.p.usage_limit != null ? Math.max(0, c.p.usage_limit - c.p.uses) : null;
  const copy = !c ? null : {
    pause: {
      title: `Tạm dừng ${c.p.code}?`,
      description: `Khách đang có mã này trong giỏ sẽ không áp dụng được nữa.${remaining != null ? ` ${remaining.toLocaleString("vi-VN")} lượt còn lại được giữ,` : " Lượt dùng được giữ,"} bật lại bất cứ lúc nào.`,
      confirmText: "Tạm dừng", variant: "danger" as const,
    },
    resume: {
      title: `Bật lại ${c.p.code}?`,
      description: "Khách nhập mã sẽ được giảm ngay nếu chiến dịch còn trong thời gian, còn lượt và ngân sách.",
      confirmText: "Bật lại", variant: "primary" as const,
    },
    archive: {
      title: `Lưu trữ ${c.p.code}?`,
      description: "Chiến dịch bị tắt và ẩn khỏi danh sách (xem ở bộ lọc Lưu trữ). Lượt dùng và số liệu được giữ nguyên.",
      confirmText: "Lưu trữ", variant: "primary" as const,
    },
    remove: {
      title: `Xoá ${c.p.code}?`,
      description: "Chưa có đơn nào dùng mã này nên có thể xoá hẳn. Không hoàn tác được.",
      confirmText: "Xoá", variant: "danger" as const,
    },
  }[c.kind];

  const dialogs = (
    <ConfirmModal
      isOpen={!!c}
      onClose={() => setConfirm(null)}
      onConfirm={() => c && run.mutate({ kind: c.kind, p: c.p })}
      title={copy?.title ?? ""}
      description={copy?.description ?? ""}
      confirmText={copy?.confirmText}
      variant={copy?.variant}
      isLoading={run.isPending}
    />
  );

  return { act, dialogs, pending: run.isPending ? run.variables : undefined };
}
