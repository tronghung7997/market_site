"use client";

/** The order's four steps with their times: paid, delivered, the protection
 *  window, completed (money released to the shop). */

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { timeLeftLabel } from "@/lib/time";
import { formatDateTime } from "@/lib/utils";
import type { Order } from "@/lib/types";
import { orderTimeline, type TimelineStep } from "../model";

const DOT: Record<TimelineStep["state"], string> = {
  done: "border-iris bg-iris text-white",
  current: "border-iris bg-iris-soft text-iris-hi",
  attention: "border-bad bg-bad-soft text-bad",
  next: "border-line bg-surface text-faint",
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** `labels` swaps the wording for another viewer (the seller page passes its
 *  own `sellerOrders.timeline` translator: it waits for the buyer and is paid
 *  out at the end); the default is the buyer's. */
export function OrderTimeline({ order, disputed, labels }: { order: Order; disputed: boolean; labels?: Translate }) {
  const buyerT = useTranslations("buyerOrders.timeline");
  const t: Translate = labels ?? ((key, values) => buyerT(key as never, values as never));
  const locale = useLocale();
  const steps = orderTimeline(order, disputed);
  if (!steps) return null;

  const detail = (step: TimelineStep): string => {
    if (step.state === "attention") return t("disputeOpen");
    if (step.key === "protection" && step.state === "current" && step.until) {
      const left = timeLeftLabel(step.until, locale);
      return left ? t("protectionLeft", { left }) : t("protectionEnding");
    }
    if (step.key === "protection" && step.until && step.state === "next") return t("protectionAfter");
    if (step.at) return formatDateTime(step.at, locale);
    if (step.key === "completed" && step.state === "next") return t("completedAuto");
    return step.state === "done" ? "" : t("waiting");
  };

  return (
    <ol aria-label={t("label")} className="grid gap-2.5 sm:grid-cols-4 sm:gap-0">
      {steps.map((step, index) => (
        <li key={step.key} className="relative flex gap-2.5 sm:flex-col sm:gap-1.5 sm:pr-3">
          {index > 0 && (
            <span aria-hidden className={cn(
              "absolute hidden h-0.5 sm:block sm:left-[-50%] sm:right-[50%] sm:top-2.5",
              step.state === "next" ? "bg-line" : "bg-iris",
            )} />
          )}
          <span className={cn("relative z-[1] grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[9.5px] font-bold sm:mx-auto", DOT[step.state])}>
            {step.state === "done" ? "✓" : index + 1}
          </span>
          <span className="min-w-0 sm:text-center">
            <span className={cn("block text-[12px]", step.state === "next" ? "text-muted" : "font-medium text-fg")}>
              {t(`${step.key}.${step.state === "done" ? "done" : "todo"}`)}
            </span>
            {detail(step) && <span className={cn("block text-[11px]", step.state === "attention" ? "text-bad" : "text-faint")}>{detail(step)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
