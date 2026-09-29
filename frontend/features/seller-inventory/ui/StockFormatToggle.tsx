"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

/** "Line 1 is the format" box of a stock upload: off, every line is an account;
 *  on, line 1 names the columns and a `#` line under it holds login notes. */
export function StockFormatToggle({ checked, onChange, disabled = false }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("sellerInventory");
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5",
        checked ? "border-iris bg-iris-soft/40" : "border-dashed border-line-2 bg-raised/40",
        disabled && "cursor-default opacity-60",
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-2 text-iris"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-fg">{t("format.toggleLabel")}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">
          {checked ? t("format.toggleOn") : t("format.toggleOff")}
        </span>
      </span>
    </label>
  );
}
