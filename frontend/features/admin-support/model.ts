/** Admin › Hỗ trợ: views, URL state, the waiting timer, canned-reply
 *  placeholders and the "/" picker, the message + internal-note timeline and
 *  ticket lifecycle rules. Pure — covered by tests/admin-support-model.test.ts.
 *  Admin copy is Vietnamese. */

import type {
  AdminNote, AdminSupportQuery, AdminTicket, CannedReply, CannedReplyInput, ChatMessage, SupportView, TicketStatus,
} from "../../lib/types.ts";

export const VIEWS: { key: SupportView; label: string }[] = [
  { key: "waiting", label: "Chờ trả lời" },
  { key: "mine", label: "Của tôi" },
  { key: "open", label: "Đang mở" },
  { key: "resolved", label: "Đã xong" },
  { key: "all", label: "Tất cả" },
];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Đang mở", resolved: "Đã xong", closed: "Đã đóng", blocked: "Đã chặn",
};
export const STATUS_TONE: Record<TicketStatus, "warn" | "good" | "bad" | "neutral" | "iris"> = {
  open: "iris", resolved: "good", closed: "neutral", blocked: "bad",
};
export const KIND_LABEL: Record<AdminTicket["kind"], string> = { support: "Hỗ trợ đơn", helpdesk: "Helpdesk" };
export const ROLE_LABEL: Record<"buyer" | "seller", string> = { buyer: "Người mua", seller: "Người bán" };

/** Mirrors backend src/chat/tickets.py TRANSITIONS. */
export const TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["resolved", "closed", "blocked"],
  resolved: ["open", "closed"],
  closed: ["open"],
  blocked: ["open"],
};

export function ticketStatus(status: string): TicketStatus {
  return status === "resolved" || status === "closed" || status === "blocked" ? status : "open";
}

export function canTransition(from: string, to: TicketStatus): boolean {
  return TRANSITIONS[ticketStatus(from)].includes(to);
}

export const PAGE_SIZE = 30;
export const BLOCK_REASON_MIN = 3;
export const BLOCK_REASON_MAX = 300;
export const NOTE_MAX = 2000;
export const MESSAGE_MAX = 4000;
export const TAG_MAX = 40;
export const TAGS_PER_TICKET = 10;
export const CANNED_BODY_MAX = 2000;
export const CANNED_TITLE_MAX = 80;
/** Waiting longer than this is flagged red in the queue. */
export const OVERDUE_MINUTES = 30;
export const RESOLVED_NOTICE = "Đã xử lý, nhắn lại nếu cần thêm hỗ trợ";

/* ---------------------------------------------------------------- URL */

export interface SupportFilters {
  view: SupportView;
  q: string;
  role: "" | "buyer" | "seller";
  kind: "" | "support" | "helpdesk";
  /** "", "me", "none" or an admin id as text. */
  assignee: string;
  tag: string;
}

export const DEFAULT_FILTERS: SupportFilters = { view: "waiting", q: "", role: "", kind: "", assignee: "", tag: "" };

const VIEW_KEYS = new Set<string>(VIEWS.map((v) => v.key));

export function parseSupportUrl(params: URLSearchParams): SupportFilters {
  const view = params.get("view") ?? "";
  const role = params.get("role") ?? "";
  const kind = params.get("kind") ?? "";
  const assignee = params.get("assignee") ?? "";
  return {
    view: (VIEW_KEYS.has(view) ? view : "waiting") as SupportView,
    q: params.get("q") ?? "",
    role: role === "buyer" || role === "seller" ? role : "",
    kind: kind === "support" || kind === "helpdesk" ? kind : "",
    assignee: assignee === "me" || assignee === "none" || /^\d+$/.test(assignee) ? assignee : "",
    tag: (params.get("tag") ?? "").trim().toLowerCase(),
  };
}

/** Writes the filters over `current`, keeping unrelated params; defaults are omitted. */
export function supportUrlSearch(state: SupportFilters, current: URLSearchParams = new URLSearchParams()): string {
  const next = new URLSearchParams(current.toString());
  const put = (key: string, value: string, fallback = "") => {
    if (value && value !== fallback) next.set(key, value); else next.delete(key);
  };
  put("view", state.view, "waiting");
  put("q", state.q.trim());
  put("role", state.role);
  put("kind", state.kind);
  put("assignee", state.assignee);
  put("tag", state.tag);
  return next.toString();
}

/** `/vi/admin/support/abc` → { base: "/vi/admin/support", id: "abc" }. */
export function splitSupportPath(pathname: string): { base: string; id: string | null } {
  const marker = "/admin/support";
  const at = pathname.indexOf(marker);
  if (at < 0) return { base: marker, id: null };
  const base = pathname.slice(0, at + marker.length);
  const rest = pathname.slice(at + marker.length).split("/").filter(Boolean)[0];
  return { base, id: rest && rest !== "replies" ? decodeURIComponent(rest) : null };
}

export function listQuery(filters: SupportFilters): AdminSupportQuery {
  const q: AdminSupportQuery = { view: filters.view, limit: PAGE_SIZE };
  if (filters.q.trim()) q.q = filters.q.trim();
  if (filters.role) q.role = filters.role;
  if (filters.kind) q.kind = filters.kind;
  if (filters.assignee === "me" || filters.assignee === "none") q.assignee = filters.assignee;
  else if (filters.assignee) q.assignee = Number(filters.assignee);
  if (filters.tag) q.tag = filters.tag;
  return q;
}

/* ---------------------------------------------------------------- Views */

type ViewTicket = Pick<AdminTicket, "assignee" | "waiting_since"> & { status: string };

/** Whether a ticket still belongs in `view` — used to drop a row from the
 *  loaded list right after a claim/resolve instead of waiting for a refetch. */
export function ticketInView(ticket: ViewTicket, view: SupportView, meId: number): boolean {
  const status = ticketStatus(ticket.status);
  switch (view) {
    case "waiting": return status === "open" && !!ticket.waiting_since;
    case "mine": return status === "open" && ticket.assignee?.id === meId;
    case "open": return status === "open";
    case "resolved": return status === "resolved" || status === "closed";
    default: return true;
  }
}

export function filtersActive(f: SupportFilters): boolean {
  return !!(f.q.trim() || f.role || f.kind || f.assignee || f.tag);
}

/* ---------------------------------------------------------------- Time */

export function minutesSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, (now - new Date(iso).getTime()) / 60_000);
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${Math.floor(minutes)} phút`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.floor(hours)} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

const VN_TZ = "Asia/Ho_Chi_Minh";

/** "30/09 09:20" in GMT+7, whatever the browser's zone. */
export function formatVnDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}

export function formatVnTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: VN_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function formatVnDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: VN_TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

/* ---------------------------------------------------------------- Canned replies */

export interface PlaceholderValues {
  ten?: string | null;
  ma_don?: string | null;
  shop?: string | null;
}

export const PLACEHOLDERS = ["ten", "ma_don", "shop"] as const;

/** Fills {ten} {ma_don} {shop}. A placeholder without a value stays as typed
 *  so the agent sees what still needs filling before sending. */
export function renderPlaceholders(body: string, values: PlaceholderValues): string {
  return body.replace(/\{(ten|ma_don|shop)\}/g, (token, key: keyof PlaceholderValues) => {
    const value = values[key]?.trim();
    return value ? value : token;
  });
}

export function unfilledPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{(ten|ma_don|shop)\}/g)) found.add(m[1]);
  return [...found];
}

/** How the desk greets a requester: the local part of the email. */
export function requesterName(email: string | null | undefined): string {
  if (!email) return "";
  return email.split("@")[0] ?? "";
}

/** The "/" trigger under the caret: a slash at the start of the text or after
 *  whitespace, followed by shortcut characters up to the caret. */
export function slashQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s)\/([a-z0-9_-]*)$/i);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}

/** Shortcut prefix matches first, then title/shortcut substring matches. */
export function matchCanned<T extends Pick<CannedReply, "shortcut" | "title">>(replies: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...replies].sort((a, b) => a.shortcut.localeCompare(b.shortcut));
  const prefix = replies.filter((r) => r.shortcut.toLowerCase().startsWith(q));
  const rest = replies.filter((r) => !prefix.includes(r) && (r.shortcut.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)));
  return [...prefix.sort((a, b) => a.shortcut.length - b.shortcut.length || a.shortcut.localeCompare(b.shortcut)), ...rest];
}

/** Replaces the `/query` token (from `start` to `caret`) with `insert`. */
export function applySlashInsert(text: string, start: number, caret: number, insert: string): { text: string; caret: number } {
  const next = text.slice(0, start) + insert + text.slice(caret);
  return { text: next, caret: start + insert.length };
}

export type CannedErrors = Partial<Record<keyof CannedReplyInput, string>>;

export function validateCanned(input: CannedReplyInput, others: Pick<CannedReply, "id" | "shortcut">[] = [], selfId: number | null = null): CannedErrors {
  const errors: CannedErrors = {};
  const shortcut = input.shortcut.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(shortcut)) errors.shortcut = "Chỉ chữ thường, số, - và _ (tối đa 32 ký tự)";
  else if (others.some((o) => o.id !== selfId && o.shortcut === shortcut)) errors.shortcut = "Lối tắt này đã có";
  const title = input.title.trim();
  if (!title) errors.title = "Cần tiêu đề";
  else if (title.length > CANNED_TITLE_MAX) errors.title = `Tối đa ${CANNED_TITLE_MAX} ký tự`;
  const body = input.body.trim();
  if (!body) errors.body = "Cần nội dung";
  else if (body.length > CANNED_BODY_MAX) errors.body = `Tối đa ${CANNED_BODY_MAX} ký tự`;
  return errors;
}

export function normalizeCanned(input: CannedReplyInput): CannedReplyInput {
  return { shortcut: input.shortcut.trim().toLowerCase(), title: input.title.trim(), body: input.body.trim() };
}

/* ---------------------------------------------------------------- Tags / reasons */

export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, TAG_MAX);
}

/** Adds a tag (normalised, deduplicated, capped at TAGS_PER_TICKET). */
export function addTag(tags: string[], raw: string): string[] {
  const tag = normalizeTag(raw);
  if (!tag || tags.includes(tag) || tags.length >= TAGS_PER_TICKET) return tags;
  return [...tags, tag];
}

export function blockReasonValid(reason: string): boolean {
  const n = reason.trim().length;
  return n >= BLOCK_REASON_MIN && n <= BLOCK_REASON_MAX;
}

/* ---------------------------------------------------------------- Timeline */

export type TimelineItem =
  | { type: "message"; key: string; at: string; message: ChatMessage }
  | { type: "note"; key: string; at: string; note: AdminNote };

/** Messages and internal notes in one chronological list (ties: messages
 *  first, then by id). Notes are only ever rendered, never sent. */
export function mergeTimeline(messages: ChatMessage[], notes: AdminNote[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((message) => ({ type: "message" as const, key: `m${message.id}`, at: message.created_at, message })),
    ...notes.map((note) => ({ type: "note" as const, key: `n${note.id}`, at: note.created_at, note })),
  ];
  const id = (item: TimelineItem) => (item.type === "message" ? item.message.id : item.note.id);
  return items.sort((a, b) => {
    const dt = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (dt !== 0) return dt;
    if (a.type !== b.type) return a.type === "message" ? -1 : 1;
    return id(a) - id(b);
  });
}

/** Notes older than the oldest loaded message belong to history not yet
 *  scrolled in; hide them until those messages load so the order stays true. */
export function visibleNotes(notes: AdminNote[], messages: ChatMessage[], hasOlder: boolean): AdminNote[] {
  if (!hasOlder || messages.length === 0) return notes;
  const oldest = Math.min(...messages.map((m) => new Date(m.created_at).getTime()));
  return notes.filter((n) => new Date(n.created_at).getTime() >= oldest);
}

/* ---------------------------------------------------------------- Keyboard */

/** ⌘↵ / Ctrl+↵ sends from the composer. */
export function isSendShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; isComposing?: boolean }): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing;
}

export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}

/** Same look as the shared Input, for the few fields that need a ref. */
export const INPUT_CLASS = "w-full rounded-lg border border-line bg-surface px-3 text-fg placeholder:text-placeholder transition-colors focus:border-iris focus:bg-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-iris/30";

/* ---------------------------------------------------------------- List */

export function dedupeTickets<T extends { id: string }>(pages: { items: T[] }[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) for (const item of page.items) if (!seen.has(item.id)) { seen.add(item.id); out.push(item); }
  return out;
}

/** Row headline: the shop name / email the desk knows the requester by. */
export function ticketTitle(t: Pick<AdminTicket, "requester" | "counterpart">): string {
  return t.requester?.email || t.counterpart.label;
}

export function ticketPreview(t: Pick<AdminTicket, "subject" | "last_message_preview" | "last_message">): string {
  return t.last_message_preview || t.subject || t.last_message?.body || (t.last_message?.attachments?.length ? "[Ảnh]" : "");
}
