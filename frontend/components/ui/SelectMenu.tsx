"use client";

/** A single-choice dropdown drawn with the design tokens instead of the
 *  browser's native `<select>` popup: a trigger button and a floating listbox
 *  that opens with a short fade/scale, follows the WAI-ARIA listbox pattern
 *  (↑ ↓ Home End, type-ahead, Enter/Space picks, Esc and Tab close, focus
 *  returns to the trigger) and stays inside the viewport (portal + fixed
 *  position, flips up when there is no room below). */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { Check, ChevronDown } from "@/components/Icons";

export interface SelectMenuOption<V extends string> {
  value: V;
  label: string;
  /** Second line under the label (optional). */
  hint?: string;
}

const GAP = 6;
const EDGE = 8;
const MAX_HEIGHT = 320;

export function SelectMenu<V extends string>({
  value, options, onChange, label, prefix, icon, align = "start", className, menuClassName, active,
}: {
  value: V;
  options: readonly SelectMenuOption<V>[];
  onChange: (value: V) => void;
  /** Accessible name of the control (also the listbox label). */
  label: string;
  /** Visible text before the value ("Sắp xếp"). */
  prefix?: ReactNode;
  /** Leading icon inside the trigger. */
  icon?: ReactNode;
  align?: "start" | "end";
  className?: string;
  menuClassName?: string;
  /** Highlights the trigger as an applied filter. */
  active?: boolean;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number; maxHeight: number; up: boolean } | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selectedIndex];

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const up = below < Math.min(MAX_HEIGHT, 200) && above > below;
    const maxHeight = Math.min(MAX_HEIGHT, up ? above : below);
    const minWidth = Math.max(r.width, 180);
    const rawLeft = align === "end" ? r.right - minWidth : r.left;
    const left = Math.min(Math.max(EDGE, rawLeft), window.innerWidth - minWidth - EDGE);
    setPos({ top: up ? r.top - GAP : r.bottom + GAP, left, minWidth, maxHeight, up });
  }, [align]);

  const openMenu = (index = selectedIndex) => {
    place();
    setHighlight(index);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const pick = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Keep the highlighted row in view while moving with the keyboard.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-opt-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, id]);

  // Follow the trigger on scroll/resize; close on a press outside.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, place]);

  const typeAhead = (key: string) => {
    const now = Date.now();
    typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + key.toLowerCase(), at: now };
    const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
    const needle = fold(typed.current.text);
    const start = typed.current.text.length === 1 ? highlight + 1 : highlight;
    for (let i = 0; i < options.length; i += 1) {
      const index = (start + i) % options.length;
      if (fold(options[index].label).startsWith(needle)) return index;
    }
    return null;
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openMenu(e.key === "ArrowUp" ? Math.max(0, selectedIndex - 1) : selectedIndex);
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setHighlight((h) => Math.min(last, h + 1)); return;
      case "ArrowUp": e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); return;
      case "Home": e.preventDefault(); setHighlight(0); return;
      case "End": e.preventDefault(); setHighlight(last); return;
      case "Enter": case " ": e.preventDefault(); pick(highlight); return;
      case "Escape": e.preventDefault(); close(); return;
      case "Tab": setOpen(false); return;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const hit = typeAhead(e.key);
          if (hit !== null) setHighlight(hit);
        }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${current?.label ?? ""}`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
        className={cn(
          "group inline-flex h-10 min-w-0 items-center gap-2 rounded-lg border bg-surface pl-3 pr-2.5 text-[13px] text-fg",
          "transition-[border-color,background-color,box-shadow] duration-150 cursor-pointer select-none",
          "hover:border-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30 focus-visible:border-iris",
          open ? "border-iris ring-2 ring-iris/15" : active ? "border-iris/50 bg-iris-soft/60" : "border-line",
          className,
        )}
      >
        {icon && <span className="shrink-0 text-faint" aria-hidden="true">{icon}</span>}
        {prefix && <span className="shrink-0 text-muted">{prefix}</span>}
        <span className="min-w-0 flex-1 truncate text-left font-medium">{current?.label}</span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={cn("shrink-0 text-faint transition-transform duration-200 ease-out group-hover:text-fg", open && "rotate-180 text-fg")}
        />
      </button>
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.ul
              ref={listRef}
              id={`${id}-list`}
              role="listbox"
              tabIndex={-1}
              aria-label={label}
              aria-activedescendant={`${id}-opt-${highlight}`}
              onKeyDown={onListKey}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: pos.up ? 4 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: pos.up ? 2 : -2 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
              style={{
                position: "fixed", left: pos.left, minWidth: pos.minWidth, maxHeight: pos.maxHeight,
                top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined,
                transformOrigin: pos.up ? "bottom" : "top",
              }}
              className={cn(
                "z-[70] overflow-y-auto overscroll-contain rounded-card border border-line bg-surface p-1 shadow-card-lg outline-none",
                menuClassName,
              )}
            >
              {options.map((option, index) => {
                const selected = index === selectedIndex;
                const highlighted = index === highlight;
                return (
                  <li
                    key={option.value}
                    id={`${id}-opt-${index}`}
                    role="option"
                    aria-selected={selected}
                    onPointerMove={() => highlight !== index && setHighlight(index)}
                    onClick={() => pick(index)}
                    className={cn(
                      "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-100",
                      highlighted ? "bg-raised text-fg" : "text-fg",
                      selected && "font-semibold text-iris-hi",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.hint && <span className="block text-[12px] font-normal text-muted">{option.hint}</span>}
                    </span>
                    <Check size={14} aria-hidden="true" className={cn("shrink-0 text-iris transition-opacity", selected ? "opacity-100" : "opacity-0")} />
                  </li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
