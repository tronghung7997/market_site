/** Notification history: which message renders a row, the bell badge, and
 *  relative times. Pure, so the bell and /notifications agree. */

import type { NotificationCategory, NotificationItem } from "../../lib/types.ts";

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = ["order", "wallet", "message", "system"];

/** Kinds sent to both sides of an order: the seller reads its own wording. */
const SELLER_WORDING = new Set(["order_cancelled", "order_refunded", "dispute_resolved"]);

const KNOWN_KINDS = new Set([
  "order_new", "order_delivered", "order_completed", "order_cancelled", "order_refunded",
  "dispute_opened", "dispute_seller_replied", "dispute_buyer_message", "dispute_remedy", "dispute_resolved",
  "deposit_credited", "wallet_credited", "withdrawal_approved", "withdrawal_rejected", "withdrawal_paid",
  "chat_message", "question_answered", "application_approved", "application_rejected", "application_needs_info",
  "tier_changed", "telegram_paused", "tier_at_risk", "seller_fee_promo", "buyer_tier_changed", "cashback_credited",
]);

/** "2027-01-05T…" → "05/01/2027" (locale-neutral enough for a notification line). */
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export type NotificationMessage = { key: string; values: Record<string, string | number> };

/** The `notificationCenter.kinds.*` key and its values for one row. Amounts
 *  go through `money` (the ledger formatter) so they follow the display currency. */
export function notificationMessage(item: Pick<NotificationItem, "kind" | "params" | "href">, money: (amount: number) => string): NotificationMessage {
  const p = item.params ?? {};
  const text = (key: string) => (typeof p[key] === "string" ? (p[key] as string) : "");
  const amount = typeof p.amount === "number" ? money(p.amount) : "";
  if (!KNOWN_KINDS.has(item.kind)) return { key: "unknown", values: {} };
  if (item.kind === "chat_message") {
    const from = p.from === "shop" || p.from === "desk" ? p.from : "buyer";
    return { key: `chat_message_${from}`, values: { name: text("name"), count: Number(p.count ?? 1) } };
  }
  if (item.kind === "seller_fee_promo" && !text("ends_at")) {
    return { key: "seller_fee_promo_open", values: { fee: typeof p.fee_percent === "number" ? p.fee_percent : 0 } };
  }
  if (item.kind === "order_new" && p.auto === true) {
    return { key: "order_new_auto", values: { order_code: text("order_code") } };
  }
  const seller = SELLER_WORDING.has(item.kind) && (item.href ?? "").startsWith("/seller/");
  return {
    key: seller ? `${item.kind}_seller` : item.kind,
    values: {
      order_code: text("order_code"),
      amount,
      code: text("code"),
      reason: text("reason"),
      hasReason: text("reason") ? "yes" : "no",
      outcome: text("outcome"),
      action: text("action"),
      count: Number(p.count ?? 0),
      product: text("product"),
      old: text("old"),
      new: text("new"),
      tier: text("tier"),
      days: Number(p.days ?? 0),
      fee: typeof p.fee_percent === "number" ? p.fee_percent : 0,
      rate: typeof p.rate === "number" ? p.rate : 0,
      date: shortDate(text("ends_at")),
    },
  };
}

/** Unread notifications are the number; pending to-dos with nothing unread
 *  show as a dot, so one delivered order is never counted twice. */
export function bellBadge(unread: number, actionCount: number): { count: number; dot: boolean } {
  return { count: unread, dot: unread === 0 && actionCount > 0 };
}

/** "3 phút trước" / "3 minutes ago", up to a week; a date after that. */
export function relativeTime(iso: string, now: number, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale === "vi" ? "vi" : "en", { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), "day");
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
