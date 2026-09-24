import type { AdminCaseAction, AdminDisputeCase } from "@/lib/types";

export const STATUS_META: Record<string, { label: string; tone: "warn" | "good" | "bad" | "neutral" | "iris" }> = {
  open: { label: "Đang mở", tone: "warn" },
  resolved_refund: { label: "Đã hoàn tiền", tone: "bad" },
  resolved_partial_refund: { label: "Hoàn một phần", tone: "bad" },
  resolved_reject: { label: "Từ chối", tone: "neutral" },
  resolved_replace: { label: "Đổi sản phẩm", tone: "good" },
  resolved_extend_warranty: { label: "Gia hạn bảo hành", tone: "good" },
  resolved_timeout: { label: "Seller quá hạn · tự hoàn", tone: "bad" },
  withdrawn_by_buyer: { label: "Người mua rút", tone: "neutral" },
  resolved_abandoned: { label: "Người mua bỏ theo dõi", tone: "neutral" },
};

export const ACTOR_META: Record<string, { label: string; dot: string }> = {
  buyer: { label: "Người mua", dot: "bg-iris" },
  seller: { label: "Người bán", dot: "bg-warn" },
  admin: { label: "Sàn", dot: "bg-good" },
  system: { label: "Hệ thống", dot: "bg-line-2" },
};

/** Admin wording for every timeline event the backend emits. */
export const EVENT_LABEL: Record<string, string> = {
  case_opened: "mở khiếu nại",
  claim_batch: "khiếu nại thêm dòng",
  buyer_message: "nhắn",
  seller_message: "phản hồi",
  resource_replace: "đổi tài nguyên",
  resource_refund: "hoàn tiền theo dòng",
  case_escalated: "yêu cầu sàn phân xử",
  buyer_accepted: "chấp nhận cách xử lý",
  buyer_withdrew: "rút khiếu nại",
  resolution_timeout: "hết hạn chờ — tự đóng",
  resolution_abandoned: "người mua bỏ theo dõi — tự đóng",
  seller_timeout_refund: "người bán quá hạn — tự hoàn tiền",
  seller_full_refund: "hoàn toàn bộ",
  admin_refund: "sàn hoàn tiền",
  admin_partial_refund: "sàn hoàn một phần",
  admin_reject: "sàn từ chối khiếu nại",
  admin_replace: "sàn chọn đổi sản phẩm",
  admin_extend_warranty: "sàn gia hạn bảo hành",
  case_resolved: "khiếu nại đã đóng",
};

export const LINE_STATE: Record<string, { label: string; tone: "warn" | "good" | "bad" | "neutral" | "iris" }> = {
  claimed: { label: "Bị khiếu nại · chờ xử lý", tone: "warn" },
  replaced: { label: "Đã đổi", tone: "good" },
  refunded: { label: "Đã hoàn", tone: "bad" },
  replacement: { label: "Hàng thay thế", tone: "iris" },
  ok: { label: "Không khiếu nại", tone: "neutral" },
};

/** Stock line status (resources.status) in admin words. */
export const RESOURCE_STATUS: Record<string, string> = {
  available: "Còn trong kho",
  reserved: "Đang giữ chỗ",
  assigned: "Đã giao cho người mua",
  sold: "Đã bán",
  error: "Báo lỗi",
  expired: "Hết hạn",
  revoked: "Đã thu hồi",
  refunded: "Đã hoàn",
};

export const EVIDENCE_LABEL: Record<string, string> = {
  username: "Tài khoản",
  issue: "Lỗi gặp phải",
  desired_remedy: "Mong muốn",
  proof_url: "Link bằng chứng",
  ip: "IP được cấp",
  error: "Lỗi",
  server_ip: "IP máy chủ",
  transaction_id: "Mã giao dịch",
};

export interface ActionDef {
  key: AdminCaseAction;
  label: string;
  describe: (c: AdminDisputeCase, amount: number) => string;
  tone: "bad" | "good" | "neutral";
}

const vnd = (v: number) => `${Math.round(v).toLocaleString("vi-VN")} ₫`;

export const ACTIONS: ActionDef[] = [
  {
    key: "refund", label: "Hoàn toàn bộ phần còn lại", tone: "bad",
    describe: (c) => `Người mua nhận lại ${vnd(c.money.remaining_refundable)}. Người bán không nhận tiền phần này.`,
  },
  {
    key: "partial_refund", label: "Hoàn một phần", tone: "bad",
    describe: (c, amount) => {
      const rest = Math.max(0, c.money.remaining_refundable - amount);
      const fee = Math.round(rest * c.money.fee_percent / 100);
      return `Người mua nhận ${vnd(amount)}; người bán nhận ${vnd(rest - fee)} (phí sàn ${vnd(fee)}).`;
    },
  },
  {
    key: "reject", label: "Từ chối — giải ngân cho người bán", tone: "neutral",
    describe: (c) => `Người bán nhận ${vnd(c.money.seller_payout_if_closed)} (phí sàn ${vnd(c.money.platform_fee_if_closed)}). Người mua không được hoàn.`,
  },
  {
    key: "replace", label: "Yêu cầu đổi sản phẩm", tone: "good",
    describe: () => "Giao lại hàng thay thế từ kho của người bán, không hoàn tiền.",
  },
  {
    key: "extend_warranty", label: "Gia hạn bảo hành", tone: "good",
    describe: () => "Kéo dài thời gian bảo hành để người mua tiếp tục dùng; khiếu nại được đóng.",
  },
];

/** The recommendation's action, if it maps to a decision the admin can take. */
export function suggestedAction(c: AdminDisputeCase): AdminCaseAction | null {
  const a = c.recommendation.action;
  return a === "refund" || a === "partial_refund" || a === "reject" || a === "replace" || a === "extend_warranty" ? a : null;
}

export interface Deadline {
  key: string;
  label: string;
  at: string;
  overdue: boolean;
}

/** Clocks that matter while a case is open, soonest first. */
export function caseDeadlines(c: AdminDisputeCase, now = Date.now()): Deadline[] {
  if (c.status !== "open") return [];
  const out: Deadline[] = [];
  if (c.seller_deadline_at && !c.seller_responded_at) out.push({ key: "seller", label: "Hạn người bán phản hồi", at: c.seller_deadline_at, overdue: false });
  if (c.resolution_deadline_at) out.push({ key: "resolution", label: "Hạn người mua trả lời đề xuất", at: c.resolution_deadline_at, overdue: false });
  if (c.abandon_after_at) out.push({ key: "abandon", label: "Tự đóng nếu người mua im lặng", at: c.abandon_after_at, overdue: false });
  if (c.order.escrow_expires_at) out.push({ key: "escrow", label: "Ký quỹ hết hạn", at: c.order.escrow_expires_at, overdue: false });
  return out
    .map((d) => ({ ...d, overdue: new Date(d.at).getTime() <= now }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function countdown(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const d = Math.floor(h / 24);
  const text = d >= 2 ? `${d} ngày` : h >= 1 ? `${h} giờ` : `${Math.max(1, Math.floor(abs / 60_000))} phút`;
  return ms >= 0 ? `còn ${text}` : `quá ${text}`;
}

export function formatVnd(v: number | null | undefined): string {
  return vnd(v ?? 0);
}

export function pct(v: number): string {
  return `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}
