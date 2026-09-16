"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { MarkdownHeading } from "@/lib/heading-slug";
import type { SitePageLink } from "@/lib/types";

/* Cột trái trang chính sách: danh sách trang + mục lục của trang đang xem.
   Scroll-spy bằng IntersectionObserver — mục đang đọc được tô iris. */
export function LegalSidebar({
  pages, current, headings, labels,
}: {
  pages: SitePageLink[];
  current: string;
  headings: MarkdownHeading[];
  labels: { pages: string; onThisPage: string };
}) {
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    if (!headings.length) return;
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;
    // Mục "đang đọc" = heading cuối cùng nằm trên vạch 1/4 màn hình. Dùng
    // scroll listener (gộp theo rAF) thay vì IntersectionObserver vì
    // observer không bắn lại khi trình duyệt tự nhảy tới #hash sau hydrate.
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.25;
      let currentId = els[0].id;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= line) currentId = el.id;
        else break;
      }
      setActive(currentId);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    // Vào thẳng bằng #hash: trình duyệt nhảy tới anchor sau khi hydrate xong,
    // không kèm scroll event → tính lại một nhịp sau khi load.
    const settle = window.setTimeout(update, 250);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", onScroll);
    window.addEventListener("load", onScroll);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("hashchange", onScroll);
      window.removeEventListener("load", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [headings]);

  return (
    <nav className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto space-y-6 text-[13px]" aria-label={labels.onThisPage}>
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{labels.pages}</div>
        <ul className="space-y-0.5">
          {pages.map((p) => {
            const isCurrent = p.slug === current;
            return (
              <li key={p.slug}>
                <Link
                  href={`/legal/${p.slug}`}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-2.5 py-1.5 transition-colors",
                    isCurrent ? "bg-iris-soft font-medium text-iris-hi" : "text-muted hover:bg-raised hover:text-fg",
                  )}
                >
                  {p.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {headings.length > 0 && (
        <div className="hidden lg:block">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{labels.onThisPage}</div>
          <ul className="border-l border-line">
            {headings.map((h) => {
              const isActive = h.id === active;
              return (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className={cn(
                      "-ml-px block border-l-2 py-1 pr-2 leading-snug transition-colors",
                      h.level === 3 ? "pl-6 text-[12px]" : "pl-3",
                      isActive ? "border-iris text-iris-hi font-medium" : "border-transparent text-muted hover:text-fg",
                    )}
                  >
                    {h.text}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </nav>
  );
}
