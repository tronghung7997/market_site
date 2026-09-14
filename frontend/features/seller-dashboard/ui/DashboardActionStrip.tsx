"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { SellerDashboard } from "@/lib/types";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Info } from "@/components/Icons";

const SEVERITY = {
  critical: { icon: AlertCircle, className: "border-bad/25 bg-bad-soft/60 text-bad" },
  warning: { icon: AlertTriangle, className: "border-warn/25 bg-warn-soft/60 text-warn" },
  info: { icon: Info, className: "border-iris/25 bg-iris-soft/60 text-iris-hi" },
} as const;

const MAX_SHOWN = 4;

export function DashboardActionStrip({ items }: { items: SellerDashboard["action_items"] }) {
  const t = useTranslations("sellerDashboard");
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-good/25 bg-good-soft/50 px-3 py-2 text-[12.5px] text-good">
        <CheckCircle2 size={14} />
        <span className="font-medium">{t("actionsClear")}</span>
      </div>
    );
  }
  const shown = items.slice(0, MAX_SHOWN);
  const hidden = items.length - shown.length;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("actionsTitle")}>
      {shown.map((item) => {
        const sev = SEVERITY[item.severity as keyof typeof SEVERITY] ?? SEVERITY.info;
        const Icon = sev.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            className={cn(
              "flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors hover:brightness-[0.98]",
              sev.className,
            )}
          >
            <Icon size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg" title={item.label}>
              {item.label}
            </span>
            <ChevronRight size={14} className="shrink-0" />
          </Link>
        );
      })}
      {hidden > 0 && (
        <span className="self-center text-[12px] text-faint">{t("actionsMore", { count: hidden })}</span>
      )}
    </div>
  );
}
