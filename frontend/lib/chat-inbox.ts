export const INBOX_HREF = "/messages" as const;
export const ADMIN_SUPPORT_HREF = "/admin/support" as const;

export function conversationInboxPath(conversationId: string): string {
  return `${INBOX_HREF}/${conversationId}`;
}

export function adminSupportInboxPath(conversationId: string): string {
  return `${ADMIN_SUPPORT_HREF}/${conversationId}`;
}

/** `orderRef` is the ORD-XXXXXXXX code (buyer/seller) or the numeric id (admin). */
export function orderWorkspaceHref(
  counterpartRole: "buyer" | "seller" | "admin",
  orderRef?: string | number | null,
  options?: { admin?: boolean },
): string {
  if (options?.admin) {
    return orderRef != null ? `/admin/orders?highlight=${orderRef}` : "/admin/disputes";
  }
  if (counterpartRole === "admin") {
    return orderRef != null ? `/orders?search=%23${orderRef}` : "/orders";
  }
  const sellerSide = counterpartRole === "buyer";
  const base = sellerSide ? "/seller/orders" : "/orders";
  return orderRef != null ? `${base}?search=%23${orderRef}` : base;
}

export function unreadTotal(rooms: { unread_count: number }[] | undefined): number {
  return (rooms ?? []).reduce((total, room) => total + room.unread_count, 0);
}
