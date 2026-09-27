"use client";

/** The seller's "check before you confirm" steps as boxes the buyer ticks.
 *  Ticks stay on this device only; they are a guide, not a record. */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { CheckCircle2 } from "@/components/Icons";

export function InspectionChecklist({ steps, className }: { steps: string[]; className?: string }) {
  const t = useTranslations("orders");
  const [done, setDone] = useState<boolean[]>(() => steps.map(() => false));
  const count = done.filter(Boolean).length;
  if (steps.length === 0) return null;
  return (
    <fieldset className={cn("space-y-1.5", className)}>
      <legend className="flex w-full items-center justify-between gap-2 text-[11.5px] font-semibold text-muted">
        <span>{t("inspectChecklist")}</span>
        <span className="font-mono font-normal tabular">{t("inspectProgress", { done: count, total: steps.length })}</span>
      </legend>
      {steps.map((step, index) => (
        <label key={`${index}-${step}`} className="flex cursor-pointer items-start gap-2 text-[12.5px] text-fg/90">
          <input
            type="checkbox"
            checked={done[index] ?? false}
            onChange={(e) => setDone((current) => current.map((value, i) => (i === index ? e.target.checked : value)))}
            className="mt-0.5 h-4 w-4 shrink-0 accent-iris"
          />
          <span className={cn(done[index] && "text-muted line-through decoration-line-2")}>{step}</span>
        </label>
      ))}
      {count === steps.length && (
        <p className="flex items-center gap-1.5 pt-1 text-[12px] font-medium text-good">
          <CheckCircle2 size={13} /> {t("inspectAllDone")}
        </p>
      )}
    </fieldset>
  );
}
