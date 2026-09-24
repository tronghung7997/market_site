"use client";

import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { BarChart, Rows } from "@/components/Icons";
import type { Delta, MetricDef } from "../model";
import { formatDelta } from "../model";

export interface LegendItem {
  label: string;
  color: string;
  shape?: "bar" | "line" | "dot";
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "shrink-0",
              i.shape === "line" ? "h-0.5 w-3.5 rounded-full" : i.shape === "dot" ? "h-2 w-2 rounded-full" : "h-2.5 w-2.5 rounded-[3px]",
            )}
            style={{ background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Chart card with an optional table-view twin (every value reachable
 *  without hovering). */
export function Panel({
  title, subtitle, legend, actions, table, children, className, bodyClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  actions?: ReactNode;
  table?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  const reduced = useReducedMotion();
  return (
    <section className={cn("flex min-w-0 flex-col rounded-card border border-line bg-card p-4 sm:p-5", className)} aria-labelledby={id}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={id} className="text-[13.5px] font-semibold text-fg">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[12px] text-faint">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              {showTable ? <BarChart size={13} /> : <Rows size={13} />}
              {showTable ? "Biểu đồ" : "Bảng"}
            </button>
          )}
        </div>
      </header>
      {legend && legend.length > 0 && !showTable && <div className="mb-2"><Legend items={legend} /></div>}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={showTable ? "table" : "chart"}
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0 }}
          transition={{ duration: 0.18 }}
          className={cn("min-w-0 flex-1", bodyClassName)}
        >
          {showTable ? <div className="max-h-[420px] overflow-auto">{table}</div> : children}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

export function DeltaBadge({ def, d, className }: { def: MetricDef; d: Delta | null; className?: string }) {
  if (!d) return null;
  const tone = d.tone === "good" ? "bg-good-soft text-good" : d.tone === "bad" ? "bg-bad-soft text-bad" : "bg-raised text-muted";
  const arrow = d.diff > 0 ? "▲" : d.diff < 0 ? "▼" : "";
  return (
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", tone, className)}>
      {arrow && <span aria-hidden className="text-[8px]">{arrow}</span>}
      {formatDelta(def, d)}
    </span>
  );
}

/** Plain data table used as every chart's table view. */
export function DataTable({ head, rows, align }: { head: string[]; rows: ReactNode[][]; align?: ("left" | "right")[] }) {
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead className="sticky top-0 bg-card">
        <tr className="border-b border-line text-left text-[11.5px] text-faint">
          {head.map((h, i) => (
            <th key={h} scope="col" className={cn("px-2 py-2 font-medium", (align?.[i] ?? (i ? "right" : "left")) === "right" && "text-right")}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-line/70 last:border-0">
            {r.map((c, i) => (
              <td key={i} className={cn("px-2 py-1.5", (align?.[i] ?? (i ? "right" : "left")) === "right" ? "text-right font-mono tabular-nums" : "text-fg")}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EmptyChart({ height, text = "Không có dữ liệu trong kỳ này" }: { height: number; text?: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-line text-[12.5px] text-faint" style={{ height }}>
      {text}
    </div>
  );
}
