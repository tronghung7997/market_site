"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui";
import { Shield } from "@/components/Icons";

/** "?" button that explains escrow in plain words. Opens on hover / focus and
 *  also on tap (so it works on phones), and is portalled so `overflow-hidden`
 *  cards never clip it. */
export function EscrowHelp({ days, className }: { days: number; className?: string }) {
  const t = useTranslations("products.escrowHelp");
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const place = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
    setPos({ top: r.bottom + 8, left, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const close = () => { setHover(false); setPinned(false); };
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  const steps = [t("step1"), t("step2", { days }), t("step3", { days })];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("aria", { days })}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPinned((p) => !p); }}
        className={cn(
          "inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-current/40 text-[10px] font-bold leading-none opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
          className,
        )}
      >
        ?
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          id={id}
          role="tooltip"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
          className="z-[70] rounded-xl border border-line bg-surface p-3.5 text-left shadow-card-lg"
        >
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
            <Shield size={13} className="text-good" /> {t("title", { days })}
          </div>
          <ol className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted">
            {steps.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[3px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-[10px] font-bold text-fg">{i + 1}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 border-t border-line pt-2 text-[11.5px] text-faint">
            {t("note")} <Link href="/legal/escrow" className="text-iris hover:underline">{t("policyLink")}</Link>
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Product-page badge: "Ký quỹ N ngày" with the "?" explainer attached. */
export function EscrowBadge({ days, label, className }: { days: number; label: string; className?: string }) {
  return (
    <Tag tone="neutral" className={cn("gap-1.5", className)}>
      <Shield size={11} /> {label}
      <EscrowHelp days={days} />
    </Tag>
  );
}
