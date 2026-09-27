/** The next deadline on a seller's order, so the list reads "what is due
 *  when": deliver before the SLA runs out, or when held money is paid out. */

import type { Order } from "../../lib/types.ts";

export type SellerDeadline =
  | { kind: "deliver"; at: Date; overdue: boolean }
  | { kind: "payout"; at: Date }
  | null;

const HOUR_MS = 3_600_000;

export function sellerOrderDeadline(
  order: Pick<Order, "status" | "created_at" | "sla_hours" | "escrow_expires_at" | "has_dispute" | "dispute_status">,
  now: number,
): SellerDeadline {
  if ((order.status === "pending" || order.status === "processing") && order.sla_hours) {
    const at = new Date(new Date(order.created_at).getTime() + order.sla_hours * HOUR_MS);
    return { kind: "deliver", at, overdue: at.getTime() < now };
  }
  if (order.status === "delivered" && order.escrow_expires_at && order.dispute_status !== "open") {
    return { kind: "payout", at: new Date(order.escrow_expires_at) };
  }
  return null;
}

/** "3 giờ" / "2 ngày" left until `at`, rounded down, at least one unit. */
export function timeLeft(at: Date, now: number): { unit: "hour" | "day" | "minute"; value: number } {
  const ms = Math.max(0, at.getTime() - now);
  if (ms >= 48 * HOUR_MS) return { unit: "day", value: Math.floor(ms / (24 * HOUR_MS)) };
  if (ms >= HOUR_MS) return { unit: "hour", value: Math.floor(ms / HOUR_MS) };
  return { unit: "minute", value: Math.max(1, Math.floor(ms / 60_000)) };
}
