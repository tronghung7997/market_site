"use client";

import { useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { ChevronRight, Copy } from "@/components/Icons";

/* ----------------------------------------------------------------
   Refined primitives — hairline borders, restrained motion.
   Each component is the single source of truth for its look.
   ---------------------------------------------------------------- */

const BTN_VARIANTS = {
  primary: "bg-iris text-white hover:brightness-110",
  secondary: "bg-raised text-fg border border-line-2 hover:border-faint",
  ghost: "text-muted hover:text-fg hover:bg-surface",
  danger: "bg-bad/90 text-white hover:bg-bad",
} as const;
const BTN_SIZES = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-[13px] gap-2",
  lg: "h-11 px-5 text-sm gap-2",
} as const;

export function Button({
  variant = "primary", size = "md", block, className, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BTN_VARIANTS; size?: keyof typeof BTN_SIZES; block?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 cursor-pointer",
        "disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
        BTN_VARIANTS[variant], BTN_SIZES[size], block && "w-full", className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  className, interactive, children, ...props
}: { className?: string; interactive?: boolean; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-card border border-line rounded-card shadow-card",
        interactive && "transition-all duration-150 hover:shadow-card-lg hover:border-line-2 hover:-translate-y-0.5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

const TAG_TONES = {
  neutral: "bg-surface text-muted border-line-2",
  good: "bg-good-soft text-good border-good/25",
  bad: "bg-bad-soft text-bad border-bad/25",
  warn: "bg-warn-soft text-warn border-warn/25",
  iris: "bg-iris-soft text-iris-hi border-iris/25",
} as const;

export function Tag({
  tone = "neutral", className, children,
}: { tone?: keyof typeof TAG_TONES; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        TAG_TONES[tone], className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg bg-surface border border-line px-3 text-sm text-fg",
        "placeholder:text-faint transition-colors focus:border-iris focus:bg-panel",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg bg-surface border border-line px-3 py-2.5 text-sm text-fg",
        "placeholder:text-faint transition-colors focus:border-iris focus:bg-panel resize-y min-h-[80px]",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg bg-surface border border-line px-3 text-sm text-fg",
        "transition-colors focus:border-iris focus:bg-panel appearance-none",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Tooltip({ text, children, className, position = "top" }: { text: string; children: ReactNode; className?: string; position?: "top" | "bottom" }) {
  const pos = position === "top"
    ? "bottom-full mb-1.5 left-0"
    : "top-full mt-1.5 left-0";
  return (
    <span className={cn("group relative inline-flex max-w-full", className)}>
      {children}
      <span className={cn(
        "pointer-events-none absolute px-2.5 py-1.5 rounded-md bg-fg text-surface text-[11px] leading-snug whitespace-pre-wrap max-w-[300px] w-max opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-150 z-50 shadow-card-lg",
        pos,
      )}>
        {text}
      </span>
    </span>
  );
}

const BANNER_TONES = {
  warn: "bg-warn-soft border-warn/25 text-warn",
  bad: "bg-bad-soft border-bad/25 text-bad",
  good: "bg-good-soft border-good/25 text-good",
  iris: "bg-iris-soft border-iris/25 text-iris-hi",
} as const;

/** Bối cảnh/cảnh báo dùng chung — thay cho các div tự chế lặp lại tone tokens
 *  (bg-warn/10, bg-bad-soft…) rải rác ở nhiều trang. */
export function Banner({
  tone = "warn", icon, title, children, action, className,
}: {
  tone?: keyof typeof BANNER_TONES; icon?: ReactNode; title?: string;
  children?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn(
      "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[12.5px] leading-relaxed",
      BANNER_TONES[tone], className,
    )}>
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="flex-1 min-w-0 space-y-1">
        {title && <div className="font-semibold text-[13px]">{title}</div>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Ô chữ lồng 2 ký tự đầu của tên — "ảnh đại diện" cho hàng hoá số không có
 *  ảnh. Mặc định 36px nền raised chữ iris; chỗ khác cỡ/tông thì override qua
 *  className. Một bản thay cho 14 chỗ từng tự chế `slice(0,2).toUpperCase()`. */
export function Monogram({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid place-items-center h-9 w-9 shrink-0 rounded-lg bg-raised border border-line font-serif text-[13px] font-semibold text-iris",
        className,
      )}
    >
      {(text || "??").slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Small copy button; label flips for 1.6s after copy. Defaults come from common i18n. */
export function CopyButton({
  text, label, copiedLabel, className,
}: { text: string; label?: string; copiedLabel?: string; className?: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const idle = label ?? t("copy");
  const done = copiedLabel ?? t("copied");
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium text-muted hover:text-iris-hi transition-colors", className)}
    >
      <Copy size={11} /> {copied ? done : idle}
    </button>
  );
}

/** Windowed pagination: 1 … page±2 … last. Hidden when only one page. */
export function Pagination({
  page, totalPages, onChange,
}: { page: number; totalPages: number; onChange: (page: number) => void }) {
  const t = useTranslations("common");
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
    .reduce<(number | "…")[]>((acc, p, i, arr) => {
      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
      acc.push(p);
      return acc;
    }, []);
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>{t("previous")}</Button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="text-muted px-1">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={cn(
              "w-8 h-8 rounded-lg text-[13px] font-medium",
              page === p ? "bg-iris text-white" : "text-muted hover:bg-raised",
            )}
          >
            {p}
          </button>
        ),
      )}
      <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>{t("next")}</Button>
    </div>
  );
}

/** Mục thu gọn "Xem thêm ▸" — label đổi khi mở, nội dung chỉ render khi mở
 *  (caller có thể lazy-fetch trong onToggle). */
export function Disclosure({ label, labelOpen, open, onToggle, children }: {
  label: string; labelOpen: string; open: boolean; onToggle: () => void; children?: ReactNode;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-line">
      <button onClick={onToggle} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:text-iris transition-colors">
        <ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} />
        {open ? labelOpen : label}
      </button>
      {open && children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const t = useTranslations("common");
  return (
    <div className="flex items-center justify-center gap-2.5 py-14 text-muted">
      <span className="h-3.5 w-3.5 rounded-full border-2 border-line-2 border-t-iris animate-spin" />
      <span className="text-[13px]">{label ?? t("loading")}</span>
    </div>
  );
}
