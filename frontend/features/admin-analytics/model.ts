import type {
  AnalyticsCompare,
  AnalyticsGranularity,
  AnalyticsRangeKey,
  AnalyticsSegment,
  BusinessAnalytics,
  BusinessAnalyticsQuery,
  BusinessMoney,
  BusinessPoint,
} from "@/lib/types";

// ── URL state ────────────────────────────────────────────────────────────────

export type AnalyticsTab = "overview" | "revenue" | "sellers" | "catalog" | "operations" | "milestones";
export const TABS: { key: AnalyticsTab; label: string }[] = [
  { key: "overview", label: "Tổng quan" },
  { key: "revenue", label: "Doanh thu" },
  { key: "sellers", label: "Seller" },
  { key: "catalog", label: "Danh mục & sản phẩm" },
  { key: "operations", label: "Vận hành & khách hàng" },
  { key: "milestones", label: "Cột mốc" },
];

export interface AnalyticsState {
  range: AnalyticsRangeKey;
  from?: string;
  to?: string;
  granularity: AnalyticsGranularity | "auto";
  compare: AnalyticsCompare;
  compareFrom?: string;
  compareTo?: string;
  segment: AnalyticsSegment;
  sellerId?: number;
  categoryId?: number;
  serviceType?: string;
  tab: AnalyticsTab;
  metric: MetricKey;
}

export const DEFAULT_STATE: AnalyticsState = {
  range: "30d",
  granularity: "auto",
  compare: "previous",
  segment: "all",
  tab: "overview",
  metric: "gmv",
};

export const RANGE_GROUPS: { label: string; items: { key: AnalyticsRangeKey; label: string }[] }[] = [
  {
    label: "Gần đây",
    items: [
      { key: "today", label: "Hôm nay" },
      { key: "yesterday", label: "Hôm qua" },
      { key: "7d", label: "7 ngày" },
      { key: "30d", label: "30 ngày" },
      { key: "90d", label: "90 ngày" },
      { key: "12m", label: "12 tháng" },
    ],
  },
  {
    label: "Kỳ hiện tại",
    items: [
      { key: "this_week", label: "Tuần này" },
      { key: "this_month", label: "Tháng này" },
      { key: "this_quarter", label: "Quý này" },
      { key: "this_year", label: "Năm nay" },
    ],
  },
  {
    label: "Kỳ trước",
    items: [
      { key: "last_week", label: "Tuần trước" },
      { key: "last_month", label: "Tháng trước" },
      { key: "last_quarter", label: "Quý trước" },
      { key: "last_year", label: "Năm trước" },
    ],
  },
];
const RANGE_KEYS = new Set<string>(RANGE_GROUPS.flatMap((g) => g.items.map((i) => i.key)).concat("custom"));

export const GRANULARITIES: { key: AnalyticsGranularity | "auto"; label: string }[] = [
  { key: "auto", label: "Tự động" },
  { key: "day", label: "Ngày" },
  { key: "week", label: "Tuần" },
  { key: "month", label: "Tháng" },
  { key: "quarter", label: "Quý" },
  { key: "year", label: "Năm" },
];

export const COMPARE_OPTIONS: { key: AnalyticsCompare; label: string }[] = [
  { key: "previous", label: "Kỳ trước" },
  { key: "yoy", label: "Cùng kỳ năm trước" },
  { key: "custom", label: "Kỳ tuỳ chọn" },
  { key: "none", label: "Không so sánh" },
];

export const SEGMENTS: { key: AnalyticsSegment; label: string }[] = [
  { key: "all", label: "Toàn sàn" },
  { key: "external", label: "Seller đối tác" },
  { key: "internal", label: "Seller nội bộ" },
];

export const MAX_DAYS = 1830;
const MAX_BUCKETS = 400;
const BUCKET_DAYS: Record<AnalyticsGranularity, number> = { day: 1, week: 7, month: 30, quarter: 91, year: 365 };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(value: string | null | undefined): value is string {
  return !!value && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function positiveInt(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n > 0 ? n : undefined;
}

function pick<T extends string>(value: string | null, allowed: readonly { key: T }[], fallback: T): T {
  return allowed.some((o) => o.key === value) ? (value as T) : fallback;
}

/** URL → state. Anything malformed falls back to defaults so a shared link
 *  never produces a 400 from the API. */
export function parseState(search: URLSearchParams): AnalyticsState {
  const state: AnalyticsState = { ...DEFAULT_STATE };
  const range = search.get("range");
  if (range === "custom") {
    const from = search.get("from");
    const to = search.get("to");
    if (isIsoDate(from) && isIsoDate(to) && from <= to) Object.assign(state, { range, from, to });
  } else if (range && RANGE_KEYS.has(range)) {
    state.range = range as AnalyticsRangeKey;
  }
  state.granularity = pick(search.get("g"), GRANULARITIES, "auto");
  state.compare = pick(search.get("cmp"), COMPARE_OPTIONS, "previous");
  if (state.compare === "custom") {
    const cf = search.get("cfrom");
    const ct = search.get("cto");
    if (isIsoDate(cf) && isIsoDate(ct) && cf <= ct) Object.assign(state, { compareFrom: cf, compareTo: ct });
    else state.compare = "previous";
  }
  state.segment = pick(search.get("seg"), SEGMENTS, "all");
  state.sellerId = positiveInt(search.get("seller"));
  state.categoryId = positiveInt(search.get("cat"));
  const svc = search.get("svc")?.trim();
  if (svc && /^[a-z0-9_-]{1,50}$/i.test(svc)) state.serviceType = svc;
  state.tab = pick(search.get("tab"), TABS, "overview");
  state.metric = pick(search.get("metric"), METRICS, "gmv");
  return state;
}

export function stateToSearch(state: AnalyticsState): string {
  const q = new URLSearchParams();
  if (state.range === "custom" && state.from && state.to) {
    q.set("range", "custom");
    q.set("from", state.from);
    q.set("to", state.to);
  } else if (state.range !== DEFAULT_STATE.range && state.range !== "custom") {
    q.set("range", state.range);
  }
  if (state.granularity !== "auto") q.set("g", state.granularity);
  if (state.compare === "custom" && state.compareFrom && state.compareTo) {
    q.set("cmp", "custom");
    q.set("cfrom", state.compareFrom);
    q.set("cto", state.compareTo);
  } else if (state.compare !== "previous" && state.compare !== "custom") {
    q.set("cmp", state.compare);
  }
  if (state.segment !== "all") q.set("seg", state.segment);
  if (state.sellerId) q.set("seller", String(state.sellerId));
  if (state.categoryId) q.set("cat", String(state.categoryId));
  if (state.serviceType) q.set("svc", state.serviceType);
  if (state.tab !== "overview") q.set("tab", state.tab);
  if (state.metric !== "gmv") q.set("metric", state.metric);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function stateToQuery(state: AnalyticsState, tz: string): BusinessAnalyticsQuery {
  return {
    range: state.range,
    tz,
    from: state.range === "custom" ? state.from : undefined,
    to: state.range === "custom" ? state.to : undefined,
    granularity: state.granularity,
    compare: state.compare,
    compare_from: state.compare === "custom" ? state.compareFrom : undefined,
    compare_to: state.compare === "custom" ? state.compareTo : undefined,
    segment: state.segment,
    seller_id: state.sellerId,
    category_id: state.categoryId,
    service_type: state.serviceType,
  };
}

export function activeFilterCount(state: AnalyticsState): number {
  return [state.segment !== "all", state.sellerId, state.categoryId, state.serviceType].filter(Boolean).length;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Bucket sizes that keep the chart under the API's bucket cap. */
export function granularityAllowed(g: AnalyticsGranularity | "auto", days: number): boolean {
  return g === "auto" || Math.ceil(days / BUCKET_DAYS[g]) <= MAX_BUCKETS;
}

export function customRangeError(from?: string, to?: string): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return "Chọn đủ ngày bắt đầu và kết thúc";
  if (to < from) return "Ngày kết thúc phải sau ngày bắt đầu";
  if (daysBetween(from, to) > MAX_DAYS) return "Tối đa 5 năm";
  return null;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function localIsoDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export type MetricKey =
  | "gmv" | "net_gmv" | "platform_revenue" | "platform_fee" | "internal_sales" | "paid_orders" | "orders"
  | "aov" | "buyers" | "new_buyers" | "take_rate" | "refund_rate" | "dispute_rate" | "cancel_rate"
  | "internal_share" | "sellers" | "deposits" | "withdrawals_paid" | "signups";

export type MetricKind = "money" | "count" | "rate";

export interface MetricDef {
  key: MetricKey;
  label: string;
  short?: string;
  kind: MetricKind;
  /** Which direction is healthy — drives the colour of the change badge. */
  better: "up" | "down" | "neutral";
  hint: string;
  value: (m: BusinessMoney) => number;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

export const METRICS: MetricDef[] = [
  { key: "gmv", label: "GMV", kind: "money", better: "up", hint: "Tổng giá trị đơn đã thanh toán (đã giao, hoàn tất, khiếu nại, hoàn tiền) theo ngày tạo đơn.", value: (m) => m.gmv },
  { key: "net_gmv", label: "GMV thuần", kind: "money", better: "up", hint: "GMV trừ tiền đã hoàn cho người mua.", value: (m) => m.net_gmv },
  { key: "platform_revenue", label: "Doanh thu sàn", kind: "money", better: "up", hint: "Phí sàn + doanh số seller nội bộ đã quyết toán − hoa hồng affiliate. Tính theo thời điểm giải ngân.", value: (m) => m.platform_revenue },
  { key: "platform_fee", label: "Phí sàn", kind: "money", better: "up", hint: "Phí thu từ seller đối tác khi giải ngân ký quỹ.", value: (m) => m.platform_fee },
  { key: "internal_sales", label: "Doanh số nội bộ", kind: "money", better: "up", hint: "Tiền giải ngân cho seller nội bộ — toàn bộ thuộc về sàn.", value: (m) => m.internal_sales },
  { key: "paid_orders", label: "Đơn thành công", kind: "count", better: "up", hint: "Số đơn đã thanh toán trong kỳ.", value: (m) => m.paid_orders },
  { key: "orders", label: "Tổng đơn tạo", kind: "count", better: "up", hint: "Mọi đơn tạo trong kỳ, kể cả chờ xử lý và đã huỷ.", value: (m) => m.orders },
  { key: "aov", label: "Giá trị đơn TB", short: "AOV", kind: "money", better: "up", hint: "GMV ÷ số đơn thành công.", value: (m) => Math.round(ratio(m.gmv, m.paid_orders)) },
  { key: "buyers", label: "Người mua", kind: "count", better: "up", hint: "Số người mua khác nhau có đơn thành công.", value: (m) => m.buyers },
  { key: "new_buyers", label: "Người mua mới", kind: "count", better: "up", hint: "Người mua có đơn thành công đầu tiên trong kỳ.", value: (m) => m.new_buyers },
  { key: "take_rate", label: "Take rate", kind: "rate", better: "up", hint: "Doanh thu sàn ÷ GMV.", value: (m) => ratio(m.platform_revenue, m.gmv) },
  { key: "refund_rate", label: "Tỷ lệ hoàn tiền", kind: "rate", better: "down", hint: "Tiền hoàn ÷ GMV.", value: (m) => ratio(m.refunded, m.gmv) },
  { key: "dispute_rate", label: "Tỷ lệ khiếu nại", kind: "rate", better: "down", hint: "Đơn thành công từng bị khiếu nại ÷ đơn thành công.", value: (m) => ratio(m.disputed_orders, m.paid_orders) },
  { key: "cancel_rate", label: "Tỷ lệ huỷ", kind: "rate", better: "down", hint: "Đơn huỷ ÷ tổng đơn tạo.", value: (m) => ratio(m.cancelled, m.orders) },
  { key: "internal_share", label: "Tỷ trọng nội bộ", kind: "rate", better: "neutral", hint: "GMV của seller nội bộ ÷ GMV.", value: (m) => ratio(m.internal_gmv, m.gmv) },
  { key: "sellers", label: "Seller có đơn", kind: "count", better: "up", hint: "Seller có ít nhất một đơn thành công trong kỳ.", value: (m) => m.sellers },
  { key: "deposits", label: "Tiền nạp", kind: "money", better: "up", hint: "Nạp qua cổng thanh toán (toàn sàn, không theo bộ lọc).", value: (m) => m.deposits },
  { key: "withdrawals_paid", label: "Tiền rút đã chi", kind: "money", better: "neutral", hint: "Tiền đã chuyển cho seller (toàn sàn, không theo bộ lọc).", value: (m) => m.withdrawals_paid },
  { key: "signups", label: "Đăng ký mới", kind: "count", better: "up", hint: "Tài khoản mới (toàn sàn, không theo bộ lọc).", value: (m) => m.signups },
];
export const METRIC: Record<MetricKey, MetricDef> = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<MetricKey, MetricDef>;

/** Metrics the trend chart can switch between. */
export const TREND_METRICS: MetricKey[] = [
  "gmv", "platform_revenue", "net_gmv", "paid_orders", "aov", "buyers", "new_buyers", "take_rate", "refund_rate", "dispute_rate",
];

export interface Delta {
  /** Absolute change (for rates: percentage points × 100 → pp). */
  diff: number;
  /** Relative change, null when the baseline is zero. */
  pct: number | null;
  tone: "good" | "bad" | "neutral";
}

export function delta(current: number, previous: number | null | undefined, better: MetricDef["better"] = "up"): Delta | null {
  if (previous === null || previous === undefined) return null;
  const diff = current - previous;
  const pct = previous !== 0 ? diff / Math.abs(previous) : null;
  // Changes that round to zero in the UI (<0.05% or <0.05 points) stay neutral.
  const negligible = pct !== null ? Math.abs(pct) < 0.0005 : Math.abs(diff) < 0.0005 && Math.abs(current) < 1;
  let tone: Delta["tone"] = "neutral";
  if (better !== "neutral" && diff !== 0 && !negligible) {
    tone = (diff > 0) === (better === "up") ? "good" : "bad";
  }
  return { diff, pct, tone };
}

// ── Formatting ───────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat("vi-VN");
const nf1 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

export function formatCount(v: number): string {
  return nf.format(Math.round(v));
}

export function formatMoney(v: number): string {
  return `${nf.format(Math.round(v))} ₫`;
}

/** 1.234.567.890 → "1,2 tỷ"; for axes, tiles and tight labels. */
export function compactMoney(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}${nf1.format(a / 1e9)} tỷ`;
  if (a >= 1e6) return `${sign}${nf1.format(a / 1e6)} tr`;
  if (a >= 1e3) return `${sign}${nf1.format(a / 1e3)} N`;
  return `${sign}${nf.format(a)}`;
}

export function formatRate(v: number, digits = 1): string {
  return `${(v * 100).toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function formatMetric(def: MetricDef, v: number, compact = false): string {
  if (def.kind === "rate") return formatRate(v);
  if (def.kind === "money") return compact ? compactMoney(v) : formatMoney(v);
  return formatCount(v);
}

export function formatDelta(def: MetricDef, d: Delta): string {
  if (def.kind === "rate") {
    const pp = Math.round(d.diff * 1000) / 10;
    return `${pp > 0 ? "+" : pp < 0 ? "−" : "±"}${Math.abs(pp).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} điểm`;
  }
  if (d.pct === null) return d.diff === 0 ? "±0" : "mới";
  const p = Math.abs(d.pct) < 0.1 ? Math.round(d.pct * 1000) / 10 : Math.round(d.pct * 100);
  return `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p).toLocaleString("vi-VN", { maximumFractionDigits: Math.abs(p) < 10 ? 1 : 0 })}%`;
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

/** Bucket start → short axis label in the bucket's own unit. */
export function bucketLabel(iso: string, g: AnalyticsGranularity): string {
  const [y, m, d] = parts(iso);
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  switch (g) {
    case "day":
      return `${dd}/${mm}`;
    case "week":
      return `T${isoWeek(y, m, d)} · ${dd}/${mm}`;
    case "month":
      return `Th${m}/${String(y).slice(2)}`;
    case "quarter":
      return `Q${Math.floor((m - 1) / 3) + 1}/${y}`;
    case "year":
      return String(y);
  }
}

/** Full label for tooltips and tables: "Tuần 39 (22/09 – 28/09/2026)". */
export function bucketTitle(point: Pick<BusinessPoint, "date" | "end_date">, g: AnalyticsGranularity): string {
  const [y, m, d] = parts(point.date);
  const [ey, em, ed] = parts(point.end_date);
  const day = (dd: number, mm: number, yy?: number) =>
    `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}${yy ? `/${yy}` : ""}`;
  switch (g) {
    case "day":
      return `${weekdayName(y, m, d)}, ${day(d, m, y)}`;
    case "week":
      return `Tuần ${isoWeek(y, m, d)} (${day(d, m)} – ${day(ed, em, ey)})`;
    case "month":
      return `Tháng ${m}/${y}`;
    case "quarter":
      return `Quý ${Math.floor((m - 1) / 3) + 1}/${y}`;
    case "year":
      return `Năm ${y}`;
  }
}

export function formatRangeLabel(from: string, to: string): string {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  const f = `${String(fd).padStart(2, "0")}/${String(fm).padStart(2, "0")}`;
  const t = `${String(td).padStart(2, "0")}/${String(tm).padStart(2, "0")}/${ty}`;
  if (from === to) return t;
  return fy === ty ? `${f} – ${t}` : `${f}/${fy} – ${t}`;
}

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
function weekdayName(y: number, m: number, d: number): string {
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function isoWeek(y: number, m: number, d: number): number {
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export const TIER_LABEL: Record<string, string> = {
  new: "Mới", verified: "Đã xác minh", trusted: "Uy tín", enterprise: "Doanh nghiệp",
};
export const TIER_ORDER = ["new", "verified", "trusted", "enterprise"];

export const SERVICE_LABEL: Record<string, string> = {
  proxy: "Proxy", account: "Tài khoản", token: "Token", endpoint: "API endpoint",
  takedown: "Takedown", cloud: "Cloud", payment: "Thanh toán", other: "Khác",
};

export const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xử lý", processing: "Đang xử lý", delivered: "Đã giao (ký quỹ)", completed: "Hoàn tất",
  disputed: "Khiếu nại", refunded: "Hoàn tiền", cancelled: "Đã huỷ",
};

// ── Insights: "where is the problem?" ────────────────────────────────────────

export type InsightSeverity = "bad" | "warn" | "good" | "info";
export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** Where the admin should look next. */
  action?: { label: string; patch: Partial<AnalyticsState> };
}

const SEVERITY_RANK: Record<InsightSeverity, number> = { bad: 0, warn: 1, good: 2, info: 3 };

/** Rule-based reading of the numbers. Thresholds are deliberately simple and
 *  documented here so an admin can trust (and argue with) every flag. */
export function buildInsights(data: BusinessAnalytics): Insight[] {
  const out: Insight[] = [];
  const t = data.totals;
  const p = data.compare_totals;
  const pctText = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`;

  if (p && p.gmv > 0) {
    const change = (t.gmv - p.gmv) / p.gmv;
    if (change <= -0.15) {
      out.push({
        id: "gmv-drop", severity: "bad", title: `GMV giảm ${pctText(change)} so với kỳ so sánh`,
        detail: `${compactMoney(t.gmv)} so với ${compactMoney(p.gmv)}. Xem danh mục và seller sụt mạnh nhất để khoanh vùng.`,
        action: { label: "Xem danh mục", patch: { tab: "catalog" } },
      });
    } else if (change >= 0.15) {
      out.push({
        id: "gmv-up", severity: "good", title: `GMV tăng ${pctText(change)} so với kỳ so sánh`,
        detail: `${compactMoney(t.gmv)} so với ${compactMoney(p.gmv)}.`,
      });
    }
  } else if (p && p.gmv === 0 && t.gmv > 0) {
    out.push({ id: "gmv-new", severity: "info", title: "Kỳ so sánh chưa có doanh số", detail: "Không có mốc để tính tăng trưởng — hãy chọn kỳ so sánh khác." });
  }

  const refundRate = ratio(t.refunded, t.gmv);
  const prevRefund = p ? ratio(p.refunded, p.gmv) : 0;
  if (t.gmv > 0 && (refundRate >= 0.05 || (p && refundRate - prevRefund >= 0.02))) {
    out.push({
      id: "refund", severity: refundRate >= 0.1 ? "bad" : "warn",
      title: `Tỷ lệ hoàn tiền ${formatRate(refundRate)}`,
      detail: p ? `Kỳ so sánh: ${formatRate(prevRefund)}. Hoàn ${compactMoney(t.refunded)} trên ${formatCount(t.refunded_orders)} đơn.` : `Hoàn ${compactMoney(t.refunded)} trên ${formatCount(t.refunded_orders)} đơn.`,
      action: { label: "Xem vận hành", patch: { tab: "operations" } },
    });
  }

  const disputeRate = ratio(t.disputed_orders, t.paid_orders);
  if (t.paid_orders >= 10 && disputeRate >= 0.03) {
    out.push({
      id: "dispute", severity: disputeRate >= 0.06 ? "bad" : "warn",
      title: `Tỷ lệ khiếu nại ${formatRate(disputeRate)}`,
      detail: `${formatCount(t.disputed_orders)} / ${formatCount(t.paid_orders)} đơn thành công từng bị khiếu nại.`,
      action: { label: "Xem seller", patch: { tab: "sellers" } },
    });
  }

  const cancelRate = ratio(t.cancelled, t.orders);
  if (t.orders >= 10 && cancelRate >= 0.1) {
    out.push({
      id: "cancel", severity: cancelRate >= 0.2 ? "bad" : "warn",
      title: `${formatRate(cancelRate)} đơn bị huỷ`,
      detail: "Đơn huỷ thường do hết hàng hoặc nhà cung cấp lỗi — kiểm tra tồn kho và nguồn cung.",
      action: { label: "Xem vận hành", patch: { tab: "operations" } },
    });
  }

  const c = data.concentration;
  if (c.sellers >= 3 && c.top1 >= 0.4) {
    const top = data.top_sellers[0];
    out.push({
      id: "concentration", severity: c.top1 >= 0.6 ? "bad" : "warn",
      title: `Phụ thuộc một seller: ${formatRate(c.top1, 0)} GMV`,
      detail: `${top ? `${top.name} ` : ""}chiếm phần lớn doanh số. Top 5 seller: ${formatRate(c.top5, 0)}.`,
      action: top ? { label: "Lọc seller này", patch: { sellerId: top.id, tab: "overview" } } : undefined,
    });
  }

  const drops = data.categories
    .filter((r) => r.gmv_prev >= Math.max(1, (p?.gmv ?? 0) * 0.05) && r.gmv < r.gmv_prev * 0.75)
    .sort((a, b) => (a.gmv - a.gmv_prev) - (b.gmv - b.gmv_prev))
    .slice(0, 2);
  for (const r of drops) {
    out.push({
      id: `cat-${r.id}`, severity: "warn",
      title: `Danh mục “${r.name}” giảm ${pctText((r.gmv - r.gmv_prev) / r.gmv_prev)}`,
      detail: `${compactMoney(r.gmv)} so với ${compactMoney(r.gmv_prev)} kỳ trước.`,
      action: r.id ? { label: "Lọc danh mục", patch: { categoryId: r.id } } : undefined,
    });
  }

  const seller = data.declining_sellers[0];
  if (seller && p && p.gmv > 0 && seller.gmv_prev - seller.gmv >= p.gmv * 0.05) {
    out.push({
      id: `seller-${seller.id}`, severity: "warn",
      title: `Seller ${seller.name} mất ${compactMoney(seller.gmv_prev - seller.gmv)} doanh số`,
      detail: `${compactMoney(seller.gmv)} so với ${compactMoney(seller.gmv_prev)} — ${formatRate(ratio(seller.gmv_prev - seller.gmv, p.gmv), 0)} GMV kỳ trước của sàn.`,
      action: { label: "Lọc seller", patch: { sellerId: seller.id } },
    });
  }

  if (p && p.buyers > 0 && t.buyers < p.buyers * 0.85) {
    out.push({
      id: "buyers", severity: "warn",
      title: `Người mua giảm ${pctText((t.buyers - p.buyers) / p.buyers)}`,
      detail: `${formatCount(t.buyers)} người mua (${formatCount(t.new_buyers)} mới) so với ${formatCount(p.buyers)}.`,
      action: { label: "Xem khách hàng", patch: { tab: "operations" } },
    });
  }

  if (t.gmv > 0 && p && p.gmv > 0) {
    const take = ratio(t.platform_revenue, t.gmv);
    const prevTake = ratio(p.platform_revenue, p.gmv);
    if (prevTake - take >= 0.01) {
      out.push({
        id: "take", severity: "warn",
        title: `Take rate giảm còn ${formatRate(take)}`,
        detail: `Kỳ so sánh ${formatRate(prevTake)}. Kiểm tra phí danh mục, hạng seller và hoa hồng affiliate.`,
        action: { label: "Xem doanh thu", patch: { tab: "revenue" } },
      });
    }
  }

  if (t.withdrawals_paid > 0 && t.deposits > 0 && t.withdrawals_paid > t.deposits * 1.2) {
    out.push({
      id: "cash", severity: "info",
      title: "Tiền rút vượt tiền nạp",
      detail: `Đã chi ${compactMoney(t.withdrawals_paid)}, nạp vào ${compactMoney(t.deposits)} trong kỳ.`,
      action: { label: "Xem dòng tiền", patch: { tab: "revenue" } },
    });
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ── Milestones: each bucket vs the one before it ─────────────────────────────

export interface MilestoneRow {
  point: BusinessPoint;
  compare?: BusinessPoint;
  values: Record<MetricKey, number>;
  prevBucket?: Record<MetricKey, number>;
  compareValues?: Record<MetricKey, number>;
}

export const MILESTONE_METRICS: MetricKey[] = [
  "gmv", "platform_revenue", "paid_orders", "aov", "buyers", "new_buyers", "refund_rate", "internal_share",
];

function valuesOf(m: BusinessMoney): Record<MetricKey, number> {
  return Object.fromEntries(METRICS.map((d) => [d.key, d.value(m)])) as Record<MetricKey, number>;
}

export function milestoneRows(data: BusinessAnalytics): MilestoneRow[] {
  return data.series.map((point, i) => ({
    point,
    compare: data.compare_series[i],
    values: valuesOf(point),
    prevBucket: i > 0 ? valuesOf(data.series[i - 1]) : undefined,
    compareValues: data.compare_series[i] ? valuesOf(data.compare_series[i]) : undefined,
  }));
}

// ── CSV export ───────────────────────────────────────────────────────────────

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

export function seriesCsv(data: BusinessAnalytics): string {
  const cols: MetricKey[] = [
    "gmv", "net_gmv", "platform_revenue", "platform_fee", "internal_sales", "paid_orders", "orders", "aov",
    "buyers", "new_buyers", "take_rate", "refund_rate", "dispute_rate", "cancel_rate", "internal_share",
    "deposits", "withdrawals_paid", "signups",
  ];
  const header = ["Mốc", "Từ ngày", "Đến ngày", ...cols.map((k) => METRIC[k].label), ...cols.map((k) => `${METRIC[k].label} (kỳ so sánh)`)];
  const rows = milestoneRows(data).map((r) => [
    bucketTitle(r.point, data.range.granularity), r.point.date, r.point.end_date,
    ...cols.map((k) => (METRIC[k].kind === "rate" ? Number(r.values[k].toFixed(4)) : r.values[k])),
    ...cols.map((k) => (r.compareValues ? (METRIC[k].kind === "rate" ? Number(r.compareValues[k].toFixed(4)) : r.compareValues[k]) : "")),
  ]);
  return toCsv([header, ...rows]);
}

export function sellersCsv(data: BusinessAnalytics): string {
  const header = ["ID", "Seller", "Email", "Loại", "Hạng", "GMV", "GMV kỳ trước", "Đơn", "Hoàn tiền", "Đơn khiếu nại", "Doanh thu sàn"];
  const rows = data.top_sellers.map((s) => [
    s.id, s.name, s.email ?? "", s.is_internal ? "Nội bộ" : "Đối tác", TIER_LABEL[s.tier] ?? s.tier,
    s.gmv, s.gmv_prev, s.paid_orders, s.refunded, s.disputed_orders, s.platform_take,
  ]);
  return toCsv([header, ...rows]);
}
