"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Info, Sparkles } from "@/components/Icons";
import type { AnalyticsState, Insight, InsightSeverity } from "../model";

const STYLE: Record<InsightSeverity, { icon: typeof Info; tone: string; bar: string; label: string }> = {
  bad: { icon: AlertCircle, tone: "text-bad", bar: "bg-bad", label: "Cần xử lý" },
  warn: { icon: AlertTriangle, tone: "text-warn", bar: "bg-warn", label: "Theo dõi" },
  good: { icon: CheckCircle2, tone: "text-good", bar: "bg-good", label: "Tích cực" },
  info: { icon: Info, tone: "text-iris-hi", bar: "bg-iris", label: "Lưu ý" },
};

export function InsightsPanel({ insights, onAction }: { insights: Insight[]; onAction: (patch: Partial<AnalyticsState>) => void }) {
  const reduced = useReducedMotion();
  return (
    <section className="rounded-card border border-line bg-card p-4 sm:p-5" aria-labelledby="insights-title">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 id="insights-title" className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">
          <Sparkles size={15} className="text-iris" /> Điểm cần chú ý
        </h3>
        <span className="text-[11.5px] text-faint">{insights.length ? `${insights.length} tín hiệu` : "Tự động theo quy tắc"}</span>
      </header>
      {insights.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg bg-good-soft/60 px-3 py-3 text-[12.5px] text-good">
          <CheckCircle2 size={15} /> Không có chỉ số nào vượt ngưỡng cảnh báo trong kỳ này.
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {insights.map((i, idx) => {
            const s = STYLE[i.severity];
            return (
              <motion.li
                key={i.id}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: reduced ? 0 : Math.min(idx, 6) * 0.035 }}
                className="relative flex gap-3 overflow-hidden rounded-lg border border-line bg-surface py-2.5 pl-4 pr-3"
              >
                <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", s.bar)} />
                <s.icon size={16} className={cn("mt-0.5 shrink-0", s.tone)} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold leading-snug text-fg">
                    <span className={cn("mr-1.5 text-[10.5px] font-semibold uppercase tracking-wide", s.tone)}>{s.label}</span>
                    {i.title}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{i.detail}</p>
                </div>
                {i.action && (
                  <button
                    type="button"
                    onClick={() => onAction(i.action!.patch)}
                    className="inline-flex h-7 shrink-0 items-center gap-1 self-center rounded-md px-2 text-[11.5px] font-medium text-iris-hi transition-colors hover:bg-iris-soft"
                  >
                    {i.action.label} <ArrowRight size={12} />
                  </button>
                )}
              </motion.li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
