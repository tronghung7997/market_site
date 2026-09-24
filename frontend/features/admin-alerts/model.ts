import type { AdminAlert, AlertRef } from "@/lib/types";

/** What an alert means and what the operator should do about it. Every alert
 *  type the backend emits has an entry — a new type falls back to the raw
 *  message and a generic step. */
export interface Playbook {
  title: string;
  impact: string;
  steps: string[];
}

export const PLAYBOOKS: Record<string, Playbook> = {
  sla_breach: {
    title: "Người bán trễ hạn giao (SLA)",
    impact: "Đơn đã bị huỷ và tự hoàn tiền cho người mua. Người bán lặp lại nhiều lần sẽ làm giảm uy tín sàn.",
    steps: ["Mở đơn để xem thời điểm tạo và hạn giao", "Mở hồ sơ người bán: số lần trễ gần đây, hạng seller", "Nhắc người bán hoặc hạ hạng/tạm khoá nếu lặp lại"],
  },
  sla_refund_failed: {
    title: "Quá hạn SLA nhưng không tự hoàn tiền được",
    impact: "Tiền người mua đang bị giữ trong ký quỹ dù đơn đã quá hạn giao.",
    steps: ["Mở đơn, kiểm tra trạng thái ký quỹ", "Hoàn tiền thủ công cho người mua", "Báo kỹ thuật nếu lỗi lặp lại"],
  },
  escrow_release_failed: {
    title: "Không tự giải ngân ký quỹ được",
    impact: "Người bán chưa nhận được tiền cho đơn đã hoàn tất.",
    steps: ["Mở đơn, kiểm tra khiếu nại hoặc số dư ví", "Giải ngân thủ công khi đã rõ nguyên nhân"],
  },
  provision_stuck: {
    title: "Đơn kẹt ở bước cấp hàng",
    impact: "Người mua đã trả tiền nhưng chưa nhận được hàng.",
    steps: ["Mở đơn, xem lỗi cấp phát gần nhất trong nhật ký", "Kiểm tra nguồn hàng (số dư, kết nối)", "Cấp lại hoặc huỷ và hoàn tiền"],
  },
  provision_operational: {
    title: "Đơn lỗi vận hành khi cấp hàng",
    impact: "Cấp hàng thất bại vì lý do phía sàn/nguồn cung, không phải lỗi người mua.",
    steps: ["Mở đơn và nhật ký của đơn", "Xử lý nguồn cung rồi cấp lại, hoặc hoàn tiền"],
  },
  upstream_revoke_failed: {
    title: "Không thu hồi được hàng ở nhà cung cấp",
    impact: "Hàng vẫn còn hiệu lực phía nhà cung cấp dù đơn đã huỷ — có thể mất chi phí.",
    steps: ["Mở đơn để lấy mã phân bổ", "Thu hồi thủ công trên trang nhà cung cấp"],
  },
  task_webhook_timeout: {
    title: "Người bán không phản hồi webhook",
    impact: "Tác vụ giao hàng qua API của người bán không nhận được kết quả.",
    steps: ["Mở đơn, kiểm tra tác vụ giao hàng", "Liên hệ người bán kiểm tra endpoint"],
  },
  provider_down: {
    title: "Nguồn hàng ngừng hoạt động",
    impact: "Đơn mới dùng nguồn này sẽ không cấp được hàng.",
    steps: ["Mở nguồn hàng, chạy kiểm tra kết nối", "Tạm tắt sản phẩm dùng nguồn này nếu sự cố kéo dài"],
  },
  provider_out_of_credit: {
    title: "Nguồn hàng hết số dư",
    impact: "Mọi đơn qua nguồn này sẽ thất bại cho tới khi nạp thêm.",
    steps: ["Mở nguồn hàng để xem số dư", "Nạp thêm số dư ở nhà cung cấp hoặc báo chủ nguồn"],
  },
  provider_low_credit: {
    title: "Nguồn hàng sắp hết số dư",
    impact: "Sắp không cấp được hàng nếu không nạp thêm.",
    steps: ["Mở nguồn hàng để xem số dư còn lại", "Lên lịch nạp thêm"],
  },
  resource_low: {
    title: "Tồn kho sắp hết",
    impact: "Sản phẩm sắp hết hàng — mất doanh số nếu không nhập thêm.",
    steps: ["Mở sản phẩm để xem tồn kho", "Nhắc người bán nhập thêm hàng"],
  },
  resource_error: {
    title: "Tài nguyên bị báo lỗi",
    impact: "Một tài nguyên trong kho không dùng được.",
    steps: ["Mở tài nguyên để xem lý do lỗi", "Kiểm tra các đơn đã giao tài nguyên cùng lô"],
  },
  dispute_opened: {
    title: "Khiếu nại mới",
    impact: "Tiền của đơn đang bị giữ cho tới khi khiếu nại được giải quyết.",
    steps: ["Mở hồ sơ khiếu nại", "Theo dõi hạn phản hồi của người bán"],
  },
  dispute_marketplace_review: {
    title: "Khiếu nại cần sàn phân xử",
    impact: "Một bên đã yêu cầu sàn đứng ra phân xử.",
    steps: ["Mở hồ sơ khiếu nại, đọc diễn biến và bằng chứng", "Ra quyết định: hoàn tiền, hoàn một phần, đổi hàng hoặc từ chối"],
  },
  dispute_seller_timeout: {
    title: "Người bán im lặng quá hạn khiếu nại",
    impact: "Hệ thống đã tự hoàn tiền phần còn lại cho người mua.",
    steps: ["Mở hồ sơ khiếu nại để xác nhận", "Xem lịch sử khiếu nại của người bán"],
  },
  deposit_anomaly: {
    title: "Nạp tiền bất thường",
    impact: "Giao dịch nạp không khớp (số tiền, trạng thái hoặc mã) — ví người dùng có thể lệch.",
    steps: ["Mở lệnh nạp và đối chiếu với sao kê ngân hàng/cổng thanh toán", "Điều chỉnh số dư nếu cần"],
  },
  ledger_mismatch: {
    title: "Sổ cái lệch số dư",
    impact: "Tổng giao dịch không khớp số dư ví — cần đối soát trước khi chi trả.",
    steps: ["Mở báo cáo đối soát", "Xác định giao dịch gây lệch và ghi bút toán điều chỉnh"],
  },
  supplier_sync_failed: {
    title: "Đồng bộ nguồn cung thất bại",
    impact: "Giá và tồn kho từ nhà cung cấp không được cập nhật.",
    steps: ["Mở nguồn hàng, xem lỗi đồng bộ gần nhất", "Kiểm tra API key hoặc trạng thái nhà cung cấp"],
  },
  supplier_auto_paused: {
    title: "Nguồn cung tự tạm dừng",
    impact: "Sản phẩm bị tạm ngưng bán do lỗi liên tiếp từ nhà cung cấp.",
    steps: ["Mở sản phẩm để xem lý do", "Bật lại khi nhà cung cấp ổn định"],
  },
  supplier_low_margin: {
    title: "Nguồn cung lãi quá thấp",
    impact: "Giá vốn tăng khiến biên lợi nhuận dưới ngưỡng.",
    steps: ["Mở sản phẩm, tab Giá & nguồn hàng", "Điều chỉnh giá bán hoặc tạm dừng"],
  },
  supplier_sku_delisted: {
    title: "Nhà cung cấp gỡ mã hàng",
    impact: "Mã hàng không còn ở nhà cung cấp — không bán tiếp được.",
    steps: ["Mở sản phẩm để gỡ hoặc đổi mã hàng"],
  },
  dproxy_auth_error: { title: "DProxy — lỗi xác thực", impact: "Không gọi được API DProxy.", steps: ["Mở nguồn hàng, kiểm tra API key"] },
  dproxy_unavailable: { title: "DProxy — không phản hồi", impact: "Đơn proxy mới có thể thất bại.", steps: ["Mở nguồn hàng, chạy kiểm tra kết nối", "Theo dõi — tự đóng khi nguồn phản hồi lại"] },
  dproxy_contract_error: { title: "DProxy — API thay đổi bất thường", impact: "Phản hồi của DProxy không đúng định dạng đã biết.", steps: ["Mở nguồn hàng", "Báo kỹ thuật kiểm tra adapter"] },
  dproxy_duplicate_external_id: { title: "DProxy — tồn kho trùng lặp", impact: "Hai đơn có thể nhận cùng một proxy.", steps: ["Mở nguồn hàng", "Kiểm tra các đơn dùng mã trùng"] },
  dproxy_allocation_disappeared: { title: "DProxy — proxy biến mất khỏi nhà cung cấp", impact: "Người mua có thể đang dùng proxy không còn tồn tại.", steps: ["Mở đơn để xem proxy đã cấp", "Cấp lại hoặc hoàn tiền"] },
  ops_one_shot_done: { title: "Tác vụ vận hành đã chạy xong", impact: "Chỉ để thông báo.", steps: ["Đánh dấu đã xử lý"] },
};

export function playbook(alert: Pick<AdminAlert, "type" | "message">): Playbook {
  return PLAYBOOKS[alert.type] ?? { title: alert.type, impact: alert.message, steps: ["Mở đối tượng liên quan để kiểm tra"] };
}

export const REF_KIND_LABEL: Record<string, string> = {
  order: "Đơn",
  dispute: "Khiếu nại",
  account: "Tài khoản",
  provider: "Nguồn hàng",
  product: "Sản phẩm",
  variant: "Biến thể",
  resource: "Tài nguyên",
  deposit: "Lệnh nạp",
  report: "Báo cáo",
};

/** "Mở đơn ORD-…" — the primary action names the record it opens. */
export function primaryActionLabel(ref: AlertRef | undefined): string {
  if (!ref) return "Không có đối tượng";
  const verb: Record<string, string> = {
    order: "Mở đơn", dispute: "Mở khiếu nại", account: "Mở tài khoản", provider: "Mở nguồn hàng",
    product: "Mở sản phẩm", resource: "Mở tài nguyên", deposit: "Mở lệnh nạp", report: "Mở đối soát",
  };
  return verb[ref.kind] ?? "Mở";
}

/** Quick notes so resolving an alert records *why* without typing. */
export const RESOLUTION_PRESETS = [
  "Đã khắc phục",
  "Đã liên hệ người bán",
  "Đã hoàn tiền thủ công",
  "Theo dõi thêm, chưa cần xử lý",
  "Báo nhầm",
];

export type InboxView = "open" | "resolved";

export const SEVERITY_META: Record<string, { label: string; dot: string; text: string; rank: number }> = {
  critical: { label: "Nghiêm trọng", dot: "bg-bad", text: "text-bad", rank: 0 },
  error: { label: "Lỗi", dot: "bg-bad/70", text: "text-bad", rank: 1 },
  warning: { label: "Cảnh báo", dot: "bg-warn", text: "text-warn", rank: 2 },
  info: { label: "Thông tin", dot: "bg-faint/50", text: "text-faint", rank: 3 },
};
export const SEVERITY_ORDER = ["critical", "error", "warning", "info"] as const;

export function severityRank(severity: string): number {
  return SEVERITY_META[severity]?.rank ?? 9;
}

/** Severity first, then the most recent occurrence. */
export function sortAlerts(alerts: AdminAlert[], view: InboxView): AdminAlert[] {
  if (view === "resolved") {
    return [...alerts].sort((a, b) => (b.admin_resolved_at ?? "").localeCompare(a.admin_resolved_at ?? ""));
  }
  return [...alerts].sort((a, b) => {
    const r = severityRank(a.severity) - severityRank(b.severity);
    if (r) return r;
    return (b.last_seen_at ?? b.created_at).localeCompare(a.last_seen_at ?? a.created_at);
  });
}

/** Free-text search also matches the resolved records (order code, seller
 *  name/email, provider name) — admins search by what they know. */
export function matchesSearch(alert: AdminAlert, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    alert.message, playbook(alert).title, alert.admin_note ?? "",
    ...alert.refs.flatMap((r) => [r.label, r.detail ?? ""]),
  ].join(" ").toLowerCase();
  return hay.includes(needle);
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86_400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}
