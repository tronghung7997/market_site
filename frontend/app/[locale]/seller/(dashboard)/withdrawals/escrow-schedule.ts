/** Display helpers for GET /seller/escrow-schedule: which day a release
 *  falls on relative to today, and each day's share of the busiest day. */

import type { EscrowScheduleDay } from "@/lib/types";

export type DayKind = "today" | "tomorrow" | "later";

/** Days between two YYYY-MM-DD dates (calendar days, no time zone drift). */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function dayKind(date: string, today: string): DayKind {
  const diff = dayDiff(today, date);
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  return "later";
}

export interface ScheduleRow extends EscrowScheduleDay {
  kind: DayKind;
  /** 0–1 share of the largest day's net, for the row's bar. */
  share: number;
}

export function scheduleRows(days: EscrowScheduleDay[], today: string): ScheduleRow[] {
  const peak = Math.max(0, ...days.map((day) => day.net));
  return days.map((day) => ({ ...day, kind: dayKind(day.date, today), share: peak > 0 ? day.net / peak : 0 }));
}

/** Net due within the next `withinDays` days, today included. */
export function netWithin(days: EscrowScheduleDay[], today: string, withinDays: number): number {
  return days.filter((day) => dayDiff(today, day.date) < withinDays).reduce((sum, day) => sum + day.net, 0);
}
