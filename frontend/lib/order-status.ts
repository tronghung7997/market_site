/** MỘT nguồn từ vựng trạng thái đơn hàng cho mọi trang buyer.
 *
 * Trước đây mỗi trang tự khai báo map riêng và đã lệch nhau thật:
 * cùng `pending` mà nơi ghi "Chờ xử lý" nơi ghi "Đang xử lý", cùng
 * `completed` mà "Hoàn tất"/"Hoàn thành". Wording ở đây lấy theo bản đầy
 * đủ nhất (trang Đơn hàng). Đổi chữ ở đây là đổi đồng loạt mọi trang.
 */

export type StatusTone = "good" | "bad" | "warn" | "iris" | "neutral";

export interface OrderStatusInfo {
  label: string;
  tone: StatusTone;
  /** Một câu nói cho buyer biết chuyện gì đang xảy ra / cần làm gì tiếp. */
  hint: string;
}

export const ORDER_STATUS: Record<string, OrderStatusInfo> = {
  pending: { label: "Chờ xử lý", tone: "warn", hint: "Người bán đang chuẩn bị đơn của bạn." },
  processing: { label: "Đang xử lý", tone: "warn", hint: "Người bán đã nhận đơn và đang giao." },
  delivered: { label: "Đã giao", tone: "iris", hint: "Hàng đã giao — kiểm tra rồi bấm xác nhận để hoàn tất." },
  completed: { label: "Hoàn tất", tone: "good", hint: "Đơn đã hoàn tất, tiền đã chuyển cho người bán." },
  disputed: { label: "Khiếu nại", tone: "bad", hint: "Khiếu nại đang được quản trị viên xử lý." },
  refunded: { label: "Đã hoàn tiền", tone: "bad", hint: "Tiền đã được hoàn về ví của bạn." },
  cancelled: { label: "Đã huỷ", tone: "neutral", hint: "Đơn đã bị huỷ." },
};

/** Tra trạng thái an toàn — status lạ từ backend không làm vỡ UI. */
export function orderStatus(status: string): OrderStatusInfo {
  return ORDER_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}
