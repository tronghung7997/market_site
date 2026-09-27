"use client";

/** Where the buyer's money goes after "confirm": escrow today, the delivery,
 *  then the inspection window before it reaches the shop. */

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Shield } from "@/components/Icons";
import { inspectionDeadline } from "../model";

export function MoneyTimeline({ instant, slaHours, escrowDays, deliverTitle }: {
  instant: boolean;
  slaHours: number;
  escrowDays: number;
  /** Replaces the delivery step title for configurators (API key, task result). */
  deliverTitle?: string;
}) {
  const t = useTranslations("products.moneyFlow");
  const locale = useLocale();
  // Captured once when the dialog opens, like the order the buyer is about to place.
  const [openedAt] = useState(() => Date.now());
  const deadline = inspectionDeadline(openedAt, escrowDays, instant);
  const until = deadline
    ? new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric", year: "numeric" }).format(deadline)
    : null;
  const steps = [
    { title: t("escrowTitle"), body: t("escrowBody") },
    { title: deliverTitle ?? (instant ? t("deliverNow") : t("deliverWithin", { hours: slaHours })), body: t("deliverBody") },
    { title: t("inspectTitle", { days: escrowDays }), body: until ? t("inspectUntil", { date: until }) : t("inspectBody") },
  ];
  return (
    <div className="rounded-md border border-good/15 bg-good/5 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-fg"><Shield size={13} className="text-good" /> {t("title")}</p>
      <ol className="mt-2 space-y-2">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-2.5">
            <span className={cn(
              "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9.5px] font-bold",
              index === 0 ? "border-good bg-good text-white" : "border-line-2 bg-surface text-muted",
            )}>
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-medium text-fg">{step.title}</span>
              <span className="block text-[11.5px] leading-snug text-muted">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
