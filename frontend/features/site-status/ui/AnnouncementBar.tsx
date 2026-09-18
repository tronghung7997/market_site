"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AlertCircle, AlertTriangle, Info, X } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { useSiteStatus } from "../data";

const TONES = {
  info: { bar: "bg-iris-soft text-iris-hi border-iris/20", Icon: Info },
  warn: { bar: "bg-warn-soft text-warn border-warn/25", Icon: AlertTriangle },
  danger: { bar: "bg-bad-soft text-bad border-bad/25", Icon: AlertCircle },
} as const;

const DISMISS_KEY = "gmmo.announcement.dismissed";

/**
 * Admin-authored notice across the top of the storefront. A visitor can
 * dismiss it for the browser; the dismissal is keyed on the announcement
 * version, so edited text shows again.
 */
export function AnnouncementBar() {
  const t = useTranslations("siteStatus");
  const locale = useLocale();
  const { data } = useSiteStatus();
  const ann = data?.announcement ?? null;
  const [dismissedVersion, setDismissedVersion] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      setDismissedVersion(raw ? Number(raw) : null);
    } catch { /* storage unavailable */ }
  }, []);

  if (!ann || dismissedVersion === ann.version) return null;
  const text = (locale === "vi" ? ann.text_vi : ann.text_en) || ann.text_vi || ann.text_en;
  if (!text) return null;
  const tone = TONES[(ann.level as keyof typeof TONES) ?? "info"] ?? TONES.info;
  const external = /^https?:\/\//i.test(ann.link_url);

  const dismiss = () => {
    setDismissedVersion(ann.version);
    try { localStorage.setItem(DISMISS_KEY, String(ann.version)); } catch { /* ignore */ }
  };

  return (
    <div className={cn("border-b text-[13px]", tone.bar)} role="status">
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-2.5 px-4 py-2 sm:px-6">
        <tone.Icon size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 leading-snug">{text}</span>
        {ann.link_url && (
          external
            ? <a href={ann.link_url} target="_blank" rel="noreferrer" className="shrink-0 font-medium underline-offset-2 hover:underline">{t("announcementLink")}</a>
            : <Link href={ann.link_url} className="shrink-0 font-medium underline-offset-2 hover:underline">{t("announcementLink")}</Link>
        )}
        <button type="button" onClick={dismiss} aria-label={t("dismiss")} className="grid h-7 w-7 shrink-0 place-items-center rounded-md opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/40">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
