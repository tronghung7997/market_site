"use client";

import { useLocale, useTranslations } from "next-intl";
import { Clock, ShieldCheck } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import { timeLeftLabel } from "@/lib/time";
import type { Order } from "@/lib/types";
import { orderDeadline } from "../model";

/** One line under a row's status: how long the buyer has left to inspect a
 *  delivered order, or until when the shop must deliver a manual one. */
export function DeadlineNote({ order, disputed, variant }: { order: Order; disputed: boolean; variant: "row" | "card" }) {
  const t = useTranslations("orders");
  const locale = useLocale();
  const deadline = orderDeadline(order, disputed);
  if (!deadline) return null;
  const iso = deadline.at.toISOString();
  const left = timeLeftLabel(iso, locale);
  const date = formatDate(iso, locale);
  const text = deadline.kind === "protection"
    ? t("protectionUntilLeft", { date, left: left ?? "—" })
    : left ? t("deliveryDueLeft", { date, left }) : t("deliveryOverdue");
  const Icon = deadline.kind === "protection" ? ShieldCheck : Clock;
  const tone = deadline.urgent ? "text-warn" : deadline.kind === "protection" ? "text-good" : "text-muted";
  if (variant === "card") {
    return (
      <p className={cn(
        "mt-2.5 flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium",
        deadline.urgent ? "border-warn/25 bg-warn-soft/60 text-warn" : "border-good/20 bg-good-soft/30 text-good",
        deadline.kind === "delivery" && !deadline.urgent && "border-line bg-raised/60 text-muted",
      )}>
        <Icon size={13} className="shrink-0" />
        <span>{text}</span>
      </p>
    );
  }
  return (
    <p className={cn("mt-1 flex items-center gap-1 text-[11px]", deadline.urgent ? "font-medium text-warn" : "text-muted")}>
      <Icon size={11} className={cn("shrink-0", tone)} />
      <span className="min-w-0">{text}</span>
    </p>
  );
}
