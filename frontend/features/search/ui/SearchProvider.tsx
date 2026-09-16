"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";
import { CommandPalette } from "./CommandPalette";

type SearchPaletteContext = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const Context = createContext<SearchPaletteContext | null>(null);

/**
 * Mounts the command palette once and exposes `open()` to any trigger.
 * ⌘K / Ctrl+K toggles it from anywhere on the page, including inside other
 * inputs (Linear behavior); Escape is handled by the dialog itself.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const pathname = usePathname();

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A navigation started elsewhere (back/forward) closes a stale palette.
  useEffect(() => { setOpen(false); }, [pathname]);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <Context.Provider value={value}>
      {children}
      <CommandPalette open={isOpen} onOpenChange={setOpen} />
    </Context.Provider>
  );
}

export function useSearchPalette(): SearchPaletteContext {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useSearchPalette must be used inside <SearchProvider>");
  return ctx;
}
