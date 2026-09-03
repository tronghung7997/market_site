/** Order status tones + bilingual labels/hints (locale-aware). */

export type StatusTone = "good" | "bad" | "warn" | "iris" | "neutral";

export interface OrderStatusInfo {
  label: string;
  tone: StatusTone;
  /** One line telling the buyer what is happening / what to do next. */
  hint: string;
}

const TONE: Record<string, StatusTone> = {
  pending: "warn",
  processing: "warn",
  delivered: "iris",
  completed: "good",
  disputed: "bad",
  refunded: "bad",
  cancelled: "neutral",
};

const COPY: Record<"en" | "vi", Record<string, { label: string; hint: string }>> = {
  en: {
    pending: { label: "Pending", hint: "The seller is preparing your order." },
    processing: { label: "Processing", hint: "The seller has accepted your order and is fulfilling it." },
    delivered: { label: "Delivered", hint: "Item delivered — check it, then confirm to complete." },
    completed: { label: "Completed", hint: "Order completed; payment released to the seller." },
    disputed: { label: "Disputed", hint: "A dispute is open — waiting on the seller." },
    refunded: { label: "Refunded", hint: "Funds have been returned to your wallet." },
    cancelled: { label: "Cancelled", hint: "This order was cancelled." },
  },
  vi: {
    pending: { label: "Chờ xử lý", hint: "Người bán đang chuẩn bị đơn của bạn." },
    processing: { label: "Đang xử lý", hint: "Người bán đã nhận đơn và đang giao." },
    delivered: { label: "Đã giao", hint: "Hàng đã giao — kiểm tra rồi bấm xác nhận để hoàn tất." },
    completed: { label: "Hoàn tất", hint: "Đơn đã hoàn tất, tiền đã chuyển cho người bán." },
    disputed: { label: "Khiếu nại", hint: "Đơn đang có khiếu nại — chờ người bán xử lý." },
    refunded: { label: "Đã hoàn tiền", hint: "Tiền đã được hoàn về ví của bạn." },
    cancelled: { label: "Đã huỷ", hint: "Đơn đã bị huỷ." },
  },
};

/** Mirrors the backend dispute eligibility: delivered and still in escrow. */
export function canOpenDispute(status: string, escrowExpiresAt: string | null, now = Date.now()): boolean {
  return status === "delivered" && (!escrowExpiresAt || Date.parse(escrowExpiresAt) >= now);
}

/** Open dispute is an overlay: commercial status stays delivered. */
export function hasOpenDispute(order: {
  status?: string;
  has_dispute?: boolean;
  protection?: { status?: string } | null;
}): boolean {
  if (order.protection?.status === "dispute_open") return true;
  if (order.has_dispute) return true;
  return order.status === "disputed";
}

export function displayOrderStatus(
  order: {
    status: string;
    has_dispute?: boolean;
    protection?: { status?: string } | null;
  },
  locale: string = "en",
): OrderStatusInfo {
  if (hasOpenDispute(order)) return orderStatus("disputed", locale);
  return orderStatus(order.status, locale);
}

/** Safe lookup — unknown backend status does not break the UI. */
export function orderStatus(status: string, locale: string = "en"): OrderStatusInfo {
  const loc = locale === "vi" ? "vi" : "en";
  const copy = COPY[loc][status];
  const tone = TONE[status] ?? "neutral";
  if (!copy) return { label: status, tone, hint: "" };
  return { label: copy.label, tone, hint: copy.hint };
}

/** Back-compat export used by older call sites that only need the map. */
export const ORDER_STATUS: Record<string, OrderStatusInfo> = Object.fromEntries(
  Object.keys(TONE).map((k) => [k, orderStatus(k, "en")]),
);
