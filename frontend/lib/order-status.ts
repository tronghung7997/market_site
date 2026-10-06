/** Order status tones + bilingual labels/hints (locale-aware). */

export type StatusTone = "good" | "bad" | "warn" | "iris" | "neutral";

export interface OrderStatusInfo {
  label: string;
  tone: StatusTone;
  /** One line telling the reader (buyer or seller) what is happening / what to do next. */
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

/** Who is reading. A status means a different thing from each side: "đã giao"
 *  is "the shop delivered to me" for the buyer and "I delivered" for the
 *  seller; "khiếu nại" is "I complained" vs "a buyer complained about me". */
export type OrderSide = "buyer" | "seller";

const COPY: Record<OrderSide, Record<"en" | "vi", Record<string, { label: string; hint: string }>>> = {
  buyer: {
    en: {
      pending: { label: "Waiting for the shop", hint: "The shop is preparing your order." },
      processing: { label: "Shop preparing", hint: "The shop accepted your order and is fulfilling it." },
      delivered: { label: "Delivered to you", hint: "Check what you received, then confirm to complete." },
      completed: { label: "Completed", hint: "Order completed; your payment went to the shop." },
      disputed: { label: "You disputed", hint: "Your dispute is open — waiting on the shop." },
      refunded: { label: "Refunded to you", hint: "The money is back in your wallet." },
      cancelled: { label: "Cancelled", hint: "This order was cancelled." },
    },
    vi: {
      pending: { label: "Chờ shop xử lý", hint: "Shop đang chuẩn bị đơn của bạn." },
      processing: { label: "Shop đang chuẩn bị", hint: "Shop đã nhận đơn và đang giao." },
      delivered: { label: "Shop đã giao", hint: "Kiểm tra hàng đã nhận rồi bấm xác nhận để hoàn tất." },
      completed: { label: "Hoàn tất", hint: "Đơn đã hoàn tất, tiền đã chuyển cho shop." },
      disputed: { label: "Bạn đang khiếu nại", hint: "Khiếu nại của bạn đang chờ shop xử lý." },
      refunded: { label: "Đã hoàn tiền cho bạn", hint: "Tiền đã được hoàn về ví của bạn." },
      cancelled: { label: "Đã huỷ", hint: "Đơn đã bị huỷ." },
    },
  },
  seller: {
    en: {
      pending: { label: "New — to deliver", hint: "The buyer paid; accept and deliver before the deadline." },
      processing: { label: "Preparing", hint: "You accepted this order; deliver it before the deadline." },
      delivered: { label: "Delivered to buyer", hint: "The buyer is checking; you are paid when that period ends." },
      completed: { label: "Paid out", hint: "Order completed; the money is in your wallet." },
      disputed: { label: "Disputed by buyer", hint: "The buyer opened a dispute — respond to it." },
      refunded: { label: "Refunded to buyer", hint: "This order's money went back to the buyer." },
      cancelled: { label: "Cancelled", hint: "This order was cancelled." },
    },
    vi: {
      pending: { label: "Đơn mới — cần giao", hint: "Khách đã thanh toán, hãy nhận đơn và giao trước hạn." },
      processing: { label: "Đang chuẩn bị", hint: "Bạn đã nhận đơn, hãy giao trước hạn." },
      delivered: { label: "Đã giao khách", hint: "Khách đang kiểm tra; tiền về ví khi hết hạn kiểm tra." },
      completed: { label: "Đã nhận tiền", hint: "Đơn hoàn tất, tiền đã về ví của bạn." },
      disputed: { label: "Bị khiếu nại", hint: "Khách đã khiếu nại — hãy phản hồi." },
      refunded: { label: "Đã hoàn tiền cho khách", hint: "Tiền đơn này đã trả lại cho khách." },
      cancelled: { label: "Đã huỷ", hint: "Đơn đã bị huỷ." },
    },
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
  side: OrderSide = "buyer",
): OrderStatusInfo {
  if (hasOpenDispute(order)) return orderStatus("disputed", locale, side);
  return orderStatus(order.status, locale, side);
}

/** Safe lookup — unknown backend status does not break the UI. */
export function orderStatus(status: string, locale: string = "en", side: OrderSide = "buyer"): OrderStatusInfo {
  const loc = locale === "vi" ? "vi" : "en";
  const copy = COPY[side][loc][status];
  const tone = TONE[status] ?? "neutral";
  if (!copy) return { label: status, tone, hint: "" };
  return { label: copy.label, tone, hint: copy.hint };
}

/** Back-compat export used by older call sites that only need the map. */
export const ORDER_STATUS: Record<string, OrderStatusInfo> = Object.fromEntries(
  Object.keys(TONE).map((k) => [k, orderStatus(k, "en")]),
);
