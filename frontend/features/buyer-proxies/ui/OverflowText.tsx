"use client";

import { useRef, useState } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

/** Text that wraps up to `lines` lines and only then clamps. When — and only
 *  when — the text is actually cut, hover / keyboard focus shows the full
 *  value in a tooltip, so nothing in the table is ever unreachable. */
export function OverflowText({
  text, lines = 2, className, as: Tag = "span",
}: { text: string; lines?: 1 | 2 | 3; className?: string; as?: "span" | "div" }) {
  const ref = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const clamp = lines === 1 ? "truncate" : lines === 2 ? "line-clamp-2" : "line-clamp-3";
  const overflowing = () => {
    const el = ref.current;
    return Boolean(el && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1));
  };
  return (
    <TooltipPrimitive.Root open={open} onOpenChange={(next) => setOpen(next && overflowing())}>
      <TooltipPrimitive.Trigger asChild>
        <Tag
          ref={ref as never}
          className={cn("block break-words", clamp, className)}
          // Focusable only when there is something hidden to reveal.
          tabIndex={-1}
        >
          {text}
        </Tag>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="top"
          align="start"
          sideOffset={4}
          className="z-50 max-w-[320px] break-words rounded-md bg-slate-900 px-2.5 py-1.5 text-[11.5px] leading-snug text-white shadow-lg"
        >
          {text}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
