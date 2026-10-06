import type { AffiliateTotals } from "@/lib/types";

export type RangeKey = "7d" | "30d" | "90d" | "all" | "custom";
export type DateRange = { date_from?: string; date_to?: string };

/** The viewer's calendar day (not UTC: before 07:00 in Vietnam UTC is still yesterday). */
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Preset → API params: whole days in the viewer's zone (sent as `tz`), "7 ngày" = today and the 6 before. */
export function rangeParams(key: RangeKey, custom: DateRange = {}, now: Date = new Date()): DateRange {
  if (key === "all") return {};
  if (key === "custom") {
    const from = custom.date_from || "";
    const to = custom.date_to || "";
    // A reversed pair is put in order instead of failing the whole dashboard.
    const [a, b] = from && to && from > to ? [to, from] : [from, to];
    return { date_from: a || undefined, date_to: b || undefined };
  }
  const days = { "7d": 7, "30d": 30, "90d": 90 }[key];
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { date_from: localIso(from) };
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
  return t.clicks > 0 || t.signups > 0 || t.orders > 0 || t.commission > 0 || t.pending_orders > 0;
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
