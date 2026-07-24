/**
 * Shared status badge configurations for admin pages.
 * Centralized to avoid duplication across pages.
 */

export type StatusTone = "good" | "warn" | "bad" | "iris" | "neutral";

export interface StatusConfig {
  label: string;
  tone: StatusTone;
}

// Order statuses
export const ORDER_STATUS: Record<string, StatusConfig> = {
  pending: { label: "Chờ xử lý", tone: "warn" },
  processing: { label: "Đang xử lý", tone: "iris" },
  accepted: { label: "Đang xử lý", tone: "iris" },
  delivered: { label: "Đã giao", tone: "iris" },
  completed: { label: "Hoàn thành", tone: "good" },
  confirmed: { label: "Hoàn thành", tone: "good" },
  disputed: { label: "Khiếu nại", tone: "bad" },
  refunded: { label: "Hoàn tiền", tone: "bad" },
  cancelled: { label: "Đã hủy", tone: "neutral" },
};

// Dispute statuses
export const DISPUTE_STATUS: Record<string, StatusConfig> = {
  open: { label: "Đang mở", tone: "warn" },
  resolved_refund: { label: "Đã hoàn tiền", tone: "bad" },
  resolved_reject: { label: "Đã từ chối", tone: "good" },
  resolved_partial_refund: { label: "Hoàn tiền một phần", tone: "bad" },
  resolved_replace: { label: "Đã đổi sản phẩm", tone: "iris" },
  resolved_extend_warranty: { label: "Đã gia hạn bảo hành", tone: "iris" },
};

// Withdrawal request statuses
export const DEPOSIT_STATUS: Record<string, StatusConfig> = {
  pending: { label: "Chờ thanh toán", tone: "warn" },
  paid: { label: "Đã nhận tiền", tone: "good" },
  cancelled: { label: "Đã huỷ", tone: "neutral" },
  expired: { label: "Hết hạn", tone: "bad" },
};

export const WITHDRAW_STATUS: Record<string, StatusConfig> = {
  pending: { label: "Chờ duyệt", tone: "warn" },
  approved: { label: "Đã duyệt — chờ chi", tone: "good" },
  paid: { label: "Đã chi tiền", tone: "good" },
  rejected: { label: "Bị từ chối", tone: "bad" },
};

// Product statuses
export const PRODUCT_STATUS: Record<string, StatusConfig> = {
  active: { label: "Đang bán", tone: "good" },
  draft: { label: "Nháp", tone: "neutral" },
  paused: { label: "Tạm dừng", tone: "warn" },
  suspended: { label: "Bị khoá", tone: "bad" },
};

// Resource statuses
export const RESOURCE_STATUS: Record<string, StatusConfig> = {
  available: { label: "Sẵn sàng", tone: "good" },
  assigned: { label: "Đã cấp phát", tone: "iris" },
  expired: { label: "Hết hạn", tone: "warn" },
  error: { label: "Lỗi", tone: "bad" },
};

// Alert severity
export const ALERT_SEVERITY: Record<string, StatusConfig> = {
  critical: { label: "Nghiêm trọng", tone: "bad" },
  warning: { label: "Cảnh báo", tone: "warn" },
  info: { label: "Thông tin", tone: "iris" },
};

// Pricing strategy
export const STRATEGY_LABELS: Record<string, StatusConfig> = {
  fixed: { label: "Cố định", tone: "neutral" },
  config: { label: "Cấu hình", tone: "iris" },
  credit: { label: "Credit", tone: "good" },
  task: { label: "Tác vụ", tone: "warn" },
};
