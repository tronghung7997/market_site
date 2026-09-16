"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Search } from "@/components/Icons";
import { useSearchPalette } from "./SearchProvider";

function useShortcutLabel(): string {
  // Rendered after mount so server and client markup agree.
  const [label, setLabel] = useState("⌘K");
  useEffect(() => {
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
    setLabel(mac ? "⌘K" : "Ctrl K");
  }, []);
  return label;
}

/**
 * Header trigger for the command palette: a search-field-shaped button on
 * desktop (the field itself is the dialog, so focus and typing never fight
 * with page scroll) and an icon button on narrow screens.
 */
export function HeaderSearch({ className }: { className?: string }) {
  const t = useTranslations("search");
  const { open } = useSearchPalette();
  const shortcut = useShortcutLabel();

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={t("openSearch")}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "hidden md:flex h-10 w-full max-w-md min-w-0 items-center gap-2.5 rounded-lg border border-line bg-raised/70 px-3 text-left text-[13px] text-faint",
          "transition-colors duration-150 hover:border-line-2 hover:bg-surface hover:text-muted",
          className,
        )}
      >
        <Search size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("headerPlaceholder")}</span>
        <kbd className="hidden lg:inline-flex h-5 items-center rounded border border-line bg-surface px-1.5 font-mono text-[10.5px] font-medium text-faint">
          {shortcut}
        </kbd>
      </button>
      <button
        type="button"
        onClick={open}
        aria-label={t("openSearch")}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg md:hidden"
      >
        <Search size={18} />
      </button>
    </>
  );
}
