"use client";

import { cn } from "@/lib/cn";
import { X } from "@/components/Icons";
import type { ProxyTag, TagTone } from "../model";

/** Tag colours are the five semantic tones — buyers pick a tone, not a hex. */
export const TAG_CHIP: Record<TagTone, string> = {
  iris: "bg-iris-soft text-iris-hi border-iris/25",
  good: "bg-good-soft text-good border-good/25",
  warn: "bg-warn-soft text-warn border-warn/25",
  neutral: "bg-raised text-muted border-line-2",
  ink: "bg-fg text-white border-fg",
};

export const TAG_DOT: Record<TagTone, string> = {
  iris: "bg-iris", good: "bg-good", warn: "bg-warn", neutral: "bg-faint", ink: "bg-fg",
};

export function ProxyTagChip({
  tag, size = "sm", onRemove, className, removeLabel,
}: { tag: ProxyTag; size?: "sm" | "md"; onRemove?: () => void; className?: string; removeLabel?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border font-medium leading-none whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-[12px]",
        TAG_CHIP[tag.tone], className,
      )}
    >
      <span className="truncate" title={tag.name}>{tag.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={removeLabel ?? tag.name} className="-mr-0.5 rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function TagDot({ tone, className }: { tone: TagTone; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]", TAG_DOT[tone], className)} />;
}
