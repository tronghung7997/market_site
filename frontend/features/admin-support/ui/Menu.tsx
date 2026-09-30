"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/** A small anchored menu (button + role="menu" list): closes on outside
 *  click, Escape (focus returns to the trigger) and after a pick. Arrow keys
 *  move between items. */
export function Menu({ label, trigger, triggerClassName, align = "end", children }: {
  label: string;
  trigger: React.ReactNode;
  triggerClassName?: string;
  align?: "start" | "end";
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("mousedown", onDown);
    list.current?.querySelector<HTMLElement>("[role='menuitem']:not([disabled])")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([disabled])") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          className={cn(
            "absolute top-full z-30 mt-1 max-h-72 min-w-48 overflow-y-auto rounded-lg border border-line bg-card p-1 shadow-card",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children(() => close())}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onSelect, tone, disabled, children }: {
  onSelect: () => void;
  tone?: "bad";
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] focus-visible:outline-none focus-visible:bg-raised hover:bg-raised disabled:opacity-40",
        tone === "bad" ? "text-bad" : "text-fg",
      )}
    >
      {children}
    </button>
  );
}
