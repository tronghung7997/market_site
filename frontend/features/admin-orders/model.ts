// Pure helpers for the admin order console (app/[locale]/admin/orders).

/** Fields the grouping reads; Order satisfies it. */
export interface GroupableOrder {
  id: number;
  buyer_id: number;
  seller_id: number;
  variant_id: number | null;
  product_id: number | null;
  total_amount: number;
  status: string;
  created_at: string;
}

export const MIN_GROUP = 3;

export type OrderRun<T extends GroupableOrder> =
  | { kind: "single"; order: T }
  | {
      kind: "group";
      key: string;
      orders: T[];
      amount: number;
      /** Status → count, in first-seen order. */
      statuses: [string, number][];
      firstAt: string;
      lastAt: string;
    };

const runKey = (o: GroupableOrder) => `${o.buyer_id}:${o.seller_id}:${o.variant_id ?? `p${o.product_id}`}`;

/** Folds back-to-back orders of one buyer for one item at one shop into a
 *  group, so a buyer who bought the same token 18 times reads as one row.
 *  Only adjacent rows fold: the server's sort order is kept. */
export function groupRuns<T extends GroupableOrder>(orders: T[], min = MIN_GROUP): OrderRun<T>[] {
  const runs: OrderRun<T>[] = [];
  let i = 0;
  while (i < orders.length) {
    const key = runKey(orders[i]);
    let j = i + 1;
    while (j < orders.length && runKey(orders[j]) === key) j++;
    const slice = orders.slice(i, j);
    if (slice.length >= min) {
      const statuses = new Map<string, number>();
      for (const o of slice) statuses.set(o.status, (statuses.get(o.status) ?? 0) + 1);
      const times = slice.map((o) => o.created_at).sort();
      runs.push({
        kind: "group",
        key: `${key}:${slice[0].id}`,
        orders: slice,
        amount: slice.reduce((sum, o) => sum + o.total_amount, 0),
        statuses: [...statuses],
        firstAt: times[0],
        lastAt: times[times.length - 1],
      });
    } else {
      for (const order of slice) runs.push({ kind: "single", order });
    }
    i = j;
  }
  return runs;
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "14:05" today, "Hôm qua 21:40", "28/9 09:12" this year, else "28/9/2025". */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return clock(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `Hôm qua ${clock(d)}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getDate()}/${d.getMonth() + 1} ${clock(d)}`;
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

/** "45 phút", "3 giờ", "2 ngày" — a duration in the largest whole unit. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} giờ`;
  return `${Math.round(hours / 24)} ngày`;
}

/** Escrow hint for a delivered order — when the held money goes to the seller:
 *  "trả seller sau 3 giờ", or, once the hold has ended, that the system is
 *  about to pay it ("hết hạn giữ · chờ trả seller"). Null when not held. */
export function escrowHint(status: string, escrowExpiresAt: string | null, now: Date = new Date()): string | null {
  if (status !== "delivered" || !escrowExpiresAt) return null;
  const left = new Date(escrowExpiresAt).getTime() - now.getTime();
  return left > 0 ? `trả seller sau ${formatSpan(left)}` : "hết hạn giữ · chờ trả seller";
}

/** Change vs the comparison value: "+8", "−3", "=" and its tone. */
export function delta(current: number, previous: number): { label: string; tone: "up" | "down" | "flat" } {
  const diff = current - previous;
  if (diff === 0) return { label: "=", tone: "flat" };
  return diff > 0
    ? { label: `+${diff.toLocaleString("vi-VN")}`, tone: "up" }
    : { label: `−${Math.abs(diff).toLocaleString("vi-VN")}`, tone: "down" };
}

/** Disputes per order, as a percentage with one decimal ("0,8%"); "—" with no orders. */
export function disputeRate(disputes: number, orders: number): string {
  if (orders <= 0) return "—";
  return `${((disputes / orders) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

/** Above this the dispute rate is shown as a warning. */
export const DISPUTE_RATE_WARN = 0.03;
