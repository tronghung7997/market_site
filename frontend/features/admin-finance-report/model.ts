// ============================================================
// Tài chính › Báo cáo — kỳ báo cáo theo giờ Việt Nam (+07:00, không đổi
// giờ mùa hè). Kỳ sống trên URL: ?kind=month&at=2026-09-01 hoặc
// ?kind=custom&from=2026-09-01&to=2026-09-15 (to tính trọn ngày).
// ============================================================

export const KINDS = [
  { key: "week", label: "Tuần" },
  { key: "month", label: "Tháng" },
  { key: "quarter", label: "Quý" },
  { key: "custom", label: "Tuỳ chọn" },
] as const;
export type PeriodKind = (typeof KINDS)[number]["key"];

export interface Period {
  kind: PeriodKind;
  /** Ngày đầu kỳ, YYYY-MM-DD (giờ VN). */
  from: string;
  /** Ngày cuối kỳ, bao gồm, YYYY-MM-DD. */
  to: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function vnToday(now = new Date()): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function d(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const x = d(day);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
}

function addMonths(day: string, n: number): string {
  const x = d(day);
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  return iso(x);
}

/** Kỳ chứa ngày `anchor` theo loại kỳ. */
export function periodAt(kind: Exclude<PeriodKind, "custom">, anchor: string): Period {
  const x = d(anchor);
  if (kind === "week") {
    const weekday = (x.getUTCDay() + 6) % 7; // thứ Hai = 0
    const from = addDays(anchor, -weekday);
    return { kind, from, to: addDays(from, 6) };
  }
  if (kind === "month") {
    const from = `${anchor.slice(0, 7)}-01`;
    return { kind, from, to: addDays(addMonths(from, 1), -1) };
  }
  const q = Math.floor(x.getUTCMonth() / 3) * 3;
  const from = `${x.getUTCFullYear()}-${String(q + 1).padStart(2, "0")}-01`;
  return { kind, from, to: addDays(addMonths(from, 3), -1) };
}

/** Kỳ liền trước / liền sau cùng độ dài. */
export function shift(p: Period, dir: -1 | 1): Period {
  if (p.kind === "custom") {
    const len = Math.round((d(p.to).getTime() - d(p.from).getTime()) / 86_400_000) + 1;
    return { kind: "custom", from: addDays(p.from, dir * len), to: addDays(p.to, dir * len) };
  }
  if (p.kind === "week") return periodAt("week", addDays(p.from, dir * 7));
  return periodAt(p.kind, addMonths(p.from, dir * (p.kind === "month" ? 1 : 3)));
}

/** Mặc định: tháng trước (kỳ hay chốt nhất). */
export function defaultPeriod(now = new Date()): Period {
  return periodAt("month", addMonths(vnToday(now), -1));
}

export function parsePeriod(params: URLSearchParams, now = new Date()): Period {
  const kind = params.get("kind");
  const at = params.get("at");
  if (kind === "week" || kind === "month" || kind === "quarter") {
    return periodAt(kind, at && DATE.test(at) ? at : vnToday(now));
  }
  const from = params.get("from");
  const to = params.get("to");
  if (kind === "custom" && from && DATE.test(from)) {
    const end = to && DATE.test(to) && to >= from ? to : from;
    // Tối đa 400 ngày (backend từ chối kỳ dài hơn).
    return { kind: "custom", from, to: end > addDays(from, 399) ? addDays(from, 399) : end };
  }
  return defaultPeriod(now);
}

export function periodToParams(p: Period): URLSearchParams {
  const q = new URLSearchParams({ kind: p.kind });
  if (p.kind === "custom") {
    q.set("from", p.from);
    q.set("to", p.to);
  } else {
    q.set("at", p.from);
  }
  return q;
}

/** [start, end) ISO cho API. */
export function periodRange(p: Period): { start: string; end: string } {
  return { start: `${p.from}T00:00:00+07:00`, end: `${addDays(p.to, 1)}T00:00:00+07:00` };
}

export function periodLabel(p: Period): string {
  const [y, m] = p.from.split("-");
  if (p.kind === "month") return `Tháng ${m}/${y}`;
  if (p.kind === "quarter") return `Quý ${Math.floor((Number(m) - 1) / 3) + 1}/${y}`;
  const fmt = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  return `${fmt(p.from)} – ${fmt(p.to)}`;
}

/** Kỳ đã qua hết chưa (mới chốt được). */
export function periodEnded(p: Period, now = new Date()): boolean {
  return addDays(p.to, 1) <= vnToday(now);
}

/** Link sang Dòng tiền đã lọc đúng kỳ và loại giao dịch. */
export function ledgerHref(p: Period, types: string[] = []): string {
  const q = new URLSearchParams({ period: "custom", from: p.from, to: p.to });
  if (types.length) q.set("types", types.join(","));
  return `/admin/ledger?${q.toString()}`;
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
