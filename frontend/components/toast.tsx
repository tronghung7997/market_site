"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "@/components/Icons";
import { cn } from "@/lib/cn";

/**
 * App-wide toast stack, pinned top-right so a "Saved" lands where the eye
 * already is regardless of how far down the page the button was.
 *
 *   const toast = useToast();
 *   toast.success("Đã lưu cấu hình");
 *   toast.error({ title: "Không lưu được", description: err.message });
 *
 * Success/info leave on their own after 6 s, warnings after 8 s, errors stay
 * 12 s; hovering pauses the clock and every toast has a close button.
 */
export type ToastTone = "success" | "error" | "warning" | "info";
export type ToastInput = { title: string; description?: string; duration?: number };

type ToastItem = ToastInput & { id: number; tone: ToastTone; duration: number };
type Push = (tone: ToastTone, input: ToastInput | string) => number;

export type ToastApi = {
  success: (input: ToastInput | string) => number;
  error: (input: ToastInput | string) => number;
  warning: (input: ToastInput | string) => number;
  info: (input: ToastInput | string) => number;
  dismiss: (id: number) => void;
};

const DEFAULT_DURATION: Record<ToastTone, number> = { success: 6000, info: 6000, warning: 8000, error: 12000 };

const STYLE: Record<ToastTone, { ring: string; icon: string; Icon: typeof Info }> = {
  success: { ring: "border-good/30", icon: "bg-good-soft text-good", Icon: CheckCircle2 },
  error: { ring: "border-bad/30", icon: "bg-bad-soft text-bad", Icon: AlertCircle },
  warning: { ring: "border-warn/30", icon: "bg-warn-soft text-warn", Icon: AlertTriangle },
  info: { ring: "border-iris/30", icon: "bg-iris-soft text-iris", Icon: Info },
};

const noop = () => 0;
const ToastContext = createContext<ToastApi>({ success: noop, error: noop, warning: noop, info: noop, dismiss: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>((tone, input) => {
    const base = typeof input === "string" ? { title: input } : input;
    const id = ++seq;
    // Newest on top; cap the stack so a burst of errors does not wall the screen.
    setItems((list) => [{ ...base, id, tone, duration: base.duration ?? DEFAULT_DURATION[tone] }, ...list].slice(0, 4));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({
    success: (i) => push("success", i),
    error: (i) => push("error", i),
    warning: (i) => push("warning", i),
    info: (i) => push("info", i),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted && createPortal(
        <div className="pointer-events-none fixed inset-x-4 top-4 z-[9999] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:top-5" aria-live="polite" aria-relevant="additions">
          <AnimatePresence initial={false}>
            {items.map((item) => <ToastCard key={item.id} item={item} onClose={() => dismiss(item.id)} />)}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const { ring, icon, Icon } = STYLE[item.tone];
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(onClose, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, onClose]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role={item.tone === "error" ? "alert" : "status"}
      className={cn("pointer-events-auto w-full max-w-[380px] rounded-xl border bg-card p-3.5 pr-2.5 shadow-card-lg", ring)}
    >
      <div className="flex items-start gap-3">
        <span className={cn("mt-px grid h-7 w-7 shrink-0 place-items-center rounded-lg", icon)}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[13.5px] font-semibold leading-snug text-fg">{item.title}</p>
          {item.description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{item.description}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="×" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint hover:bg-raised hover:text-fg">
          <X size={14} />
        </button>
      </div>
    </motion.div>
  );
}
