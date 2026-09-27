"use client";

/** Where the buyer is in a purchase: choose → confirm & pay → receive & check. */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

const STEPS = ["choose", "pay", "receive"] as const;

export function PurchaseSteps({ current }: { current: 1 | 2 | 3 }) {
  const t = useTranslations("products.steps");
  return (
    <ol aria-label={t("label")} className="flex items-center gap-1.5 text-[11.5px]">
      {STEPS.map((step, index) => {
        const n = index + 1;
        const state = n < current ? "done" : n === current ? "current" : "next";
        return (
          <li key={step} aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cn("h-1 rounded-full", state === "next" ? "bg-line" : "bg-iris")} aria-hidden />
            <span className={cn("truncate", state === "current" ? "font-semibold text-fg" : "text-muted")}>
              {n}. {t(step)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
