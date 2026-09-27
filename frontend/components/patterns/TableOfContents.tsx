"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { MarkdownHeading } from "@/lib/heading-slug";

/* Mục lục của một trang markdown (bài blog, trang chính sách): danh sách ##/###
   và scroll-spy — mục đang đọc được tô iris. `headings` lấy từ extractHeadings()
   nên id khớp với id MarkdownContent gắn lên heading. `labelHidden` khi nơi
   chứa đã có tiêu đề riêng (ô "Mục lục" mở/đóng trên mobile). */
export function TableOfContents({ headings, label, labelHidden, className }: {
  headings: MarkdownHeading[];
  label: string;
  labelHidden?: boolean;
  className?: string;
}) {
  const active = useActiveHeading(headings);
  if (headings.length === 0) return null;

  return (
    <nav aria-label={label} className={cn("text-[13px]", className)}>
      {!labelHidden && <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</div>}
      <ul className="border-l border-line">
        {headings.map((h) => {
          const isActive = h.id === active;
          return (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "-ml-px block border-l-2 py-1 pr-2 leading-snug transition-colors",
                  h.level === 3 ? "pl-6 text-[12px]" : "pl-3",
                  isActive ? "border-iris font-medium text-iris-hi" : "border-transparent text-muted hover:text-fg",
                )}
              >
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* Mục "đang đọc" = heading cuối cùng nằm trên vạch 1/4 màn hình. Dùng scroll
   listener (gộp theo rAF) thay vì IntersectionObserver vì observer không bắn
   lại khi trình duyệt tự nhảy tới #hash sau hydrate. */
function useActiveHeading(headings: MarkdownHeading[]): string | null {
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    if (!headings.length) return;
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;
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

  return active;
}
