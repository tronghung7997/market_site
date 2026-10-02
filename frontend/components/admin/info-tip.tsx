"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

/**
 * Dấu "?" cạnh tiêu đề/chỉ số: rê chuột, focus bàn phím hoặc chạm (mobile)
 * đều mở lời giải thích ngắn. Portal nên không bị cắt bởi bảng/thẻ cuộn.
 * z-[100]: above dialogs (z-50) and the admin slide panel (z-[70]) so a "?"
 * inside them is never covered by the panel or its overlay.
 */
export function InfoTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
      <TooltipPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`Giải thích: ${label}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
          className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-2 align-middle text-[10px] font-semibold normal-case leading-none tracking-normal text-muted transition-colors hover:border-faint hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          ?
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="top"
          sideOffset={6}
          collisionPadding={12}
          className="z-[100] max-w-[300px] rounded-md bg-fg px-2.5 py-1.5 text-[12px] font-normal normal-case leading-snug tracking-normal text-surface shadow-card-lg"
        >
          {text}
          <TooltipPrimitive.Arrow className="fill-fg" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
