"use client";

import { useTranslations } from "next-intl";
import { useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Textarea } from "@/components/ui";
import { formatLineIndexes } from "../logic";

// Box model shared by the textarea and the highlight layer under it, so both
// wrap every line at the same place.
const BOX = "w-full rounded-lg border px-3 py-2.5 text-sm [scrollbar-gutter:stable] whitespace-pre-wrap break-words";

/**
 * Stock text box whose first line — the upload's format — and the `#` login
 * notes under it are tinted as the seller types, so it is obvious they are
 * not stock. The tint sits in a layer behind a transparent textarea (a
 * textarea cannot style its own lines) and follows its scroll.
 */
export function FormatTextarea({
  value, highlight = true, className, onScroll, ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & { value: string; highlight?: boolean }) {
  const t = useTranslations("sellerInventory");
  const layer = useRef<HTMLDivElement>(null);
  if (!highlight) return <Textarea value={value} onScroll={onScroll} className={className} {...props} />;
  const { format, note } = formatLineIndexes(value);
  const lines = value.split("\n");
  return (
    <div className="space-y-1">
      <div className="relative">
        <div ref={layer} aria-hidden className={cn(BOX, "pointer-events-none absolute inset-0 overflow-hidden border-transparent bg-surface text-transparent", className, "text-transparent")}>
          {lines.map((line, index) => (
            <div
              key={index}
              className={cn(
                "-mx-1 rounded px-1",
                index === format && "bg-[color-mix(in_srgb,var(--color-iris)_18%,transparent)] shadow-[inset_3px_0_0_var(--color-iris)]",
                index === note && "bg-[color-mix(in_srgb,var(--color-iris)_9%,transparent)]",
              )}
            >
              {line || "​"}
            </div>
          ))}
        </div>
        <Textarea
          value={value}
          onScroll={(event) => {
            if (layer.current) layer.current.scrollTop = event.currentTarget.scrollTop;
            onScroll?.(event);
          }}
          className={cn(BOX, "relative", className, "bg-transparent focus:bg-transparent")}
          {...props}
        />
      </div>
      {format >= 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted" aria-live="polite">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-5 rounded-sm bg-[color-mix(in_srgb,var(--color-iris)_18%,transparent)] shadow-[inset_3px_0_0_var(--color-iris)]" /> {t("format.legendFormat", { line: format + 1 })}</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-5 rounded-sm bg-[color-mix(in_srgb,var(--color-iris)_9%,transparent)]" /> {note >= 0 ? t("format.legendNote", { line: note + 1 }) : t("format.legendNoNote")}</span>
        </p>
      )}
    </div>
  );
}
