"use client";

/** A shop's trust score for buyers: the number, a word for it, and on demand
 *  the coarse dispute and 1-star bands behind it. Nothing for a shop without
 *  enough orders to score. */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { SellerProfile } from "@/lib/types";
import { ShieldCheck } from "@/components/Icons";

type Trust = Pick<SellerProfile, "trust_score" | "dispute_band" | "one_star_band">;

function band(score: number): "excellent" | "good" | "fair" | "low" {
  return score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "low";
}

const BAND_TONE: Record<string, string> = { low: "text-good", medium: "text-warn", high: "text-bad" };
const PANEL_WIDTH = 260;
const GUTTER = 16;

/** Fixed position under the chip, kept inside the viewport: the chip sits in
 *  cards that clip overflow, and on a phone it is often near the right edge. */
function panelPosition(chip: DOMRect): { top: number; left: number; width: number } {
  const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * GUTTER);
  const left = Math.max(GUTTER, Math.min(chip.left, window.innerWidth - GUTTER - width));
  return { top: chip.bottom + 8, left, width };
}

export function TrustBadge({ seller, compact = false }: { seller: Trust; compact?: boolean }) {
  const t = useTranslations("sellers.trust");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => chip.current && setPosition(panelPosition(chip.current.getBoundingClientRect()));
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const score = seller.trust_score;
  if (score == null) return null;
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-muted">
        <ShieldCheck size={12} className="text-iris-hi" /> {t("compact", { score, band: t(`bands.${band(score)}`) })}
      </span>
    );
  }
  return (
    <span ref={root} className="relative inline-flex">
      <button
        ref={chip}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-good/30 bg-good-soft px-2 py-0.5 text-[11px] font-medium text-good hover:border-good/60"
      >
        <ShieldCheck size={11} /> {t("chip", { score })}
      </button>
      {open && position && (
        <span
          id={panelId}
          role="dialog"
          aria-label={t("title")}
          style={{ top: position.top, left: position.left, width: position.width }}
          className="fixed z-30 block rounded-card border border-line bg-surface p-4 text-left shadow-card-lg"
        >
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-[24px] font-semibold tabular leading-none">{score}</span>
            <span className="text-[12px] text-muted">{t("outOf", { band: t(`bands.${band(score)}`) })}</span>
          </span>
          <span className="mt-1 block text-[11.5px] text-faint">{t("scope")}</span>
          <span className="mt-3 block space-y-1.5 border-t border-line pt-3 text-[12.5px]">
            {(["dispute_band", "one_star_band"] as const).map((key) => seller[key] && (
              <span key={key} className="flex justify-between gap-3">
                <span className="text-muted">{t(key)}</span>
                <span className={cn("font-medium", BAND_TONE[seller[key]!])}>{t(`rate.${seller[key]}`)}</span>
              </span>
            ))}
          </span>
          <span className="mt-3 block text-[11.5px] leading-relaxed text-muted">{t("escrowNote")}</span>
          <Link href="/support#safety" className="mt-2 inline-block text-[12px] font-medium text-iris-hi hover:underline">{t("learnMore")}</Link>
        </span>
      )}
    </span>
  );
}
