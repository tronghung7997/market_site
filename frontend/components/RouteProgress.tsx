"use client";

/** The top-of-page navigation bar. The router itself starts it
 *  (`onRouterTransitionStart` in instrumentation-client.ts), so <Link>,
 *  router.push/replace and back/forward all count, while new-tab clicks,
 *  same-page and hash links never start it. It appears only after a short
 *  delay, so prefetched pages that open at once never flash; while waiting it
 *  keeps creeping with a moving glint (never a frozen bar), and it finishes
 *  when the rendered URL actually changes.
 *
 *  A soft navigation that does not commit within `STALL_MS` (or whose link
 *  is clicked again while it hangs) becomes a full page load: a stuck RSC
 *  request otherwise left the visitor on the old page with every retry of
 *  that link queued behind it until a hard reload. Each recovery is reported
 *  to the log stream (`client_nav_stall`). If the page load is cancelled, the
 *  bar still fades out after a cap instead of hanging on screen. */

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { sendClientEvent, type NavStallReason } from "@/lib/client-events";
import {
  STALL_MS,
  isRepeatedWait,
  onNavigationStart,
  routeKey,
  rscRequestOutcome,
  trickle,
  type NavStart,
  type NavType,
} from "@/lib/nav-progress";

const SHOW_AFTER_MS = 120;
const GIVE_UP_MS = 15_000;
const FILL_MS = 200;
const FADE_MS = 250;

type Run = {
  from: string;
  /** Latest target: a newer navigation while one is pending replaces it. */
  to: string;
  url: string;
  type: NavType;
  startedAt: number;
  shown: boolean;
};

function pathOf(key: string): string {
  return key.split("?", 1)[0];
}

/** Hand the navigation to the browser. Keeps the history semantics: a push
 *  adds an entry; replace and back/forward (URL already moved) replace it. */
function hardNavigate(url: string, type: NavType) {
  if (type === "push") window.location.assign(url);
  else window.location.replace(url);
}

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
  const stallTimer = useRef(0);
  const finishRef = useRef<(filled: boolean) => void>(() => {});

  useEffect(() => {
    const bar = barRef.current;
    const fill = fillRef.current;
    if (!bar || !fill) return;
    const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
    const clearAll = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      clearTimeout(stallTimer.current);
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

    const recover = (reason: NavStallReason) => {
      const r = run.current;
      if (!r) return;
      clearTimeout(stallTimer.current);
      const now = performance.now();
      const rsc = rscRequestOutcome(
        performance.getEntriesByType("resource") as PerformanceResourceTiming[],
        pathOf(r.to),
        r.startedAt,
        window.location.href,
      );
      const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
      sendClientEvent({
        kind: "nav_stall",
        reason,
        nav_type: r.type,
        from_path: pathOf(r.from),
        to_path: pathOf(r.to),
        elapsed_ms: now - r.startedAt,
        rsc_state: rsc.state,
        ...(rsc.state === "done" ? { rsc_status: rsc.status, rsc_ms: rsc.ms } : {}),
        page_age_ms: now,
        visible: document.visibilityState === "visible",
        online: navigator.onLine,
        net: connection?.effectiveType,
      });
      hardNavigate(r.url, r.type);
    };

    const start = (nav: NavStart) => {
      const from = routeKey(committed.current, window.location.href);
      const to = routeKey(nav.url, window.location.href);
      if (from === null || to === null || to === from) return;
      const now = performance.now();
      if (isRepeatedWait(run.current, { to, type: nav.type }, now)) {
        recover("retry");
        return;
      }
      if (!run.current) {
        clearAll();
        setFill(0);
        run.current = { from, to, url: nav.url, type: nav.type, startedAt: now, shown: false };
        later(() => {
          if (!run.current) return;
          run.current.shown = true;
          setVisible(true);
          creep();
        }, SHOW_AFTER_MS);
      } else {
        // A newer navigation while one is pending keeps the bar where it is
        // and becomes the one to recover.
        Object.assign(run.current, { to, url: nav.url, type: nav.type });
      }
      clearTimeout(stallTimer.current);
      stallTimer.current = window.setTimeout(() => recover("timeout"), STALL_MS);
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
