/** The storefront "chat with GMMO" launcher: where it shows, which rooms in
 *  the chat list are the account's helpdesk threads, and which one it opens. */

import type { ChatConversation, HelpdeskRole } from "../../lib/types.ts";

export type { HelpdeskRole };

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

type DeskRoom = Pick<ChatConversation, "kind" | "viewer_role" | "unread_count">;

export function helpdeskRoom<T extends DeskRoom>(rooms: T[] | undefined, role: HelpdeskRole = "buyer"): T | null {
  return rooms?.find((room) => room.kind === "helpdesk" && (room.viewer_role ?? "buyer") === role) ?? null;
}

/** The seller workbench (`/seller/...`), not public shop pages (`/sellers/...`). */
export function sellerWorkspace(pathname: string): boolean {
  return pathname === "/seller" || pathname.startsWith("/seller/");
}

/** Which thread the panel opens on: the one with a new reply, else the shop
 *  thread inside the seller workbench and the buyer thread elsewhere. */
export function initialHelpdeskRole(pathname: string, isSeller: boolean, unread: Record<HelpdeskRole, number>): HelpdeskRole {
  if (!isSeller) return "buyer";
  if (unread.seller > 0 && unread.buyer === 0) return "seller";
  if (unread.buyer > 0 && unread.seller === 0) return "buyer";
  return sellerWorkspace(pathname) ? "seller" : "buyer";
}

/** Topics offered before the first message; each prefills the composer. A
 *  seller's buyer thread drops "selling": that belongs in the shop thread. */
const BUYER_TOPICS = ["deposit", "order", "account", "selling"] as const;
const SHOP_TOPICS = ["listing", "payout", "shopOrder", "tier"] as const;
export type QuickTopic = (typeof BUYER_TOPICS)[number] | (typeof SHOP_TOPICS)[number];

export function quickTopics(role: HelpdeskRole, isSeller: boolean): readonly QuickTopic[] {
  if (role === "seller") return SHOP_TOPICS;
  return isSeller ? BUYER_TOPICS.filter((topic) => topic !== "selling") : BUYER_TOPICS;
}
