"use client";

/** How present a shop is, in bands only: typical first reply to a buyer
 *  (last 30 days) and when the owner was last active. Renders nothing for a
 *  shop without enough chats or activity. */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { SellerProfile } from "@/lib/types";
import { Activity, Clock } from "@/components/Icons";

export function SellerPresence({ seller, className }: {
  seller: Pick<SellerProfile, "response_time" | "active_within">;
  className?: string;
}) {
  const t = useTranslations("sellers.presence");
  const reply = seller.response_time;
  const active = seller.active_within;
  if (!reply && !active) return null;
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted", className)}>
      {reply && (
        <li className="inline-flex items-center gap-1.5" title={t("replyHint", { sample: reply.sample })}>
          <Clock size={12} className="text-faint" />
          <span>
            {t(`reply.${reply.within}`)}
            {reply.rate < 100 && <span className="text-faint"> · {t("replyRate", { rate: reply.rate })}</span>}
          </span>
        </li>
      )}
      {active && (
        <li className="inline-flex items-center gap-1.5">
          {active === "15m"
            ? <span aria-hidden className="h-2 w-2 rounded-full bg-good" />
            : <Activity size={12} className="text-faint" />}
          <span>{t(`active.${active}`)}</span>
        </li>
      )}
    </ul>
  );
}
