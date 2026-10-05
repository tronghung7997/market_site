import type { ChangeAudience, ChangeKind } from "@/lib/types";

export const CHANGELOG_KEY = ["admin", "changelog"] as const;

export const KIND_META: Record<ChangeKind, { label: string; hint: string; tone: "iris" | "good" | "warn" }> = {
  new: { label: "Mới", hint: "tính năng chưa từng có", tone: "iris" },
  improved: { label: "Cải tiến", hint: "làm tốt hơn cái đã có", tone: "good" },
  fixed: { label: "Sửa lỗi", hint: "trước sai, giờ đúng", tone: "warn" },
};
export const KINDS = Object.keys(KIND_META) as ChangeKind[];

export const AUDIENCE_LABEL: Record<ChangeAudience, string> = {
  admin: "Admin",
  seller: "Seller",
  buyer: "Buyer",
  accounting: "Kế toán",
};
export const AUDIENCES = Object.keys(AUDIENCE_LABEL) as ChangeAudience[];

export function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** "3 mới · 1 sửa lỗi" for a collapsed release row. */
export function countSummary(items: { kind: ChangeKind }[]): string {
  return KINDS
    .map((k) => [k, items.filter((i) => i.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${KIND_META[k].label.toLowerCase()}`)
    .join(" · ");
}

/** Next version label: bump the last number of the newest one (v1.42 → v1.43). */
export function nextVersion(latest: string | undefined): string {
  if (!latest) return "v1.0";
  const m = latest.match(/^(.*?)(\d+)$/);
  return m ? `${m[1]}${Number(m[2]) + 1}` : latest;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
