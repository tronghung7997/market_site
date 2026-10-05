/** Admin bell: badge and wait-time wording. Pure, unit-tested. */

/** Unread alert groups are the number; open queues with nothing unread show as a dot (same rule as the buyer bell). */
export function adminBellBadge(unreadGroups: number, queueCount: number): { count: number; dot: boolean } {
  return { count: unreadGroups, dot: unreadGroups === 0 && queueCount > 0 };
}

/** "18 phút" / "6 giờ" / "2 ngày": how long the oldest entry of a queue has waited. */
export function waitLabel(sinceIso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

/** A queue waiting this long is shown as overdue. */
export const OVERDUE_HOURS = 24;

export function isOverdue(sinceIso: string, now: number): boolean {
  return now - new Date(sinceIso).getTime() >= OVERDUE_HOURS * 3_600_000;
}
