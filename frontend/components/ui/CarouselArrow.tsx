"use client";

/** The ‹ › buttons of a horizontal row driven by `useCarousel`. */

import { cn } from "@/lib/cn";
import { ChevronLeft, ChevronRight } from "@/components/Icons";

export function CarouselArrow({ direction, disabled, onClick, label }: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-fg shadow-xs sm:h-8 sm:w-8",
        "transition-[transform,background-color,border-color,opacity] duration-150 ease-out cursor-pointer",
        "hover:border-line-2 hover:bg-raised active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
        "disabled:cursor-default disabled:opacity-35 disabled:shadow-none disabled:hover:bg-surface disabled:active:scale-100",
      )}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}
