"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "@/components/Icons";
import { useSiteStatus } from "../data";

export type FrozenFlow = "orders" | "deposits" | "withdrawals";

/** Inline warning + a boolean the parent uses to disable its submit. */
export function useFlowFrozen(flow: FrozenFlow): boolean {
  const { data } = useSiteStatus();
  if (!data) return false;
  return flow === "orders" ? data.orders_frozen : flow === "deposits" ? data.deposits_frozen : data.withdrawals_frozen;
}

export function FrozenNotice({ flow, className = "" }: { flow: FrozenFlow; className?: string }) {
  const t = useTranslations("siteStatus");
  const frozen = useFlowFrozen(flow);
  if (!frozen) return null;
  return (
    <div className={`flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-soft p-3 text-[12.5px] leading-snug text-warn ${className}`} role="status">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span>{t(`frozen_${flow}`)}</span>
    </div>
  );
}
