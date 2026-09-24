import { vnd } from "@/lib/api";
import type { AdminLogEntry } from "@/lib/types";

export type Md = Record<string, unknown>;
export type Cat = "order" | "dispute" | "money" | "system" | "security";

// ============================================================
// Danh mục sự kiện — dịch mọi event backend ghi ra câu tiếng Việt
// đọc được, kèm nhóm nghiệp vụ để admin lọc theo cách họ tư duy
// (đơn hàng / khiếu nại / dòng tiền) thay vì theo mã kỹ thuật.
// ============================================================

export const num = (m: Md, k: string): number | undefined =>
  typeof m[k] === "number" ? (m[k] as number) : undefined;
const arrLen = (m: Md, k: string): number | undefined =>
  Array.isArray(m[k]) ? (m[k] as unknown[]).length : undefined;

const money = (m: Md, k = "amount") => {
  const v = num(m, k);
  return v != null ? vnd(v) : null;
};

export interface EventMeta {
  cat: Cat;
  describe: (m: Md) => string;
}

export const EVENT_META: Record<string, EventMeta> = {
  // ---- Đơn hàng ----
  order_placed: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} được đặt${money(m) ? ` — ${money(m)}` : ""}`,
  },
  resources_assigned: {
    cat: "order",
    describe: (m) => `Cấp ${arrLen(m, "resource_ids") ?? ""} tài nguyên cho đơn #${num(m, "order_id")}`,
  },
  order_processing: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} chờ người bán giao thủ công`,
  },
  order_provisioned: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — nguồn hàng cấp thành công`,
  },
  order_provision_failed: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — nguồn hàng cấp THẤT BẠI`,
  },
  order_adapter_error: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — lỗi kết nối nguồn hàng`,
  },
  order_provider_strategy_mismatch: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — cấu hình nguồn hàng không khớp chiến lược giá`,
  },
  order_provision_error: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — lỗi provision chạy nền`,
  },
  order_confirmed: {
    cat: "order",
    describe: (m) => `Người mua xác nhận đơn #${num(m, "order_id")}${money(m) ? ` — ${money(m)}` : ""}`,
  },
  order_delivered_manual: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} được giao thủ công`,
  },
  escrow_released: {
    cat: "order",
    describe: (m) => `Giải ngân ký quỹ đơn #${num(m, "order_id")}${money(m) ? ` — ${money(m)}` : ""} cho người bán`,
  },
  escrow_release_failed: {
    cat: "order",
    describe: (m) => `Giải ngân ký quỹ đơn #${num(m, "order_id")} THẤT BẠI — cần admin kiểm tra`,
  },
  sla_refund: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} tự hoàn tiền — người bán trễ hạn giao (SLA)`,
  },
  sla_refund_failed: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} quá hạn SLA nhưng không tự hoàn tiền được`,
  },
  provision_deadline_refund: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} tự hoàn tiền — nguồn hàng không cấp được trong 15 phút`,
  },
  provision_deadline_refund_failed: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} quá hạn provision nhưng không tự hoàn tiền được`,
  },
  resource_expired: {
    cat: "order",
    describe: (m) =>
      `Tài nguyên #${num(m, "resource_id")} hết hạn${num(m, "order_id") != null ? ` (đơn #${num(m, "order_id")})` : ""}`,
  },
  task_webhook_sla_timeout: {
    cat: "order",
    describe: (m) => `Đơn #${num(m, "order_id")} — ${num(m, "task_count")} tác vụ quá hạn chờ người bán phản hồi`,
  },

  // ---- Khiếu nại ----
  dispute_opened: {
    cat: "dispute",
    describe: (m) => `Đơn #${num(m, "order_id")} bị khiếu nại`,
  },
  dispute_seller_responded: {
    cat: "dispute",
    describe: (m) => `Người bán phản hồi khiếu nại (đơn #${num(m, "order_id")})`,
  },
  dispute_refunded: {
    cat: "dispute",
    describe: (m) => `Khiếu nại đơn #${num(m, "order_id")} — hoàn toàn bộ${money(m) ? ` ${money(m)}` : " tiền"} cho người mua`,
  },
  dispute_partial_refunded: {
    cat: "dispute",
    describe: (m) =>
      `Khiếu nại đơn #${num(m, "order_id")} — hoàn một phần${money(m, "refund_amount") ? ` ${money(m, "refund_amount")}` : ""}`,
  },
  dispute_rejected: {
    cat: "dispute",
    describe: (m) => `Khiếu nại đơn #${num(m, "order_id")} — từ chối, tiền về người bán`,
  },
  dispute_replaced: {
    cat: "dispute",
    describe: (m) => `Khiếu nại đơn #${num(m, "order_id")} — xử lý bằng đổi sản phẩm mới`,
  },
  dispute_warranty_extended: {
    cat: "dispute",
    describe: (m) => `Khiếu nại đơn #${num(m, "order_id")} — gia hạn bảo hành ${num(m, "extra_days")} ngày`,
  },

  // ---- Dòng tiền ----
  deposit_created: {
    cat: "money",
    describe: (m) => `Lệnh nạp #${num(m, "intent_id")} được tạo — ${money(m)} (tài khoản #${num(m, "account_id")})`,
  },
  deposit_paid: {
    cat: "money",
    describe: (m) =>
      `Lệnh nạp #${num(m, "intent_id")} ĐÃ NHẬN ${money(m, "amount") ?? "tiền"}${typeof m.source === "string" ? ` qua ${m.source}` : ""}`,
  },
  deposit_cancelled: {
    cat: "money",
    describe: (m) => `Lệnh nạp #${num(m, "intent_id")} bị người dùng huỷ`,
  },
  deposit_webhook_unknown: {
    cat: "money",
    describe: (m) => `Webhook PayOS không khớp lệnh nạp nào (orderCode ${num(m, "order_code")})`,
  },
  deposit_expired_sweep: {
    cat: "money",
    describe: (m) => `${arrLen(m, "intent_ids") ?? ""} lệnh nạp quá hạn đã chốt hết hạn`,
  },
  manual_topup: {
    cat: "money",
    describe: (m) =>
      `Admin nạp tay ${money(m)} vào tài khoản #${num(m, "subject_id") ?? num(m, "account_id")}${num(m, "actor_id") != null ? ` (bởi admin #${num(m, "actor_id")})` : ""}`,
  },
  demo_topup: {
    cat: "money",
    describe: (m) => `Demo nạp ${money(m)} vào tài khoản #${num(m, "subject_id") ?? num(m, "account_id")}`,
  },
  wallet_backfill: {
    cat: "money",
    describe: (m) => `Backfill ví / điều chỉnh sổ — tài khoản #${num(m, "account_id") ?? num(m, "subject_id")}`,
  },
  withdraw_requested: {
    cat: "money",
    describe: (m) => `Yêu cầu rút #${num(m, "withdraw_id")} — ${money(m)} (đã khoá tiền, chờ duyệt)`,
  },
  withdraw_approved: {
    cat: "money",
    describe: (m) => `Lệnh rút #${num(m, "withdraw_id")} được duyệt — chờ chi ${money(m)}`,
  },
  withdraw_rejected: {
    cat: "money",
    describe: (m) => `Lệnh rút #${num(m, "withdraw_id")} bị từ chối — hoàn ${money(m)} về ví`,
  },
  withdraw_paid: {
    cat: "money",
    describe: (m) => `Lệnh rút #${num(m, "withdraw_id")} đã chi ${money(m)}`,
  },

  // ---- Hệ thống ----
  provider_down: {
    cat: "system",
    describe: (m) => `Nguồn hàng #${num(m, "provider_id")} bị TẮT — lỗi 3 lần kiểm tra liên tiếp`,
  },
  internal_resources_acquired: {
    cat: "system",
    describe: (m) =>
      `Dịch vụ nội bộ lấy ${num(m, "quantity") ?? arrLen(m, "resource_ids") ?? ""} tài nguyên (gói #${num(m, "variant_id")})`,
  },
  internal_resources_released: {
    cat: "system",
    describe: (m) => `Dịch vụ nội bộ trả ${arrLen(m, "resource_ids") ?? ""} tài nguyên`,
  },
  task_updated: {
    cat: "system",
    describe: (m) =>
      `Tác vụ #${num(m, "task_id")} đổi trạng thái${typeof m.old_status === "string" ? ` ${m.old_status}` : ""}${typeof m.new_status === "string" ? ` → ${m.new_status}` : ""}`,
  },
  affiliate_fund_topup: {
    cat: "money",
    describe: (m) => `Admin nạp quỹ affiliate ${money(m)}`,
  },

  // ---- Bảo mật / đặc quyền ----
  auth_register: {
    cat: "security",
    describe: (m) => `Tài khoản #${num(m, "subject_id") ?? num(m, "actor_id")} đăng ký`,
  },
  auth_role_changed: {
    cat: "security",
    describe: (m) =>
      `Admin #${num(m, "actor_id")} đổi vai trò tài khoản #${num(m, "subject_id")}`,
  },
  auth_tier_changed: {
    cat: "security",
    describe: (m) =>
      `Admin #${num(m, "actor_id")} đổi cấp seller tài khoản #${num(m, "subject_id")}${typeof m.old_tier === "string" ? ` (${m.old_tier}` : ""}${typeof m.new_tier === "string" ? ` → ${m.new_tier})` : ""}`,
  },
  gateway_key_rotated: {
    cat: "security",
    describe: (m) => `Buyer xoay gateway key đơn #${num(m, "order_id") ?? num(m, "subject_id")}`,
  },
  gateway_key_revoked: {
    cat: "security",
    describe: (m) => `Admin thu hồi gateway key đơn #${num(m, "order_id") ?? num(m, "subject_id")}`,
  },
  seller_application_submitted: {
    cat: "security",
    describe: (m) => `Tài khoản #${num(m, "actor_id")} nộp đơn đăng ký seller #${num(m, "application_id")}`,
  },
  seller_application_approved: {
    cat: "security",
    describe: (m) => `Admin #${num(m, "actor_id")} duyệt đơn seller #${num(m, "application_id")}`,
  },
  seller_application_rejected: {
    cat: "security",
    describe: (m) => `Admin #${num(m, "actor_id")} từ chối đơn seller #${num(m, "application_id")}`,
  },
  provider_created: {
    cat: "system",
    describe: (m) => `Tạo nguồn hàng #${num(m, "provider_id") ?? num(m, "subject_id")}`,
  },
  provider_updated: {
    cat: "system",
    describe: (m) => `Cập nhật nguồn hàng #${num(m, "provider_id") ?? num(m, "subject_id")}`,
  },
  provider_reviewed: {
    cat: "system",
    describe: (m) => `Duyệt nguồn hàng #${num(m, "provider_id") ?? num(m, "subject_id")}`,
  },
  // ---- Khiếu nại (bổ sung) ----
  dispute_claim_batch_added: { cat: "dispute", describe: (m) => `Đơn #${num(m, "order_id")} — người mua khiếu nại thêm ${arrLen(m, "resource_ids") ?? ""} dòng` },
  seller_dispute_resource_action: { cat: "dispute", describe: (m) => `Đơn #${num(m, "order_id")} — người bán ${m.action === "refund" ? "hoàn tiền" : "đổi"} ${num(m, "resource_count") ?? arrLen(m, "resource_ids") ?? ""} dòng bị khiếu nại${(num(m, "refund_amount") ?? 0) > 0 ? ` (${money(m, "refund_amount")})` : ""}` },
  dispute_withdrawn: { cat: "dispute", describe: (m) => `Đơn #${num(m, "order_id")} — người mua rút khiếu nại` },
  dispute_abandoned: { cat: "dispute", describe: (m) => `Đơn #${num(m, "order_id")} — khiếu nại tự đóng vì người mua không phản hồi` },
  dispute_resolution_timeout: { cat: "dispute", describe: (m) => `Đơn #${num(m, "order_id")} — hết hạn chờ người mua trả lời đề xuất, khiếu nại tự đóng` },
  dispute_seller_timeout: { cat: "dispute", describe: (m) => `Đơn #${num(m, "order_id")} — người bán quá hạn phản hồi, tự hoàn ${money(m) ?? "tiền"} cho người mua` },
  dispute_marketplace_review: { cat: "dispute", describe: (m) => `Đơn #${num(m, "order_id")} — yêu cầu sàn phân xử khiếu nại` },
  content_filter_hit: { cat: "security", describe: (m) => `Chặn nội dung chứa liên hệ ngoài sàn${typeof m.field === "string" ? ` (${m.field})` : ""}` },
  // ---- Bảo mật tài khoản ----
  password_changed: { cat: "security", describe: () => "Đổi mật khẩu" },
  password_reset_requested: { cat: "security", describe: () => "Yêu cầu đặt lại mật khẩu" },
  password_reset_completed: { cat: "security", describe: () => "Đặt lại mật khẩu thành công" },
  mfa_enabled: { cat: "security", describe: () => "Bật xác thực 2 lớp" },
  mfa_disabled: { cat: "security", describe: () => "Tắt xác thực 2 lớp" },
  email_change_requested: { cat: "security", describe: () => "Yêu cầu đổi email" },
  email_changed: { cat: "security", describe: () => "Đổi email tài khoản" },
  email_verified: { cat: "security", describe: () => "Xác minh email" },
  email_verified_by_admin: { cat: "security", describe: () => "Admin xác minh email hộ người dùng" },
  account_unlocked: { cat: "security", describe: () => "Mở khoá tài khoản" },
  account_internal_flag_set: { cat: "security", describe: (m) => (m.new === true || m.is_internal === true ? "Đánh dấu seller nội bộ" : "Bỏ đánh dấu seller nội bộ") },
  auth_internal_changed: { cat: "security", describe: () => "Đổi cấu hình đăng nhập nội bộ" },
  // ---- Người bán & kho ----
  seller_profile_updated: { cat: "system", describe: () => "Người bán cập nhật hồ sơ cửa hàng" },
  seller_resource_revealed: { cat: "security", describe: (m) => `Người bán xem dữ liệu tài nguyên #${num(m, "subject_id") ?? num(m, "resource_id")}` },
  seller_resource_archived: { cat: "system", describe: (m) => `Người bán lưu trữ ${num(m, "count") ?? arrLen(m, "resource_ids") ?? ""} tài nguyên` },
  seller_resource_restored: { cat: "system", describe: (m) => `Người bán khôi phục ${num(m, "count") ?? arrLen(m, "resource_ids") ?? ""} tài nguyên` },
  seller_resource_restocked: { cat: "system", describe: (m) => `Người bán nhập thêm ${num(m, "count") ?? ""} tài nguyên` },
  seller_inventory_exported: { cat: "security", describe: (m) => `Người bán xuất kho (${num(m, "count") ?? "?"} dòng)` },
  resource_duplicate_upload: { cat: "system", describe: (m) => `Bỏ qua ${num(m, "count") ?? ""} dòng kho trùng lặp khi nhập` },
  // ---- Cảnh báo ----
  admin_alert_resolved: { cat: "system", describe: (m) => `Đánh dấu đã xử lý cảnh báo #${num(m, "alert_id")}${typeof m.note === "string" ? ` — "${m.note}"` : ""}` },
  admin_alert_reopened: { cat: "system", describe: (m) => `Mở lại cảnh báo #${num(m, "alert_id")}` },
  // ---- Cấu hình hệ thống ----
  affiliate_runtime_config_changed: { cat: "system", describe: () => "Đổi cài đặt affiliate" },
  ai_prompt_template_changed: { cat: "system", describe: () => "Đổi mẫu prompt AI" },
  ai_provider_config_changed: { cat: "system", describe: () => "Đổi nhà cung cấp AI" },
  auth_runtime_config_changed: { cat: "security", describe: () => "Đổi cài đặt đăng nhập/tài khoản" },
  content_filter_config_changed: { cat: "system", describe: () => "Đổi cài đặt lọc nội dung" },
  deposit_rail_config_changed: { cat: "money", describe: () => "Đổi cấu hình kênh nạp tiền" },
  display_money_config_changed: { cat: "money", describe: () => "Đổi cấu hình hiển thị tiền tệ" },
  fee_runtime_config_changed: { cat: "money", describe: () => "Đổi cấu hình phí & giữ tiền" },
  mail_runtime_config_changed: { cat: "system", describe: () => "Đổi cấu hình gửi mail" },
  mail_template_changed: { cat: "system", describe: () => "Sửa mẫu email" },
  mail_send_test: { cat: "system", describe: () => "Gửi email thử" },
  mail_outbox_retry: { cat: "system", describe: () => "Gửi lại email trong hàng đợi" },
  seller_runtime_config_changed: { cat: "system", describe: () => "Đổi cài đặt người bán" },
  seller_tier_config_changed: { cat: "system", describe: () => "Đổi quy tắc hạng người bán" },
  site_analytics_config_changed: { cat: "system", describe: () => "Đổi cấu hình đo lường (Clarity…)" },
  site_runtime_config_changed: { cat: "system", describe: () => "Đổi cài đặt hệ thống" },
  provider_plan_ids_changed: { cat: "system", describe: (m) => `Đổi gói của nguồn hàng #${num(m, "provider_id") ?? num(m, "subject_id")}` },
  // ---- Vận hành ----
  ledger_reconcile: { cat: "money", describe: (m) => `Đối soát sổ cái${num(m, "mismatches") != null ? ` — ${num(m, "mismatches")} ví lệch` : ""}` },
  nowpayments_reconcile_debug: { cat: "money", describe: () => "Đối soát NOWPayments (debug)" },
  purge_demo_accounts_done: { cat: "system", describe: (m) => `Dọn tài khoản demo (${num(m, "count") ?? "?"})` },
  trust_seed_applied: { cat: "system", describe: () => "Áp dụng đánh giá mồi" },
  trust_seed_purged: { cat: "system", describe: () => "Gỡ đánh giá mồi" },

};

/** One log row as an admin sentence (falls back to the backend message). */
export function describeLog(log: Pick<AdminLogEntry, "message" | "metadata">): string {
  const md = (log.metadata ?? {}) as Md;
  const meta = typeof md.event === "string" ? EVENT_META[md.event] : undefined;
  return meta ? meta.describe(md) : log.message;
}

export function logCategory(log: Pick<AdminLogEntry, "metadata">): Cat {
  const md = (log.metadata ?? {}) as Md;
  return (typeof md.event === "string" ? EVENT_META[md.event]?.cat : undefined) ?? "system";
}
