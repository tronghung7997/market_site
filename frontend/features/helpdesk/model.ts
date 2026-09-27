/** The storefront "chat with GMMO" launcher: where it shows and which room
 *  in the chat list is the account's helpdesk thread. */

import type { ChatConversation } from "../../lib/types.ts";

/** Routes that already are a chat, or where a floating button would get in
 *  the way of signing in. Paths are locale-free (`usePathname` from i18n). */
const HIDDEN_PREFIXES = ["/messages", "/login", "/register", "/verify-email", "/reset-password", "/forgot-password"];

export function launcherHidden(pathname: string): boolean {
  return HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Product pages keep a fixed buy bar at the bottom on phones. */
export function launcherRaised(pathname: string): boolean {
  return pathname.startsWith("/products/");
}

export function helpdeskRoom(rooms: ChatConversation[] | undefined): ChatConversation | null {
  return rooms?.find((room) => room.kind === "helpdesk") ?? null;
}

/** Topics offered before the first message; each prefills the composer. */
export const QUICK_TOPICS = ["deposit", "order", "account", "selling"] as const;
export type QuickTopic = (typeof QUICK_TOPICS)[number];

/** Admin desk inbox filters. A thread waits for the desk when its newest
 *  message came from the customer. */
export const DESK_FILTERS = ["all", "waiting", "helpdesk", "support"] as const;
export type DeskFilter = (typeof DESK_FILTERS)[number];

export function awaitingDesk(room: Pick<ChatConversation, "last_message">): boolean {
  return !!room.last_message && room.last_message.sender_role !== "admin";
}

export function filterDeskRooms<T extends Pick<ChatConversation, "kind" | "last_message">>(rooms: T[], filter: DeskFilter): T[] {
  if (filter === "waiting") return rooms.filter(awaitingDesk);
  if (filter === "helpdesk" || filter === "support") return rooms.filter((room) => room.kind === filter);
  return rooms;
}
