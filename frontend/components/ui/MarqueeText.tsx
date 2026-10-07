"use client";

/** One line of text that may not fit. It stays on one line; while its row is
 *  hovered or focused (the nearest `.group` ancestor), a cut-off text glides
 *  left to show its end and back when the pointer leaves — speed follows how
 *  much is hidden. Text that fits never moves. Touch screens and reduced
 *  motion wrap instead (two lines, or the whole text with `touchLines="all"`),
 *  since there is nothing to hover. */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// Slow enough to read while it moves (about four Vietnamese words a second).
const PX_PER_SECOND = 40;

export function MarqueeText({ text, className, touchLines = 2 }: {
  text: string;
  className?: string;
  /** Lines shown where there is no hover (touch, reduced motion): 2, or "all" to wrap in full. */
  touchLines?: 2 | "all";
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner) return;
    const measure = () => setShift(Math.max(0, Math.ceil(inner.scrollWidth - box.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text]);

  const seconds = Math.min(12, Math.max(1.2, shift / PX_PER_SECOND));
  return (
    <span
      ref={boxRef}
      className={cn(
        "relative block overflow-hidden whitespace-nowrap",
        // Nothing to hover on touch screens; reduced motion: no glide either.
        touchLines === 2
          ? "[@media(hover:none)]:line-clamp-2 [@media(hover:none)]:whitespace-normal motion-reduce:line-clamp-2 motion-reduce:whitespace-normal"
          : "[@media(hover:none)]:whitespace-normal motion-reduce:whitespace-normal",
        shift > 0 && "[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] group-hover:[mask-image:none] group-focus-visible:[mask-image:none]",
        className,
      )}
    >
      <span
        ref={textRef}
        style={{ "--marquee-shift": `-${shift}px`, "--marquee-time": `${seconds}s` } as React.CSSProperties}
        className={cn(
          "inline-block transition-transform ease-in-out [transition-duration:var(--marquee-time)] [transition-delay:400ms]",
          // Clamped mode: wrap as plain text so line-clamp can count its lines.
          "[@media(hover:none)]:inline motion-reduce:inline",
          shift > 0 && "[@media(hover:hover)]:group-hover:[transform:translateX(var(--marquee-shift))] [@media(hover:hover)]:group-focus-visible:[transform:translateX(var(--marquee-shift))]",
          "motion-reduce:!transform-none motion-reduce:transition-none",
        )}
      >
        {text}
      </span>
    </span>
  );
}
