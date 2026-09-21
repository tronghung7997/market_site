import type { AffiliateTotals } from "@/lib/types";

export type RangeKey = "7d" | "30d" | "90d" | "all" | "custom";
export type DateRange = { date_from?: string; date_to?: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Preset → API params. `date_to` is exclusive on the server, so "today" needs tomorrow. */
export function rangeParams(key: RangeKey, custom: DateRange = {}): DateRange {
  if (key === "all") return {};
  if (key === "custom") return { date_from: custom.date_from || undefined, date_to: custom.date_to || undefined };
  const days = { "7d": 7, "30d": 30, "90d": 90 }[key];
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { date_from: iso(from) };
}

/** "6,7%" style ratio; null when the denominator is 0. */
export function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function formatRate(value: number | null, locale: string): string {
  if (value == null) return "—";
  return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

export function hasAnyActivity(t: AffiliateTotals): boolean {
  return t.clicks > 0 || t.signups > 0 || t.orders > 0 || t.commission > 0;
}

/** Social share targets for the referral link (Zalo has no reliable web share endpoint). */
export function shareTargets(link: string, text: string) {
  const u = encodeURIComponent(link);
  const q = encodeURIComponent(text);
  return [
    { key: "facebook", label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: "telegram", label: "Telegram", href: `https://t.me/share/url?url=${u}&text=${q}` },
    { key: "x", label: "X", href: `https://twitter.com/intent/tweet?url=${u}&text=${q}` },
  ];
}
