export const INBOX_HREF = "/messages" as const;

export function conversationInboxPath(conversationId: string): string {
  return `${INBOX_HREF}/${conversationId}`;
}

export function orderWorkspaceHref(counterpartRole: "buyer" | "seller" | "admin", orderId?: number): string {
  const sellerSide = counterpartRole === "buyer";
  const base = sellerSide ? "/seller/orders" : "/orders";
  return orderId != null ? `${base}?search=${orderId}` : base;
}

export function unreadTotal(rooms: { unread_count: number }[] | undefined): number {
  return (rooms ?? []).reduce((total, room) => total + room.unread_count, 0);
}
