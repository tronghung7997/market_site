/** Seller › Telegram: pure helpers shared by the settings page and its tests. */

import type { SellerTelegramEvent, SellerTelegramState } from "../../lib/types.ts";

/** Order of the switches on the page (same keys as the backend). */
export const TELEGRAM_EVENTS: readonly SellerTelegramEvent[] = [
  "order_pending", "order_sla", "dispute", "stock_low", "supply_error", "withdrawal", "chat_messages",
];

/** Level shown beside each switch; mirrors the tag the bot puts on the message. */
export const TELEGRAM_EVENT_LEVEL: Record<SellerTelegramEvent, "bad" | "warn" | "iris"> = {
  order_pending: "warn",
  order_sla: "bad",
  dispute: "bad",
  stock_low: "warn",
  supply_error: "bad",
  withdrawal: "iris",
  chat_messages: "iris",
};

const TOKEN_PATTERN = /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/;

/** Cheap client-side check so an obviously wrong paste never calls Telegram. */
export function looksLikeBotToken(value: string): boolean {
  return TOKEN_PATTERN.test(value.trim());
}

export function secondsLeft(expiresAt: string | null | undefined, now: number): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

/** 582 → "9:42". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Chats that still count toward the limit (a broken chat can be re-linked). */
export function linkedChatCount(state: Pick<SellerTelegramState, "chats">): number {
  return state.chats.filter((chat) => chat.status !== "broken").length;
}

/** The page opens straight on "link a chat" while the bot has none. */
export function needsFirstChat(state: Pick<SellerTelegramState, "connected" | "chats">): boolean {
  return state.connected && !state.chats.some((chat) => chat.status === "active" || chat.status === "pending");
}
