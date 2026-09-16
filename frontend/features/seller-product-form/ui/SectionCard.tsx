"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui";
import { Check, ChevronDown, ChevronUp } from "@/components/Icons";

export type SectionState = "done" | "todo" | "optional";

/** Numbered form section — the number turns into a tick once the section's
 *  checks pass, so a new seller can read the page top to bottom. */
export function SectionCard({
  id, number, state, title, subtitle, action, collapsible, open = true, onToggle, children,
}: {
  id: string;
  number: number;
  state: SectionState;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const head = (
    <>
      <span className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold",
        state === "done" ? "bg-good text-white" : state === "todo" ? "bg-iris text-white" : "border border-line-2 bg-surface text-muted",
      )}>
        {state === "done" ? <Check size={14} /> : number}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[14px] font-bold text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p>}
      </div>
    </>
  );
  return (
    <Card id={id} className="scroll-mt-40 overflow-hidden">
      {collapsible ? (
        <div className="flex items-center gap-3 px-5 py-3.5">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            {head}
          </button>
          {action}
          <button type="button" onClick={onToggle} aria-expanded={open} className="text-faint hover:text-fg">
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-5 py-3.5">
          {head}
          {action}
        </div>
      )}
      {(!collapsible || open) && <div className="border-t border-line px-5 py-4">{children}</div>}
    </Card>
  );
}
