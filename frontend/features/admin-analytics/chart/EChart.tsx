"use client";

import { useEffect, useRef, useState } from "react";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { cn } from "@/lib/cn";

type Handler = (params: unknown) => void;

export interface EChartProps {
  option: EChartsCoreOption;
  /** Pixel height of the whole chart box, axis labels included. */
  height: number;
  /** Short description for screen readers; the table view carries values. */
  label: string;
  onEvents?: Record<string, Handler>;
  /** Previous data stays on screen, dimmed, while the next slice loads. */
  dimmed?: boolean;
  className?: string;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function EChart({ option, height, label, onEvents, dimmed, className }: EChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const events = useRef(onEvents);
  const [ready, setReady] = useState(false);
  events.current = onEvents;

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    import("./echarts").then(({ echarts }) => {
      if (disposed || !host.current) return;
      const instance = echarts.init(host.current, null, { renderer: "svg" });
      chart.current = instance;
      observer = new ResizeObserver(() => instance.resize({ animation: { duration: 0 } }));
      observer.observe(host.current);
      setReady(true);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    if (!ready || !instance) return;
    const reduced = prefersReducedMotion();
    // replaceMerge keeps axes/grid (so bars tween to new values) while series
    // that disappeared with a filter are removed instead of lingering.
    instance.setOption(reduced ? { ...option, animation: false } : option, {
      replaceMerge: ["series", "xAxis", "yAxis", "visualMap", "dataZoom", "legend"],
    });
  }, [ready, option]);

  useEffect(() => {
    const instance = chart.current;
    if (!ready || !instance) return;
    const names = Object.keys(events.current ?? {});
    for (const name of names) instance.on(name, (p: unknown) => events.current?.[name]?.(p));
    return () => {
      for (const name of names) instance.off(name);
    };
  }, [ready, onEvents ? Object.keys(onEvents).join(",") : ""]);

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative w-full transition-opacity duration-200", dimmed && "opacity-55", className)}
      style={{ height }}
    >
      <div ref={host} className="absolute inset-0" />
      {!ready && <div aria-hidden className="absolute inset-0 animate-pulse rounded-lg bg-raised/60" />}
    </div>
  );
}
