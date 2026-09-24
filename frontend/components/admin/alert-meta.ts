// Nhãn tiếng Việt cho TOÀN BỘ loại cảnh báo backend tạo ra (scheduler.py,
// disputes, payments, resources, ledger, suppliers, providers, DProxy).
// Dùng chung cho trang Cảnh báo và Tổng quan — thêm loại mới thì thêm ở đây.
export const ALERT_TYPE_LABELS: Record<string, string> = {
  provider_down: "Nguồn hàng ngừng hoạt động",
  provider_out_of_credit: "Nguồn hàng hết số dư",
  provider_low_credit: "Nguồn hàng sắp hết số dư",
  sla_breach: "Người bán trễ hạn giao (SLA)",
  sla_refund_failed: "Quá hạn SLA nhưng không tự hoàn tiền được",
  escrow_release_failed: "Không tự giải ngân escrow được",
  provision_stuck: "Đơn không provision được",
  provision_operational: "Đơn lỗi vận hành khi cấp hàng",
  upstream_revoke_failed: "Không thu hồi được hàng ở nhà cung cấp",
  resource_low: "Tồn kho sắp hết",
  resource_error: "Tài nguyên bị báo lỗi",
  dispute_opened: "Khiếu nại mới",
  dispute_marketplace_review: "Khiếu nại cần sàn phân xử",
  task_webhook_timeout: "Người bán không phản hồi webhook",
  deposit_anomaly: "Nạp tiền bất thường",
  ledger_mismatch: "Sổ cái lệch số dư",
  supplier_sync_failed: "Đồng bộ nguồn cung thất bại",
  supplier_auto_paused: "Nguồn cung tự tạm dừng",
  supplier_low_margin: "Nguồn cung lãi quá thấp",
  supplier_sku_delisted: "Nguồn cung gỡ mã hàng",
  dproxy_auth_error: "DProxy — lỗi xác thực",
  dproxy_unavailable: "DProxy — không phản hồi",
  dproxy_contract_error: "DProxy — API thay đổi bất thường",
  dproxy_duplicate_external_id: "DProxy — tồn kho trùng lặp",
  dproxy_allocation_disappeared: "DProxy — proxy biến mất khỏi nhà cung cấp",
  ops_one_shot_done: "Tác vụ vận hành đã chạy xong",
  dispute_seller_timeout: "Người bán im lặng quá hạn khiếu nại",
  seller_application_approved: "Đơn đăng ký bán được duyệt",
  buyer_dispute_resource_resolved: "Khiếu nại được xử lý (người mua)",
  seller_dispute_resource_resolved: "Khiếu nại được xử lý (người bán)",
};

export function alertTypeLabel(type: string): string {
  return ALERT_TYPE_LABELS[type] ?? type;
}

// Một hệ màu duy nhất: mức độ nghiêm trọng (đồng bộ với trang Nhật ký).
// `error` là lỗi tự động hoá cần người xử lý — xếp ngay sau nghiêm trọng.
export const ALERT_SEVERITY_META: Record<string, { label: string; color: string; rank: number }> = {
  critical: { label: "Nghiêm trọng", color: "bg-red-600", rank: 0 },
  error: { label: "Lỗi", color: "bg-red-400", rank: 1 },
  warning: { label: "Cảnh báo", color: "bg-amber-400", rank: 2 },
  info: { label: "Thông tin", color: "bg-slate-300", rank: 3 },
};

export const ALERT_SEVERITY_ORDER = ["critical", "error", "warning", "info"];

export function severityRank(severity: string): number {
  return ALERT_SEVERITY_META[severity]?.rank ?? 9;
}
