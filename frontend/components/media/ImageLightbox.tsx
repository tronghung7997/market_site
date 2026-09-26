"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, X } from "@/components/Icons";
import { MediaImage, type ImageSource } from "./MediaImage";

/** Full-size viewer for a set of images: ←/→ to browse, Esc to close. */
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  title,
}: {
  images: ImageSource[];
  /** Open when not null. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  title: string;
}) {
  const t = useTranslations("media");
  const open = index !== null && images.length > 0;
  const current = open ? Math.min(index, images.length - 1) : 0;
  const many = images.length > 1;
  const go = (delta: number) => onIndexChange((current + delta + images.length) % images.length);

  useEffect(() => {
    if (!open || !many) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") onIndexChange((current - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") onIndexChange((current + 1) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, many, current, images.length, onIndexChange]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        overlayClassName="bg-ink-panel/95"
        className="left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 border-0 bg-transparent p-0 shadow-none [&>button:last-child]:hidden data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 data-[state=open]:slide-in-from-top-[0%] data-[state=closed]:slide-out-to-top-[0%] data-[state=open]:slide-in-from-left-[0%] data-[state=closed]:slide-out-to-left-[0%]"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
          <span className="font-mono text-[13px] text-white/80">
            {many ? t("counter", { current: current + 1, total: images.length }) : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-white/90 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X size={20} />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16">
          {open && (
            <MediaImage
              key={current}
              image={images[current]}
              variant="full"
              fit="contain"
              eager
              alt={t("imageOf", { current: current + 1, total: images.length })}
              className="max-h-full max-w-full rounded-lg"
            />
          )}
          {many && (
            <>
              <NavButton side="left" label={t("previous")} onClick={() => go(-1)}><ChevronLeft size={22} /></NavButton>
              <NavButton side="right" label={t("next")} onClick={() => go(1)}><ChevronRight size={22} /></NavButton>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NavButton({ side, label, onClick, children }: { side: "left" | "right"; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${side === "left" ? "left-2 sm:left-4" : "right-2 sm:right-4"}`}
    >
      {children}
    </button>
  );
}
