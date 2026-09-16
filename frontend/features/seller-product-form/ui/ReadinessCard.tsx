"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Card, Tag } from "@/components/ui";
import { Check, X } from "@/components/Icons";
import type { SellableEvaluation } from "@/features/seller-workbench/logic";
import { checklistJump, type ChecklistJump } from "../model";

/** "What is left before selling?" — every failing line is a button that jumps
 *  to the field, which is what a new seller needs instead of a scoreboard. */
export function ReadinessCard({
  evaluation, titleMissing, onJump, title,
}: {
  evaluation: SellableEvaluation;
  titleMissing: boolean;
  onJump: (target: ChecklistJump) => void;
  title: string;
}) {
  const t = useTranslations("sellerProductForm.readiness");
  const tw = useTranslations("seller.workbench");
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-bold text-fg">{title}</span>
        <Tag tone={evaluation.isSellable ? "good" : "warn"}>{evaluation.passCount} / {evaluation.totalCount}</Tag>
      </div>
      <ul className="space-y-1">
        {evaluation.checks.map((item) => (
          <li key={item.key}>
            {item.pass ? (
              <span className="flex items-start gap-2 py-1 text-[12.5px] text-muted">
                <Check size={14} className="mt-0.5 shrink-0 text-good" />
                <span className="line-through decoration-line-2">{tw(item.labelKey)}</span>
              </span>
            ) : (
              <button type="button" onClick={() => onJump(checklistJump(item, titleMissing))} className={cn("flex w-full items-start gap-2 rounded-md py-1 text-left text-[12.5px] text-fg hover:bg-raised/60")}>
                <X size={14} className="mt-0.5 shrink-0 text-bad" />
                <span className="min-w-0 flex-1">{tw(item.labelKey)}</span>
                <span className="shrink-0 text-[11.5px] font-medium text-iris">{t("fix")} →</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {!evaluation.isSellable && <p className="mt-2 text-[11px] text-faint">{t("hint")}</p>}
    </Card>
  );
}
