"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Bolt, Package } from "@/components/Icons";
import type { ReceiveMode } from "../model";

function Option({ selected, onSelect, title, body, icon, disabled }: { selected: boolean; onSelect: () => void; title: string; body: string; icon: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors disabled:opacity-50",
        selected ? "border-iris bg-iris-soft/40 ring-1 ring-iris" : "border-line bg-surface hover:border-line-2",
      )}
    >
      <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border", selected ? "border-iris" : "border-line-2")}>
        {selected && <span className="h-2 w-2 rounded-full bg-iris" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">{icon}{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{body}</span>
      </span>
    </button>
  );
}

/** Two everyday choices up front; API / task fulfilment stays behind an
 *  "advanced" link because it needs an approved provider. `lockedAdvanced`
 *  greys the advanced options out (seller tier too low) with a reason. */
export function ReceiveModePicker({
  value, onChange, lockedAdvanced, lockedReason,
}: {
  value: ReceiveMode;
  onChange: (next: ReceiveMode) => void;
  lockedAdvanced?: boolean;
  lockedReason?: string;
}) {
  const t = useTranslations("sellerProductForm.receive");
  const [showAdvanced, setShowAdvanced] = useState(value === "api" || value === "task");
  return (
    <div className="space-y-2.5">
      <div role="radiogroup" aria-label={t("label")} className="grid gap-2.5 sm:grid-cols-2">
        <Option selected={value === "instant"} onSelect={() => onChange("instant")} title={t("instantTitle")} body={t("instantBody")} icon={<Package size={14} className="text-iris-hi" />} />
        <Option selected={value === "sla"} onSelect={() => onChange("sla")} title={t("slaTitle")} body={t("slaBody")} icon={<Package size={14} className="text-iris-hi" />} />
        {showAdvanced && (
          <>
            <Option selected={value === "api"} onSelect={() => onChange("api")} title={t("apiTitle")} body={t("apiBody")} icon={<Bolt size={14} className="text-iris-hi" />} disabled={lockedAdvanced} />
            <Option selected={value === "task"} onSelect={() => onChange("task")} title={t("taskTitle")} body={t("taskBody")} icon={<Bolt size={14} className="text-iris-hi" />} disabled={lockedAdvanced} />
          </>
        )}
      </div>
      {!showAdvanced ? (
        <p className="text-[12px] text-muted">
          {t("advancedLead")}{" "}
          <button type="button" onClick={() => setShowAdvanced(true)} className="font-medium text-iris hover:underline">{t("advancedLink")}</button>
        </p>
      ) : lockedAdvanced && lockedReason ? (
        <p className="text-[12px] text-warn">{lockedReason}</p>
      ) : (
        <p className="text-[12px] text-muted">{t("advancedNote")}</p>
      )}
    </div>
  );
}
