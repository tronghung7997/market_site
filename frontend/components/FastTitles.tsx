"use client";

import { useEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 120;

/** Native `title` tooltips wait ~1s and can't be styled. This layer shows any
 *  element's `title` after a short delay instead: the attribute is lifted off
 *  while hovered (so the browser's own tooltip never appears) and put back on
 *  leave, keeping it for assistive tech and no-JS. */
export function FastTitles() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const active = useRef<{ el: Element; text: string; timer: number } | null>(null);

  useEffect(() => {
    const restore = () => {
      const cur = active.current;
      if (!cur) return;
      window.clearTimeout(cur.timer);
      if (cur.el.isConnected && !cur.el.hasAttribute("title")) cur.el.setAttribute("title", cur.text);
      active.current = null;
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element | null)?.closest?.("[title]");
      if (!el || el === active.current?.el) return;
      const text = el.getAttribute("title")?.trim();
      restore();
      if (!text) return;
      el.removeAttribute("title");
      const timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const below = r.top < 48;
        setTip({ text, x: Math.min(Math.max(r.left + r.width / 2, 16), window.innerWidth - 16), y: below ? r.bottom + 6 : r.top - 6, below });
      }, SHOW_DELAY_MS);
      active.current = { el, text, timer };
    };
    const onOut = (e: PointerEvent) => {
      const cur = active.current;
      if (cur && !(e.relatedTarget instanceof Node && cur.el.contains(e.relatedTarget))) restore();
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    window.addEventListener("scroll", restore, true);
    document.addEventListener("pointerdown", restore, true);
    return () => {
      restore();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      window.removeEventListener("scroll", restore, true);
      document.removeEventListener("pointerdown", restore, true);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="tooltip"
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
      className="pointer-events-none fixed z-[200] max-w-[min(360px,calc(100vw-2rem))] whitespace-pre-line break-words rounded-md bg-slate-900 px-2.5 py-1.5 text-[11.5px] leading-snug text-white shadow-lg animate-in fade-in-0 duration-100"
    >
      {tip.text}
    </div>
  );
}
