"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** A horizontal scroll row driven like a carousel:
 *  - `prev` / `next` glide one view-width, landing on an item edge;
 *  - a mouse can drag it, with momentum after release, then it settles on the
 *    nearest item (touch and trackpads keep their native scrolling);
 *  - `canPrev` / `canNext` say whether there is more on either side;
 *  - a drag never turns into a click on the item under the pointer.
 *  Items are the row's direct children. Reduced motion jumps instead of gliding. */
export function useCarousel<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  canPrev: boolean;
  canNext: boolean;
  dragging: boolean;
  prev: () => void;
  next: () => void;
} {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState({ canPrev: false, canNext: false });
  const [dragging, setDragging] = useState(false);
  const frame = useRef<number | null>(null);

  const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const canPrev = el.scrollLeft > 2;
    const canNext = el.scrollLeft < max - 2;
    setEdges((prev) => (prev.canPrev === canPrev && prev.canNext === canNext ? prev : { canPrev, canNext }));
  }, []);

  /** Item start offsets, relative to the row's scroll origin. */
  const stops = useCallback(() => {
    const el = ref.current;
    if (!el) return [0];
    const padding = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
    const base = el.getBoundingClientRect().left - el.scrollLeft + padding;
    const max = el.scrollWidth - el.clientWidth;
    return [...el.children].map((child) => Math.min(max, Math.max(0, (child as HTMLElement).getBoundingClientRect().left - base)));
  }, []);

  /** Ease to `left` with our own frames: the browser's smooth scroll fights
   *  scroll-snap (it pauses, then jumps), so snapping is off while gliding. */
  const glideTo = useCallback((left: number, duration = 420) => {
    const el = ref.current;
    if (!el) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const max = el.scrollWidth - el.clientWidth;
    const to = Math.min(max, Math.max(0, left));
    const from = el.scrollLeft;
    const restore = () => { el.style.scrollSnapType = ""; el.style.scrollBehavior = ""; frame.current = null; };
    if (reduced() || Math.abs(to - from) < 1) { el.scrollLeft = to; restore(); return; }
    el.style.scrollSnapType = "none";
    el.style.scrollBehavior = "auto";
    const start = performance.now();
    const time = Math.min(duration, 160 + Math.abs(to - from) * 0.45);
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / time);
      el.scrollLeft = from + (to - from) * ease(progress);
      if (progress < 1) frame.current = requestAnimationFrame(step);
      else restore();
    };
    frame.current = requestAnimationFrame(step);
  }, []);

  const nearestStop = useCallback((target: number) => {
    const points = stops();
    return points.reduce((best, p) => (Math.abs(p - target) < Math.abs(best - target) ? p : best), points[0] ?? 0);
  }, [stops]);

  const page = useCallback((direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const target = el.scrollLeft + direction * el.clientWidth * 0.85;
    const points = stops();
    // The first item edge past the target in the travel direction, so a card is never cut on the leading side.
    const landing = direction > 0
      ? points.filter((p) => p > el.scrollLeft + 4 && p <= target + 4).pop() ?? points.find((p) => p > el.scrollLeft + 4)
      : points.find((p) => p >= target - 4 && p < el.scrollLeft - 4) ?? [...points].reverse().find((p) => p < el.scrollLeft - 4);
    glideTo(landing ?? (direction > 0 ? el.scrollWidth : 0));
  }, [glideTo, stops]);

  // Re-run after every render: the items (and so the row's width) change with the data.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const onScroll = () => measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    [...el.children].forEach((child) => observer.observe(child));
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  });

  // Mouse drag with momentum. Touch / pen keep native panning.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startLeft = 0;
    let moved = false;
    let down = false;
    let samples: { x: number; t: number }[] = [];

    const stopMomentum = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      stopMomentum();
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      samples = [{ x: e.clientX, t: e.timeStamp }];
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < 5) return;
      if (!moved) {
        moved = true;
        setDragging(true);
        try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        el.style.scrollSnapType = "none";
        el.style.scrollBehavior = "auto";
      }
      el.scrollLeft = startLeft - dx;
      samples.push({ x: e.clientX, t: e.timeStamp });
      if (samples.length > 6) samples.shift();
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      if (!moved) return;
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      setDragging(false);
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = Math.max(1, last.t - first.t);
      // px per ms, scroll direction (a drag to the left scrolls right).
      let velocity = e.timeStamp - last.t > 80 ? 0 : -(last.x - first.x) / dt;
      const settle = () => glideTo(nearestStop(el.scrollLeft), 280);
      if (reduced() || Math.abs(velocity) < 0.05) { settle(); return; }
      let previous = performance.now();
      const step = (now: number) => {
        const elapsed = now - previous;
        previous = now;
        el.scrollLeft += velocity * elapsed;
        velocity *= Math.pow(0.94, elapsed / 16);
        const atEdge = el.scrollLeft <= 0 || el.scrollLeft >= el.scrollWidth - el.clientWidth;
        if (Math.abs(velocity) < 0.08 || atEdge) { frame.current = null; settle(); return; }
        frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    };
    // A drag ends with a click on whatever is under the pointer: swallow it.
    const onClick = (e: MouseEvent) => {
      if (!moved) return;
      e.preventDefault();
      e.stopPropagation();
      moved = false;
    };
    const onDragStart = (e: DragEvent) => e.preventDefault();

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("click", onClick, true);
    el.addEventListener("dragstart", onDragStart);
    return () => {
      stopMomentum();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("dragstart", onDragStart);
    };
  }, [glideTo, nearestStop]);

  return {
    ref,
    canPrev: edges.canPrev,
    canNext: edges.canNext,
    dragging,
    prev: () => page(-1),
    next: () => page(1),
  };
}

/** Mask for the row: an edge fades while more is hidden on that side. */
export function carouselFade(canPrev: boolean, canNext: boolean): string {
  return `linear-gradient(to right, ${canPrev ? "transparent 0, #000 40px" : "#000 0"}, ${canNext ? "#000 calc(100% - 40px), transparent 100%" : "#000 100%"})`;
}
