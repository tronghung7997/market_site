/** Seller-application review: wording, URL state, the reject-message
 *  composer, answer diffs and keyboard rules. Pure — covered by
 *  tests/admin-seller-applications-model.test.ts. Admin copy is Vietnamese. */

import type {
  AdminSellerApplicationDetail, SellerApplicationInfoField, SellerApplicationStatus,
} from "../../lib/types.ts";

export const QUEUE_TABS: { key: SellerApplicationStatus; label: string }[] = [
  { key: "pending", label: "Cần xử lý" },
  { key: "needs_info", label: "Chờ bổ sung" },
  { key: "approved", label: "Đã duyệt" },
  { key: "rejected", label: "Từ chối" },
];

export const STATUS_LABEL: Record<SellerApplicationStatus, string> = {
  pending: "Chờ duyệt", needs_info: "Chờ bổ sung", approved: "Đã duyệt", rejected: "Đã từ chối",
};
export const STATUS_TONE: Record<SellerApplicationStatus, "warn" | "good" | "bad" | "iris"> = {
  pending: "warn", needs_info: "iris", approved: "good", rejected: "bad",
};
export const SELLER_TYPE_LABEL: Record<string, string> = { individual: "Cá nhân", business: "Doanh nghiệp" };
export const EXPERIENCE_LABEL: Record<string, string> = { none: "Mới bắt đầu", under_1y: "< 1 năm", "1_3y": "1–3 năm", over_3y: "> 3 năm" };
export const REFERRAL_LABEL: Record<string, string> = {
  search: "Tìm kiếm", social: "Mạng xã hội", friend: "Bạn bè", community: "Hội nhóm", ads: "Quảng cáo", other: "Khác",
};

export const HISTORY_LABEL: Record<AdminSellerApplicationDetail["history"][number]["kind"], string> = {
  submitted: "Nộp đơn",
  info_requested: "Yêu cầu bổ sung",
  resubmitted: "Đã bổ sung",
  approved: "Duyệt",
  rejected: "Từ chối",
};

export const INFO_FIELDS: { key: SellerApplicationInfoField; label: string }[] = [
  { key: "description", label: "Mô tả gian hàng" },
  { key: "warranty_policy", label: "Chính sách bảo hành" },
  { key: "contact", label: "Thông tin liên hệ" },
  { key: "categories", label: "Danh mục" },
  { key: "logo_banner", label: "Logo / ảnh bìa" },
];
export const INFO_NOTE_MAX = 1000;

export const REJECT_TEMPLATES = [
  "Nguồn hàng không rõ",
  "Danh mục bị cấm",
  "Chưa có chính sách bảo hành",
  "Thông tin liên hệ sai",
  "Trùng tài khoản bị khóa",
] as const;
export const REJECT_MIN = 3;
export const REJECT_MAX = 500;
export const RESUBMIT_DAYS = [0, 3, 7, 30] as const;

/** Deferred decisions wait this long for "Hoàn tác" before the API call. */
export const UNDO_MS = 8000;
/** Waiting longer than this is flagged in the queue. */
export const OVERDUE_HOURS = 48;
export const QUEUE_PAGE_SIZE = 30;

/** The message the applicant receives: chosen reasons as bullet lines, then the free text. */
export function composeRejectMessage(templates: readonly string[], extra: string): string {
  const lines = templates.map((t) => `- ${t}`);
  const note = extra.trim();
  if (note) lines.push(note);
  return lines.join("\n");
}

export function rejectMessageValid(message: string): boolean {
  const n = message.trim().length;
  return n >= REJECT_MIN && n <= REJECT_MAX;
}

export function resubmitDate(days: number, now: Date = new Date()): Date | null {
  return days > 0 ? new Date(now.getTime() + days * 86_400_000) : null;
}

/* ---------------------------------------------------------------- URL */

export interface QueueUrlState {
  status: SellerApplicationStatus;
  app: number | null;
  q: string;
}

const STATUSES = new Set<string>(QUEUE_TABS.map((t) => t.key));

export function parseQueueUrl(params: URLSearchParams): QueueUrlState {
  const status = params.get("status") ?? "";
  const app = Number(params.get("app"));
  return {
    status: (STATUSES.has(status) ? status : "pending") as SellerApplicationStatus,
    app: Number.isInteger(app) && app > 0 ? app : null,
    q: params.get("q") ?? "",
  };
}

/** Writes the state over `current`, keeping unrelated params; defaults are omitted. */
export function queueUrlSearch(state: QueueUrlState, current: URLSearchParams = new URLSearchParams()): string {
  const next = new URLSearchParams(current.toString());
  if (state.status === "pending") next.delete("status"); else next.set("status", state.status);
  if (state.app) next.set("app", String(state.app)); else next.delete("app");
  if (state.q.trim()) next.set("q", state.q.trim()); else next.delete("q");
  return next.toString();
}

/* ---------------------------------------------------------------- Queue */

export function waitHours(iso: string, now: number = Date.now()): number {
  return Math.max(0, (now - new Date(iso).getTime()) / 3_600_000);
}

export function formatWait(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} phút`;
  if (hours < 48) return `${Math.floor(hours)} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

/** 1-based submission number: earlier applications of this account + this one. */
export function submissionNumber(priorRejections: number, priorApplications?: number): number {
  return Math.max(priorRejections, priorApplications ?? 0) + 1;
}

/** Where to go after `current` leaves the list: the next item, else the previous one. */
export function neighbourAfterRemoval(ids: number[], current: number): number | null {
  const i = ids.indexOf(current);
  if (i === -1) return ids[0] ?? null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

export function stepId(ids: number[], current: number | null, dir: 1 | -1): number | null {
  if (ids.length === 0) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i === -1) return ids[dir === 1 ? 0 : ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, i + dir))];
}

/* ---------------------------------------------------------------- Diff */

/** Normalises an answer for comparison and display ("" for empty). */
export function answerText(value: unknown, categoryName?: (id: number) => string): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "number" && categoryName ? categoryName(v) : String(v))).join(", ");
  }
  return String(value).trim();
}

export interface AnswerDiff {
  current: string;
  /** The answer before the last resubmit, when it differs. */
  previous: string | null;
}

export function diffAnswer(
  key: string,
  current: unknown,
  snapshot: Record<string, unknown> | null | undefined,
  categoryName?: (id: number) => string,
): AnswerDiff {
  const now = answerText(current, categoryName);
  if (!snapshot || !(key in snapshot)) return { current: now, previous: null };
  const before = answerText(snapshot[key], categoryName);
  return { current: now, previous: before === now ? null : before };
}

/* ---------------------------------------------------------------- Keyboard */

export type ShortcutAction = "next" | "prev" | "approve" | "info" | "reject";

export function shortcutAction(key: string): ShortcutAction | null {
  switch (key.toLowerCase()) {
    case "j": return "next";
    case "k": return "prev";
    case "a": return "approve";
    case "i": return "info";
    case "r": return "reject";
    default: return null;
  }
}

/** True while the person is typing somewhere a letter key must stay a letter. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(target.isContentEditable);
}
