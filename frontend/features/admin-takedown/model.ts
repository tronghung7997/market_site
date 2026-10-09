/**
 * Admin takedown console — pure helpers (no React), loadable by the node test runner.
 * Copy is Vietnamese like the rest of the admin console.
 */
import type { TakedownEventEntry } from "@/lib/types";

/** "12 phút" / "5 giờ" / "3 ngày" since an ISO time. */
export function waitedLabel(from: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(from).getTime()) / 60_000));
  if (mins < 60) return `${mins} phút`;
  const hours = Math.floor(mins / 60);
  return hours < 48 ? `${hours} giờ` : `${Math.floor(hours / 24)} ngày`;
}

/** The list URL to go back to, only if it is our own list query (never an open redirect). */
export function safeBackSearch(raw: string | null): string {
  return raw && /^\?[\w=&%.+-]*$/.test(raw) ? raw : "";
}

/** Status labels worded from our side (the buyer copy says "needs you"). Keys match `statusView`. */
const ADMIN_STATUS: Record<string, string> = {
  review: "Chờ báo giá", quoted: "Đã báo giá · chờ khách", started: "Đã thanh toán · chờ đối tác", processing: "Đang xử lý",
  warranty: "Đã gỡ · bảo hành", warrantyClaim: "Khách xin bảo hành", done: "Hoàn tất", failed: "Failed · đã hoàn tiền",
  declined: "Đối tác không nhận", rejected: "Khách từ chối giá", cancelled: "Đã huỷ",
};

export function adminStatusLabel(key: string): string {
  return ADMIN_STATUS[key] ?? key;
}

const PARTNER_ACTIONS: Record<string, string> = {
  create: "Đối tác ghi nhận đơn",
  quote: "Đối tác báo giá vốn",
  reject: "Đối tác không nhận",
  accept: "Đối tác ghi nhận khách chấp nhận",
  decline: "Đối tác ghi nhận khách từ chối",
  cancel: "Đối tác ghi nhận huỷ",
  "confirm-payment": "Đối tác xác nhận thanh toán · bắt đầu gỡ",
  complete: "Đối tác báo đã gỡ · bắt đầu bảo hành",
  warranty: "Đối tác ghi nhận yêu cầu bảo hành",
  "warranty-accept": "Đối tác nhận bảo hành · gỡ lại",
  "warranty-reject": "Đối tác từ chối bảo hành",
  fail: "Đối tác báo không gỡ được",
  refund: "Đối tác hoàn giá vốn cho GMMO",
  auto_success: "Hết bảo hành · hoàn tất",
};
const OUR_ACTIONS: Record<string, string> = {
  "buyer:create": "Khách gửi link",
  "buyer:accept": "Khách chấp nhận giá · trừ số dư",
  "buyer:decline": "Khách từ chối giá",
  "buyer:cancel": "Khách huỷ yêu cầu",
  "buyer:warranty": "Khách xin bảo hành",
  "admin:price": "Admin đặt giá bán",
  "system:partner_created": "Đã tạo đơn bên đối tác",
};

export type EventTone = "neutral" | "iris" | "warn" | "good" | "bad";

/** One history line: who did what, in admin wording, plus a dot colour. */
export function eventView(e: Pick<TakedownEventEntry, "source" | "action" | "to_status" | "applied">): { label: string; tone: EventTone; by: string } {
  const by = e.source === "partner" ? "Đối tác" : e.source === "buyer" ? "Khách" : e.source === "admin" ? "Admin" : "Hệ thống";
  const label = e.source === "partner"
    ? PARTNER_ACTIONS[e.action] ?? `${e.action}${e.to_status ? ` → ${e.to_status}` : ""}`
    : OUR_ACTIONS[`${e.source}:${e.action}`] ?? e.action;
  const tone: EventTone = !e.applied ? "warn"
    : e.to_status === "failed" || e.action === "fail" || e.action === "reject" ? "bad"
    : e.to_status === "success" || e.to_status === "in_warranty" ? "good"
    : e.source === "partner" ? "iris" : "neutral";
  return { label: e.applied ? label : `${label} (chưa áp dụng, đã đồng bộ lại)`, tone, by };
}
