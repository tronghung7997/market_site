"use client";

/** The top-of-page navigation bar. The router itself starts it
 *  (`onRouterTransitionStart` in instrumentation-client.ts), so <Link>,
 *  router.push/replace and back/forward all count, while new-tab clicks,
 *  same-page and hash links never start it. It appears only after a short
 *  delay, so prefetched pages that open at once never flash; while waiting it
 *  keeps creeping with a moving glint (never a frozen bar), and it finishes
 *  when the rendered URL actually changes. A navigation that never commits
 *  fades out after a cap instead of hanging on screen. */

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { onNavigationStart, routeKey, trickle, type NavStart } from "@/lib/nav-progress";

const SHOW_AFTER_MS = 120;
const GIVE_UP_MS = 15_000;
const FILL_MS = 200;
const FADE_MS = 250;

type Run = { from: string; startedAt: number; shown: boolean };

export default function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = `${pathname}${search ? `?${search}` : ""}`;

  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const committed = useRef(here);
  const run = useRef<Run | null>(null);
  const frame = useRef(0);
  const timers = useRef<number[]>([]);
  const finishRef = useRef<(filled: boolean) => void>(() => {});

  useEffect(() => {
    const bar = barRef.current;
    const fill = fillRef.current;
    if (!bar || !fill) return;
    const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
    const clearAll = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      cancelAnimationFrame(frame.current);
    };
    const setFill = (scale: number, ms = 0) => {
      fill.style.transition = ms ? `transform ${ms}ms ease-out` : "none";
      fill.style.transform = `scaleX(${scale})`;
    };
    const setVisible = (on: boolean) => {
      bar.style.transition = on ? "none" : `opacity ${FADE_MS}ms ease-out`;
      bar.style.opacity = on ? "1" : "0";
    };

    const creep = () => {
      const r = run.current;
      if (!r) return;
      setFill(trickle(performance.now() - r.startedAt));
      frame.current = requestAnimationFrame(creep);
    };

    const finish = (filled: boolean) => {
      const r = run.current;
      if (!r) return;
      run.current = null;
      clearAll();
      if (!r.shown) return;
      if (filled) setFill(1, FILL_MS);
      later(() => setVisible(false), filled ? FILL_MS : 0);
      later(() => setFill(0), (filled ? FILL_MS : 0) + FADE_MS);
    };
    finishRef.current = finish;

    const start = (nav: NavStart) => {
      const from = routeKey(committed.current, window.location.href);
      const to = routeKey(nav.url, window.location.href);
      if (from === null || to === null || to === from) return;
      if (!run.current) {
        clearAll();
        setFill(0);
        run.current = { from, startedAt: performance.now(), shown: false };
        later(() => {
          if (!run.current) return;
          run.current.shown = true;
          setVisible(true);
          creep();
        }, SHOW_AFTER_MS);
      }
      // A newer navigation while one is pending keeps the bar where it is.
      later(() => finishRef.current(false), GIVE_UP_MS);
    };

    const stop = onNavigationStart(start);
    return () => { stop(); clearAll(); run.current = null; };
  }, []);

  useEffect(() => {
    committed.current = here;
    const r = run.current;
    if (r && routeKey(here, window.location.href) !== r.from) finishRef.current(true);
  }, [here]);

  return (
    <div
      ref={barRef}
      aria-hidden="true"
      style={{ opacity: 0 }}
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]"
    >
      <div
        ref={fillRef}
        style={{ transform: "scaleX(0)" }}
        className="relative h-full origin-left overflow-hidden rounded-r-full bg-iris shadow-[0_0_8px_var(--color-iris)]"
      >
        <span className="animate-shimmer absolute inset-0" />
      </div>
    </div>
  );
}
