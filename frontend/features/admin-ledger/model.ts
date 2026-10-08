import type { LedgerQueryParams } from "@/lib/api";
import type { LedgerActor, LedgerDirection, LedgerRole } from "@/lib/types";

// ============================================================
// Tài chính › Dòng tiền — URL state, kỳ báo cáo, nhãn loại giao dịch.
// Mọi bộ lọc sống trên URL để link dán cho người khác mở đúng màn hình.
// ============================================================

export const PERIODS = [
  { key: "today", label: "Hôm nay" },
  { key: "7d", label: "7 ngày" },
  { key: "30d", label: "30 ngày" },
  { key: "month", label: "Tháng này" },
  { key: "all", label: "Toàn bộ" },
  { key: "custom", label: "Tuỳ chọn" },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

export const DIRECTIONS: { key: LedgerDirection | null; label: string }[] = [
  { key: null, label: "Tất cả" },
  { key: "in", label: "Vào" },
  { key: "out", label: "Ra" },
  // Chuyển khoản rút tiền và phí rút: trừ từ tiền đang khoá, không đụng số dư khả dụng.
  { key: "neutral", label: "Trừ từ tiền khoá" },
];

export const ROLE_LABEL: Record<LedgerRole, string> = { buyer: "Người mua", seller: "Người bán", platform: "Ví sàn" };

/** Nhãn theo loại giao dịch backend (models.wallet.TransactionType) — cùng tên
 *  người mua/bán thấy ở Biến động số dư (`transactions.label` trong vi.json),
 *  để admin và khách nói cùng một thứ. tests/admin-ledger-model.test.ts giữ chúng khớp. */
export const TYPE_LABEL: Record<string, string> = {
  deposit: "Nạp tiền",
  topup: "GMMO cộng tiền",
  purchase_hold: "Thanh toán đơn mua",
  purchase_release: "Tiền bán hàng về ví",
  platform_fee: "Phí nền tảng",
  refund: "Hoàn tiền đơn mua",
  withdraw_lock: "Yêu cầu rút tiền",
  withdraw_unlock: "Trả lại tiền rút bị từ chối",
  withdraw: "Chuyển khoản rút tiền",
  withdraw_fee: "Phí rút tiền",
  affiliate_commission: "Hoa hồng giới thiệu",
  affiliate_clawback: "Thu hồi hoa hồng giới thiệu",
  adjustment_credit: "GMMO điều chỉnh cộng",
  adjustment_debit: "GMMO điều chỉnh trừ",
  promo_subsidy: "Sàn bù khuyến mãi cho đơn bán",
};
export const TYPE_KEYS = Object.keys(TYPE_LABEL);

/** `group` lets the platform's share of a withdrawal fee read as what it is. */
export function typeLabel(type: string, actor?: LedgerActor, group?: string | null): string {
  if (type === "topup" && actor === "demo") return "Nạp thử (demo)";
  if (type === "platform_fee" && group?.startsWith("withdraw:")) return TYPE_LABEL.withdraw_fee;
  return TYPE_LABEL[type] ?? type;
}

// Chỉ cộng/trừ tay mang lý do admin tự gõ; mô tả hệ thống của các dòng khác
// (kể cả dòng rút tiền do admin duyệt) chỉ lặp lại tên loại, có khi bằng tiếng Anh.
const MANUAL_TYPES = new Set(["topup", "adjustment_credit", "adjustment_debit"]);

export function hasAdminNote(e: { type: string; actor: LedgerActor; description: string | null }): boolean {
  return e.actor === "admin" && MANUAL_TYPES.has(e.type) && !!e.description;
}

export const ACTOR_LABEL: Record<LedgerActor, string> = {
  admin: "Admin", system: "Hệ thống", user: "Chủ ví", demo: "Demo",
};

export type Tone = "good" | "warn" | "bad" | "iris" | "neutral";

/**
 * Màu theo ý nghĩa nghiệp vụ (DESIGN §9 Status): tiền vào ví = good, tiền
 * đang bị giữ/khoá = warn, tiền bị lấy lại/trừ = bad, tiền sàn chuyển trong
 * hệ thống (giải ngân, phí, hoa hồng) = iris, tiền đã rời sàn = neutral.
 */
export const TYPE_TONE: Record<string, Tone> = {
  deposit: "good",
  topup: "good",
  adjustment_credit: "good",
  refund: "good",
  withdraw_unlock: "good",
  purchase_hold: "warn",
  withdraw_lock: "warn",
  purchase_release: "iris",
  platform_fee: "iris",
  affiliate_commission: "iris",
  promo_subsidy: "iris",
  adjustment_debit: "bad",
  affiliate_clawback: "bad",
  withdraw: "neutral",
  withdraw_fee: "neutral",
};

/** Admin thao tác tay cần được nhìn thấy ngay; còn lại là luồng tự động. */
export const ACTOR_TONE: Record<LedgerActor, Tone> = { admin: "warn", user: "iris", system: "neutral", demo: "neutral" };

export const ACTORS: LedgerActor[] = ["admin", "user", "system", "demo"];

export interface LedgerQuery {
  period: PeriodKey;
  from: string | null; // YYYY-MM-DD (giờ VN), chỉ dùng với custom
  to: string | null;   // YYYY-MM-DD, bao gồm cả ngày này
  dir: LedgerDirection | null;
  types: string[];
  role: LedgerRole | null;
  account: number | null;
  group: string | null;
  amount: number | null;
  entry: number | null;
  actor: LedgerActor | null;
}

export const DEFAULT_QUERY: LedgerQuery = {
  period: "30d", from: null, to: null, dir: null, types: [], role: null,
  account: null, group: null, amount: null, entry: null, actor: null,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GROUP = /^(order|deposit|withdraw):\d{1,12}$/;

function positiveInt(raw: string | null): number | null {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

/** URL → bộ lọc. Giá trị lạ rơi về mặc định thay vì làm hỏng trang. */
export function parseQuery(params: URLSearchParams): LedgerQuery {
  const period = params.get("period");
  const dir = params.get("dir");
  const role = params.get("role");
  const from = params.get("from");
  const to = params.get("to");
  const group = params.get("group");
  const actor = params.get("actor");
  return {
    period: PERIODS.some((p) => p.key === period) ? (period as PeriodKey) : DEFAULT_QUERY.period,
    from: from && DATE.test(from) ? from : null,
    to: to && DATE.test(to) ? to : null,
    dir: dir === "in" || dir === "out" || dir === "neutral" ? dir : null,
    types: (params.get("types") ?? "").split(",").filter((t) => t in TYPE_LABEL),
    role: role === "buyer" || role === "seller" || role === "platform" ? role : null,
    account: positiveInt(params.get("account")),
    group: group && GROUP.test(group) ? group : null,
    amount: positiveInt(params.get("amount")),
    entry: positiveInt(params.get("entry")),
    actor: actor === "admin" || actor === "system" || actor === "user" || actor === "demo" ? actor : null,
  };
}

export function queryToParams(q: LedgerQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.period !== DEFAULT_QUERY.period) p.set("period", q.period);
  if (q.period === "custom") {
    if (q.from) p.set("from", q.from);
    if (q.to) p.set("to", q.to);
  }
  if (q.dir) p.set("dir", q.dir);
  if (q.types.length) p.set("types", q.types.join(","));
  if (q.role) p.set("role", q.role);
  if (q.account) p.set("account", String(q.account));
  if (q.group) p.set("group", q.group);
  if (q.amount) p.set("amount", String(q.amount));
  if (q.entry) p.set("entry", String(q.entry));
  if (q.actor) p.set("actor", q.actor);
  return p;
}

// Việt Nam không đổi giờ mùa hè: mốc ngày luôn là +07:00.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Ngày hôm nay theo giờ VN, dạng YYYY-MM-DD. */
export function vnToday(now = new Date()): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function vnStartOf(day: string): string {
  return `${day}T00:00:00+07:00`;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Kỳ đang chọn → [start, end) ISO có múi giờ; end rỗng = tới hiện tại. */
export function periodRange(q: LedgerQuery, now = new Date()): { start?: string; end?: string } {
  const today = vnToday(now);
  switch (q.period) {
    case "today": return { start: vnStartOf(today) };
    case "7d": return { start: vnStartOf(addDays(today, -6)) };
    case "30d": return { start: vnStartOf(addDays(today, -29)) };
    case "month": return { start: vnStartOf(`${today.slice(0, 7)}-01`) };
    case "all": return {};
    case "custom": {
      const from = q.from ?? today;
      const to = q.to && q.to >= from ? q.to : from;
      // `to` tính trọn ngày: kết thúc lúc 00:00 ngày hôm sau, và không vượt quá hôm nay.
      return { start: vnStartOf(from), end: to >= today ? undefined : vnStartOf(addDays(to, 1)) };
    }
  }
}

/** Bộ lọc → tham số API (dùng chung cho danh sách và tổng hợp). */
export function apiParams(q: LedgerQuery, now = new Date()): LedgerQueryParams {
  const range = periodRange(q, now);
  // Tìm đúng một giao dịch / một sự kiện thì bỏ qua kỳ: người dùng dán mã, muốn thấy nó.
  const pinned = q.entry !== null || q.group !== null;
  return {
    ...(pinned ? {} : range),
    direction: q.dir ?? undefined,
    type: q.types.length ? q.types : undefined,
    role: q.role ?? undefined,
    account_id: q.account ?? undefined,
    group: q.group ?? undefined,
    amount: q.amount ?? undefined,
    entry_id: q.entry ?? undefined,
    actor: q.actor ?? undefined,
  };
}

export function hasPinnedFilters(q: LedgerQuery): boolean {
  return Boolean(q.account || q.group || q.amount || q.entry || q.dir || q.role || q.actor || q.types.length);
}

export function groupKind(key: string): "order" | "deposit" | "withdraw" {
  return key.split(":")[0] as "order" | "deposit" | "withdraw";
}
