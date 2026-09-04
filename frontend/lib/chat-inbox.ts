export const INBOX_HREF = "/messages" as const;
export const ADMIN_SUPPORT_HREF = "/admin/support" as const;

export function conversationInboxPath(conversationId: string): string {
  return `${INBOX_HREF}/${conversationId}`;
}

export function adminSupportInboxPath(conversationId: string): string {
  return `${ADMIN_SUPPORT_HREF}/${conversationId}`;
}

export function orderWorkspaceHref(
  counterpartRole: "buyer" | "seller" | "admin",
  orderId?: number,
  options?: { admin?: boolean },
): string {
  if (options?.admin) {
    return orderId != null ? `/admin/orders?highlight=${orderId}` : "/admin/disputes";
  }
  if (counterpartRole === "admin") {
    return orderId != null ? `/orders?search=%23${orderId}` : "/orders";
  }
  const sellerSide = counterpartRole === "buyer";
  const base = sellerSide ? "/seller/orders" : "/orders";
  return orderId != null ? `${base}?search=%23${orderId}` : base;
}

export function unreadTotal(rooms: { unread_count: number }[] | undefined): number {
  return (rooms ?? []).reduce((total, room) => total + room.unread_count, 0);
}
