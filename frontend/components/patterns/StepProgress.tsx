import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Compact horizontal progress for a fixed sequence of steps (e.g. a
 * withdrawal: sent → approved → transferred). Pure presentation: the caller
 * passes translated labels and the index of the step reached. `stopped`
 * marks a flow that ended early (rejected/cancelled) at that step.
 */
export function StepProgress({
  steps, current, stopped, stoppedLabel, className,
}: {
  steps: string[];
  /** Index of the last step reached (0-based). */
  current: number;
  stopped?: boolean;
  stoppedLabel?: string;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-center gap-1 text-[11px]", className)} aria-label={steps.join(" → ")}>
      {steps.map((label, i) => {
        const done = i < current || (i === current && !stopped);
        const failed = stopped && i === current;
        const state = failed ? "bad" : done ? "done" : "todo";
        return (
          <li key={label} className="flex min-w-0 items-center gap-1" aria-current={i === current ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={cn("h-px w-3 shrink-0 sm:w-5", i <= current ? "bg-good" : "bg-line-2")} />}
            <span
              aria-hidden
              className={cn(
                "grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] font-bold leading-none",
                state === "done" && "border-good bg-good text-surface",
                state === "bad" && "border-bad bg-bad text-surface",
                state === "todo" && "border-line-2 bg-surface text-muted",
              )}
            >
              {state === "done" ? "✓" : state === "bad" ? "✕" : i + 1}
            </span>
            <span className={cn(
              "truncate",
              state === "done" && "text-fg",
              state === "bad" && "font-medium text-bad",
              state === "todo" && "text-muted",
            )}>
              {failed && stoppedLabel ? stoppedLabel : label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
