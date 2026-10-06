import type { ChangeAudience, ChangeItem, ChangeKind } from "@/lib/types";

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

/** Change lines grouped in KINDS order ("- Mới:", "- Cải tiến:", "- Sửa lỗi:"), empty kinds dropped. */
export function groupByKind(items: ChangeItem[]): { kind: ChangeKind; items: ChangeItem[] }[] {
  return KINDS
    .map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) }))
    .filter((g) => g.items.length > 0);
}

const KIND_HEADINGS: Record<string, ChangeKind> = { "mới": "new", "cải tiến": "improved", "sửa lỗi": "fixed" };
const HEADING_RE = /^[-•*·+\s]*(mới|cải tiến|sửa lỗi)\s*:\s*(.*)$/iu;
const BULLET_RE = /^\s*(?:[-•*·+–]|\d+[.)])\s*/u;

/** Split pasted text into change lines. A "Cải tiến:" / "- Sửa lỗi:" line
 *  switches the kind for the lines below it (text after the colon counts as
 *  a line); bullets and numbering are stripped; blank lines are dropped. */
export function parseChangeLines(text: string, fallbackKind: ChangeKind): { kind: ChangeKind; text: string }[] {
  let kind = fallbackKind;
  const out: { kind: ChangeKind; text: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.match(HEADING_RE);
    if (heading) {
      kind = KIND_HEADINGS[heading[1].toLowerCase()] ?? kind;
      const rest = heading[2].trim();
      if (rest) out.push({ kind, text: rest });
      continue;
    }
    const line = raw.replace(BULLET_RE, "").trim();
    if (line) out.push({ kind, text: line });
  }
  return out;
}
