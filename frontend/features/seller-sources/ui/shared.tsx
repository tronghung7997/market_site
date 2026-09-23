"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { More } from "@/components/Icons";
import { cn } from "@/lib/cn";

type T = (k: string, v?: Record<string, string | number>) => string;

export function relTime(iso: string | null, t: T): string {
  if (!iso) return t("time.never");
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return t("time.minutesAgo", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 48) return t("time.hoursAgo", { n: hours });
  return t("time.daysAgo", { n: Math.round(hours / 24) });
}

/** Một dải số liệu chia ô (DESIGN §10: một summary surface, không phải N thẻ). */
export function SummaryStrip({ cells, label }: {
  label: string;
  cells: { key: string; label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" | "bad" | "good" }[];
}) {
  return (
    <section aria-label={label} className="grid grid-cols-2 overflow-hidden rounded-card border border-line bg-card lg:grid-cols-4">
      {cells.map((c, i) => (
        <div
          key={c.key}
          className={cn(
            "min-w-0 space-y-1 p-4",
            i % 2 === 1 && "border-l border-line",
            i >= 2 && "border-t border-line lg:border-t-0",
            i === 2 && "lg:border-l",
          )}
        >
          <p className="text-[12.5px] text-muted">{c.label}</p>
          <p className={cn(
            "font-mono text-[20px] font-semibold tabular-nums",
            c.tone === "warn" ? "text-warn" : c.tone === "bad" ? "text-bad" : c.tone === "good" ? "text-good" : "text-fg",
          )}>{c.value}</p>
          {c.sub && <div className="text-[12.5px] text-muted">{c.sub}</div>}
        </div>
      ))}
    </section>
  );
}

export type MenuItem = { key: string; label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void };

/** Menu thao tác cho một dòng: nút ⋯ mở danh sách role=menu; Esc / bấm ra
 *  ngoài để đóng; ↑↓ di chuyển giữa các mục. */
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const t = useTranslations("sellerSources");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const idx = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    itemRefs.current[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative inline-flex" onKeyDown={onKey}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("rowMenu", { name: label })}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
          open && "bg-surface text-fg",
        )}
      >
        <More size={16} />
      </button>
      {open && (
        <div role="menu" aria-label={label} className="absolute right-0 top-9 z-20 w-72 overflow-hidden rounded-card border border-line-2 bg-panel py-1 shadow-card-lg">
          {items.map((item, i) => (
            <button
              key={item.key}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none",
                item.danger ? "text-bad" : "text-fg",
                item.danger && i > 0 && "border-t border-line",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Chip lọc có số đếm — dùng chung cho các tab. */
export function FilterChip({ on, onClick, children, count, tone }: {
  on: boolean; onClick: () => void; children: ReactNode; count?: number | string; tone?: "warn" | "bad";
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[13px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
        on ? "border-fg bg-fg text-card" : "border-line-2 bg-card text-muted hover:text-fg",
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn(
          "font-mono text-[11.5px]",
          !on && tone === "warn" && Number(count) > 0 ? "text-warn" : !on && tone === "bad" && Number(count) > 0 ? "text-bad" : "opacity-70",
        )}>{count}</span>
      )}
    </button>
  );
}
