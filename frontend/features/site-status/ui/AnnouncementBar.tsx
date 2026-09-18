"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AlertCircle, AlertTriangle, Info, X } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { useSiteStatus } from "../data";

const TONES = {
  info: { bar: "bg-iris", Icon: Info },
  warn: { bar: "bg-warn", Icon: AlertTriangle },
  danger: { bar: "bg-bad", Icon: AlertCircle },
} as const;

/** Marquee speed; slow enough to read, fast enough not to bore. */
const PX_PER_SECOND = 55;

/**
 * Closed-for-this-page-load only: a visitor can get the bar out of the way
 * while they browse, but the next full load shows it again (module state
 * survives client-side navigation and dies with the tab's reload).
 */
let dismissedVersion: number | null = null;

/**
 * Admin-authored notice across the top of the storefront. Solid colour and it
 * scrolls with the nav; text that does not fit on one line glides across
 * like a ticker instead of being cut off.
 */
export function AnnouncementBar() {
  const t = useTranslations("siteStatus");
  const locale = useLocale();
  const { data } = useSiteStatus();
  const ann = data?.announcement ?? null;
  const [, rerender] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  // Invisible nowrap twin of the text: measuring the visible span is unreliable once it is clipped or animating.
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState<{ width: number; seconds: number } | null>(null);

  const text = ann ? ((locale === "vi" ? ann.text_vi : ann.text_en) || ann.text_vi || ann.text_en) : "";
  const visible = Boolean(ann && text) && dismissedVersion !== ann?.version;

  // Measure whether the text fits; re-measure when the text or the viewport changes.
  useLayoutEffect(() => {
    if (!visible) return;
    const track = trackRef.current;
    const span = measureRef.current;
    if (!track || !span) return;
    const measure = () => {
      const width = span.offsetWidth;
      const fits = width <= track.clientWidth;
      setOverflow(fits ? null : { width, seconds: Math.max(8, (width + 64) / PX_PER_SECOND) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [visible, text]);

  useEffect(() => {
    // A dismissed bar reappears when the admin publishes a new version.
    if (ann && dismissedVersion !== null && dismissedVersion !== ann.version) { dismissedVersion = null; rerender((n) => n + 1); }
  }, [ann]);

  if (!ann || !visible) return null;
  const tone = TONES[(ann.level as keyof typeof TONES) ?? "info"] ?? TONES.info;
  const external = /^https?:\/\//i.test(ann.link_url);
  const linkClass = "shrink-0 rounded-full bg-surface/15 px-3 py-1 text-[12.5px] font-semibold hover:bg-surface/25";
  const dismiss = () => { dismissedVersion = ann.version; rerender((n) => n + 1); };

  return (
    <div className={cn("text-surface", tone.bar)} role="status">
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-4 py-2.5 sm:px-6">
        <tone.Icon size={17} className="shrink-0" />
        <div ref={trackRef} className="group relative min-w-0 flex-1 overflow-hidden text-[13.5px] font-medium leading-snug">
          <span ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap">{text}</span>
          {overflow ? (
            <div
              className="announcement-marquee flex w-max gap-16 whitespace-nowrap group-hover:[animation-play-state:paused]"
              style={{ "--marquee-shift": `-${overflow.width + 64}px`, animationDuration: `${overflow.seconds}s` } as React.CSSProperties}
            >
              <span>{text}</span>
              <span aria-hidden>{text}</span>
            </div>
          ) : (
            <span className="block truncate">{text}</span>
          )}
        </div>
        {ann.link_url && (
          external
            ? <a href={ann.link_url} target="_blank" rel="noreferrer" className={linkClass}>{t("announcementLink")}</a>
            : <Link href={ann.link_url} className={linkClass}>{t("announcementLink")}</Link>
        )}
        <button type="button" onClick={dismiss} aria-label={t("dismiss")} title={t("dismiss")} className="grid h-7 w-7 shrink-0 place-items-center rounded-md opacity-80 hover:bg-surface/15 hover:opacity-100">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
