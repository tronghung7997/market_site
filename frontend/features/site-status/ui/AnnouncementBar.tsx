"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AlertCircle, AlertTriangle, Info } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { useSiteStatus } from "../data";

const TONES = {
  info: { bar: "bg-iris", Icon: Info },
  warn: { bar: "bg-warn", Icon: AlertTriangle },
  danger: { bar: "bg-bad", Icon: AlertCircle },
} as const;

/**
 * Admin-authored notice across the top of the storefront. Solid colour, no
 * close button and it scrolls with the nav: an announcement is something the
 * admin needs every visitor to keep seeing until it is switched off.
 */
export function AnnouncementBar() {
  const t = useTranslations("siteStatus");
  const locale = useLocale();
  const { data } = useSiteStatus();
  const ann = data?.announcement ?? null;
  if (!ann) return null;
  const text = (locale === "vi" ? ann.text_vi : ann.text_en) || ann.text_vi || ann.text_en;
  if (!text) return null;
  const tone = TONES[(ann.level as keyof typeof TONES) ?? "info"] ?? TONES.info;
  const external = /^https?:\/\//i.test(ann.link_url);
  const linkClass = "shrink-0 rounded-full bg-surface/15 px-3 py-1 text-[12.5px] font-semibold hover:bg-surface/25";

  return (
    <div className={cn("text-surface", tone.bar)} role="status">
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-4 py-2.5 sm:px-6">
        <tone.Icon size={17} className="shrink-0" />
        <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug">{text}</span>
        {ann.link_url && (
          external
            ? <a href={ann.link_url} target="_blank" rel="noreferrer" className={linkClass}>{t("announcementLink")}</a>
            : <Link href={ann.link_url} className={linkClass}>{t("announcementLink")}</Link>
        )}
      </div>
    </div>
  );
}
