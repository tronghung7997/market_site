"use client";

import { useEffect, useRef } from "react";

/** Calls `onNear` when the returned sentinel comes within `margin` px of the
 *  viewport, so the next page loads before the buyer reaches the end. A new
 *  `resetKey` (the row count) re-checks at once: when a short page leaves the
 *  sentinel still in range, the following page loads without another scroll. */
export function useNearEnd<T extends HTMLElement>(onNear: () => void, enabled: boolean, resetKey: unknown, margin = 1200) {
  const ref = useRef<T | null>(null);
  const callback = useRef(onNear);
  callback.current = onNear;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) callback.current(); },
      { rootMargin: `0px 0px ${margin}px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, margin, resetKey]);
  return ref;
}
