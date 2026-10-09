// Readable before → after rows for the admin settings audit events
// (fee & escrow config, seller tier rules, seller runtime config, system,
// affiliate, accounts, money, deposit rails, seller trust, ops bot) and for the
// two-step approval requests that carry the same diffs (config_change_*).
// Self-contained (no "@/…" runtime imports) so node tests can load it.

type Md = Record<string, unknown>;

export interface SettingChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

type Fmt = "pct" | "pp" | "days" | "hours" | "hold" | "minutes" | "mb" | "vnd" | "count" | "bool" | "account" | "limit" | "limitVnd" | "badge" | "text" | "datetime" | "list" | "level" | "affPct" | "affDays" | "feeOrDefault" | "criterion";

interface FieldSpec {
  label: string;
  fmt: Fmt;
  /** Per-category map ({category_id: value}); expanded into one row per category. */
  perCategory?: boolean;
}

export const SETTING_FIELDS: Record<string, FieldSpec> = {
  // fee_runtime_config
  platform_fee_percent: { label: "Phí sàn", fmt: "pct" },
  category_fee_percent: { label: "Phí sàn", fmt: "pct", perCategory: true },
  escrow_default_hours: { label: "Giữ tiền mặc định", fmt: "hold" },
  escrow_floor_hours: { label: "Sàn giữ tiền (mọi đơn)", fmt: "hold" },
  escrow_min_hours: { label: "Giữ tiền tối thiểu", fmt: "hold" },
  category_escrow_min_hours: { label: "Giữ tiền tối thiểu", fmt: "hold", perCategory: true },
  // Entries logged before holds moved from days to hours.
  escrow_default_days: { label: "Giữ tiền mặc định", fmt: "days" },
  escrow_min_days: { label: "Giữ tiền tối thiểu", fmt: "days" },
  category_escrow_min_days: { label: "Giữ tiền tối thiểu", fmt: "days", perCategory: true },
  withdraw_min_amount: { label: "Rút tối thiểu", fmt: "vnd" },
  withdraw_fee_fixed: { label: "Phí rút cố định", fmt: "vnd" },
  withdraw_fee_percent: { label: "Phí rút theo %", fmt: "pct" },
  dispute_seller_response_hours: { label: "Hạn người bán phản hồi khiếu nại", fmt: "hours" },
  dispute_open_window_hours: { label: "Thời gian tối đa mở khiếu nại", fmt: "hours" },
  dispute_evidence_image_required: { label: "Bắt buộc ảnh bằng chứng khiếu nại", fmt: "bool" },
  platform_account_id: { label: "Tài khoản nhận phí sàn", fmt: "account" },
  // seller_tier_config (per tier)
  max_active_products: { label: "Sản phẩm đang bán tối đa", fmt: "limit" },
  withdraw_limit_per_request: { label: "Hạn mức mỗi lệnh rút", fmt: "limitVnd" },
  fee_discount_pp: { label: "Giảm phí sàn", fmt: "pp" },
  escrow_reduction_hours: { label: "Giảm giờ giữ tiền", fmt: "hold" },
  fee_percent: { label: "Phí giao dịch", fmt: "feeOrDefault" },
  escrow_reduction_days: { label: "Giảm ngày giữ tiền", fmt: "days" },
  badge: { label: "Huy hiệu", fmt: "badge" },
  // seller_runtime_config
  low_stock_threshold: { label: "Ngưỡng báo sắp hết hàng", fmt: "count" },
  inventory_export_row_limit: { label: "Giới hạn dòng khi xuất kho", fmt: "count" },
  review_window_days: { label: "Thời hạn đánh giá", fmt: "days" },
  auto_review_days: { label: "Tự đánh giá sau", fmt: "days" },
  auto_review_enabled: { label: "Tự đánh giá", fmt: "bool" },
  // ops_telegram_config (token only as its "…ab12" hint)
  ops_enabled: { label: "Bot vận hành", fmt: "bool" },
  ops_bot_token: { label: "Token bot vận hành", fmt: "text" },
  ops_bot_username: { label: "Tên bot vận hành", fmt: "text" },
  ops_chat_id: { label: "Nhóm vận hành", fmt: "text" },
  ops_channel_chat_id: { label: "Kênh sản phẩm mới", fmt: "text" },
  ops_channel_enabled: { label: "Đăng lên kênh", fmt: "bool" },
  ops_channel_interval_minutes: { label: "Khoảng cách giữa 2 bài kênh", fmt: "minutes" },
  ops_quiet_low_priority: { label: "Gửi im lặng tin ít khẩn", fmt: "bool" },
  ops_status: { label: "Trạng thái bot vận hành", fmt: "text" },
  "ops_event.withdrawal_requested": { label: "Báo yêu cầu rút tiền", fmt: "bool" },
  "ops_event.dispute_opened": { label: "Báo khiếu nại mới", fmt: "bool" },
  "ops_event.dispute_timeout": { label: "Báo khiếu nại tự hoàn tiền", fmt: "bool" },
  "ops_event.deposit_unmatched": { label: "Báo tiền vào chưa khớp", fmt: "bool" },
  "ops_event.deposit_anomaly": { label: "Báo nạp tiền bất thường", fmt: "bool" },
  "ops_event.site_switch": { label: "Báo bảo trì / khoá giao dịch", fmt: "bool" },
  "ops_event.system_alert": { label: "Báo cảnh báo hệ thống", fmt: "bool" },
  "ops_event.seller_application": { label: "Báo đăng ký người bán", fmt: "bool" },
  // site_runtime_config (Hệ thống)
  maintenance_enabled: { label: "Bảo trì", fmt: "bool" },
  maintenance_message_vi: { label: "Thông điệp bảo trì (VI)", fmt: "text" },
  maintenance_message_en: { label: "Thông điệp bảo trì (EN)", fmt: "text" },
  maintenance_until: { label: "Bảo trì đến", fmt: "datetime" },
  withdrawals_frozen: { label: "Tạm ngưng rút tiền", fmt: "bool" },
  deposits_frozen: { label: "Tạm ngưng nạp tiền", fmt: "bool" },
  orders_frozen: { label: "Tạm ngưng mua hàng", fmt: "bool" },
  freeze_reason: { label: "Lý do tạm ngưng", fmt: "text" },
  announcement_enabled: { label: "Thanh thông báo", fmt: "bool" },
  announcement_format: { label: "Định dạng thông báo", fmt: "text" },
  announcement_level: { label: "Mức thông báo", fmt: "level" },
  announcement_text_vi: { label: "Nội dung thông báo (VI)", fmt: "text" },
  announcement_text_en: { label: "Nội dung thông báo (EN)", fmt: "text" },
  announcement_link_url: { label: "Liên kết thông báo", fmt: "text" },
  announcement_starts_at: { label: "Thông báo bắt đầu", fmt: "datetime" },
  announcement_ends_at: { label: "Thông báo kết thúc", fmt: "datetime" },
  media_max_upload_mb: { label: "Dung lượng ảnh tối đa", fmt: "mb" },
  // affiliate_runtime_config
  enabled: { label: "Bật affiliate", fmt: "bool" },
  commission_percent_of_fee: { label: "Hoa hồng giới thiệu (% phí sàn)", fmt: "affPct" },
  attribution_days: { label: "Thời gian ghi nhận giới thiệu", fmt: "days" },
  earning_days: { label: "Thời gian hưởng hoa hồng", fmt: "affDays" },
  max_commissions_per_day: { label: "Hoa hồng tối đa mỗi ngày", fmt: "count" },
  // auth_runtime_config
  require_email_verification: { label: "Bắt buộc xác minh email", fmt: "bool" },
  verification_link_hours: { label: "Hạn link xác minh", fmt: "hours" },
  mfa_feature_enabled: { label: "Bật xác thực 2 lớp", fmt: "bool" },
  require_admin_2fa: { label: "Bắt buộc 2FA cho admin", fmt: "bool" },
  require_2fa_for_withdrawal: { label: "Bắt buộc 2FA khi rút tiền", fmt: "bool" },
  turnstile_site_key: { label: "Turnstile site key", fmt: "text" },
  // display_money_config
  display_fx_rate: { label: "Tỷ giá hiển thị (₫ / 1 USD)", fmt: "vnd" },
  display_currency_default: { label: "Tiền tệ mặc định", fmt: "text" },
  allow_user_toggle: { label: "Cho khách đổi tiền tệ", fmt: "bool" },
  allow_locale_toggle: { label: "Cho khách đổi ngôn ngữ", fmt: "bool" },
  show_fx_hints: { label: "Hiện gợi ý quy đổi", fmt: "bool" },
  // deposit_rail_config
  sepay_enabled: { label: "Nạp qua chuyển khoản", fmt: "bool" },
  nowpayments_enabled: { label: "Nạp USDT", fmt: "bool" },
  sepay_bank_code: { label: "Ngân hàng nhận", fmt: "text" },
  sepay_bank_account_number: { label: "Số tài khoản nhận", fmt: "text" },
  sepay_bank_account_name: { label: "Tên tài khoản nhận", fmt: "text" },
  sepay_bank_account_id: { label: "Mã tài khoản SePay", fmt: "text" },
  sepay_previous_account_numbers: { label: "Số tài khoản cũ vẫn nhận", fmt: "list" },
  deposit_min_amount: { label: "Nạp chuyển khoản tối thiểu", fmt: "vnd" },
  deposit_max_amount: { label: "Nạp chuyển khoản tối đa", fmt: "vnd" },
  deposit_expire_minutes: { label: "Hạn yêu cầu nạp", fmt: "minutes" },
  deposit_reconcile_retention_hours: { label: "Đối soát nạp chuyển khoản trong", fmt: "hours" },
  deposit_usdt_min_vnd: { label: "Nạp USDT tối thiểu", fmt: "vnd" },
  deposit_usdt_max_vnd: { label: "Nạp USDT tối đa", fmt: "vnd" },
  deposit_usdt_local_window_minutes: { label: "Hạn thanh toán USDT", fmt: "minutes" },
  deposit_usdt_reconcile_retention_hours: { label: "Đối soát USDT trong", fmt: "hours" },
  // seller_trust_config (flattened document; criteria per tier below)
  window_days: { label: "Cửa sổ tính điểm uy tín", fmt: "days" },
  min_orders_for_score: { label: "Số đơn tối thiểu để chấm điểm", fmt: "count" },
  "auto.enabled": { label: "Xét hạng tự động", fmt: "bool" },
  "auto.grace_days": { label: "Thời gian ân hạn", fmt: "days" },
  "auto.dispute_min_orders": { label: "Số đơn tối thiểu xét khiếu nại", fmt: "count" },
  // buyer_tier_config (per level, "l2.min_amount")
  criterion: { label: "Điều kiện xét hạng người mua", fmt: "criterion" },
  ip_requests_per_minute: { label: "Request API mỗi IP/phút", fmt: "count" },
  name_vi: { label: "Tên (vi)", fmt: "text" },
  name_en: { label: "Tên (en)", fmt: "text" },
  min_amount: { label: "Ngưỡng", fmt: "vnd" },
  cashback_percent: { label: "Hoàn tiền", fmt: "pct" },
  api_requests_per_minute: { label: "API request/phút", fmt: "limit" },
  api_orders_per_minute: { label: "Đặt đơn API/phút", fmt: "limit" },
};

const TRUST_PART: Record<string, string> = {
  score: "Điểm uy tín", criteria: "Tiêu chí", dispute: "khiếu nại", one_star: "đánh giá 1 sao", gmv: "GMV",
  points: "điểm tối đa", zero_at_pct: "về 0 khi tỷ lệ đạt", full_at: "đủ điểm khi đạt",
  min_gmv: "GMV tối thiểu", min_orders: "số đơn tối thiểu", min_days: "số ngày bán tối thiểu",
  max_dispute_pct: "tỷ lệ khiếu nại tối đa", max_one_star_pct: "tỷ lệ 1 sao tối đa", min_score: "điểm tối thiểu",
};

/** Label and unit of a flattened trust-config key such as "criteria.trusted.min_gmv". */
function trustSpec(path: string): FieldSpec | null {
  if (!path.includes(".")) return null;
  const parts = path.split(".");
  const last = parts[parts.length - 1];
  const words = parts.map((p) => TRUST_PART[p] ?? (TIER_NAME[p] ? `hạng ${TIER_NAME[p]}` : p.replace(/_/g, " ")));
  const fmt: Fmt = last.endsWith("_pct") ? "pct" : last === "min_gmv" || last === "full_at" ? "vnd" : last === "min_days" ? "days" : "count";
  return { label: `${words[0]} · ${words.slice(1).join(" · ")}`, fmt };
}

/** {"score": {"gmv": {"points": 30}}} → {"score.gmv.points": 30} (same shape as the backend request diff). */
function flatten(doc: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (isObj(v) && Object.keys(v).length) Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

const LEVEL: Record<string, string> = { info: "Thông tin", warn: "Cảnh báo", danger: "Khẩn" };

export const TIER_NAME: Record<string, string> = {
  new: "Mới", verified: "Đã xác minh", trusted: "Uy tín", enterprise: "Doanh nghiệp",
};

/** Events whose metadata carries settings old/new values. */
export const SETTINGS_EVENTS: Record<string, string> = {
  fee_runtime_config_changed: "Đổi phí & giữ tiền",
  seller_tier_config_changed: "Đổi quy tắc hạng người bán",
  seller_runtime_config_changed: "Đổi cài đặt người bán",
  site_runtime_config_changed: "Đổi cài đặt hệ thống",
  affiliate_runtime_config_changed: "Đổi cài đặt affiliate",
  auth_runtime_config_changed: "Đổi cài đặt tài khoản & bảo mật",
  display_money_config_changed: "Đổi tiền tệ & tỷ giá",
  deposit_rail_config_changed: "Đổi kênh nạp tiền",
  seller_trust_config_changed: "Đổi điểm uy tín & xét hạng tự động",
  buyer_tier_config_changed: "Đổi hạng người mua",
  ops_telegram_config_changed: "Đổi bot vận hành",
  affiliate_account_terms_changed: "Đổi hoa hồng riêng (KOL)",
};

/** Two-step approval events (backend config_approval); their metadata carries
 *  the section's own event in `settings_event` and the request diff in `changed`. */
export const CONFIG_CHANGE_EVENTS: Record<string, string> = {
  config_change_requested: "Gửi yêu cầu đổi cấu hình",
  config_change_approved: "Duyệt đổi cấu hình",
  config_change_rejected: "Từ chối đổi cấu hình",
  config_change_cancelled: "Huỷ yêu cầu đổi cấu hình",
  config_change_superseded: "Yêu cầu đổi cấu hình đã cũ",
  config_change_expired: "Yêu cầu đổi cấu hình hết hạn",
};

const nf = (n: number) => n.toLocaleString("vi-VN");

export function formatSetting(fmt: Fmt, v: unknown): string {
  if (fmt === "limit" || fmt === "limitVnd") {
    if (v === null || v === undefined) return "Không giới hạn";
    return typeof v === "number" ? (fmt === "limitVnd" ? `${nf(v)} ₫` : nf(v)) : String(v);
  }
  if (fmt === "badge") return v ? "Có ảnh" : "Không có";
  if (fmt === "list") return Array.isArray(v) && v.length ? v.join(", ") : "—";
  if (fmt === "affPct" || fmt === "affDays") {
    if (v === null || v === undefined) return "Theo mức chung";
    if (fmt === "affDays" && v === 0) return "Trọn đời";
    if (typeof v === "number") return fmt === "affPct" ? `${nf(v)}%` : `${nf(v)} ngày`;
    return String(v);
  }
  if (fmt === "feeOrDefault" && (v === null || v === undefined)) return "Mặc định sàn";
  if (fmt === "criterion") return v === "total_deposit" ? "Tổng nạp" : v === "total_spent" ? "Tổng tiêu" : String(v ?? "—");
  if (v === null || v === undefined || v === "") return "—";
  if (fmt === "level") return LEVEL[String(v)] ?? String(v);
  if (fmt === "datetime" && typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
  }
  if (typeof v === "boolean") return v ? "Bật" : "Tắt";
  if (typeof v !== "number") return String(v);
  switch (fmt) {
    case "pct":
    case "feeOrDefault": return `${nf(v)}%`;
    case "pp": return `${nf(v)} điểm %`;
    case "days": return `${nf(v)} ngày`;
    case "hours": return `${nf(v)} giờ`;
    // Hold durations are stored in hours; whole days read as days.
    case "hold": return v > 0 && v % 24 === 0 ? `${nf(v / 24)} ngày` : `${nf(v)} giờ`;
    case "minutes": return `${nf(v)} phút`;
    case "mb": return `${nf(v)} MB`;
    case "vnd": return `${nf(v)} ₫`;
    case "account": return `#${v}`;
    default: return nf(v);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function fieldRows(field: string, before: unknown, after: unknown, md: Md, prefix = ""): SettingChange[] {
  const spec = SETTING_FIELDS[field] ?? trustSpec(field) ?? { label: field.replace(/_/g, " "), fmt: "count" as Fmt };
  if (spec.perCategory) {
    const a = isObj(before) ? before : {};
    const b = isObj(after) ? after : {};
    const names = isObj(md.labels) && isObj(md.labels.categories) ? md.labels.categories : {};
    const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((id) => !same(a[id], b[id]));
    return ids.map((id) => ({
      key: `${field}.${id}`,
      label: `${prefix}${spec.label} · ${typeof names[id] === "string" ? names[id] : `danh mục #${id}`}`,
      // No entry in the map = the category follows the global value.
      before: id in a ? formatSetting(spec.fmt, a[id]) : "Theo mức chung",
      after: id in b ? formatSetting(spec.fmt, b[id]) : "Theo mức chung",
    }));
  }
  return [{ key: `${prefix}${field}`, label: `${prefix}${spec.label}`, before: formatSetting(spec.fmt, before), after: formatSetting(spec.fmt, after) }];
}

function pairRows(pairs: Record<string, unknown>, md: Md, prefix = ""): SettingChange[] {
  const out: SettingChange[] = [];
  for (const [field, pair] of Object.entries(pairs)) {
    if (Array.isArray(pair) && pair.length === 2) out.push(...fieldRows(field, pair[0], pair[1], md, prefix));
  }
  return out;
}

/** Before → after rows for one settings audit entry; [] for other events. */
export function settingsChanges(md: Md | null | undefined): SettingChange[] {
  const m = md ?? {};
  const event = typeof m.event === "string" ? m.event : "";
  if (event in CONFIG_CHANGE_EVENTS) {
    // A request carries the proposed diff of one section: render it as that section's change.
    return typeof m.settings_event === "string" && m.settings_event in SETTINGS_EVENTS
      ? settingsChanges({ ...m, event: m.settings_event, old: undefined, new: undefined })
      : [];
  }
  if (!(event in SETTINGS_EVENTS)) return [];
  if (event === "buyer_tier_config_changed" && isObj(m.changed)) {
    // Audit rows: {"criterion": [a, b], "l2.min_amount": [a, b], …}; an approval
    // request's diff flattens the whole document ("levels.l2.min_amount").
    return Object.entries(m.changed).flatMap(([raw, pair]) => {
      if (!Array.isArray(pair) || pair.length !== 2) return [];
      const path = raw.replace(/^levels\./, "");
      const [level, field] = path.includes(".") ? path.split(".", 2) : ["", path];
      return fieldRows(field, pair[0], pair[1], m, level ? `Hạng người mua ${level.toUpperCase()} · ` : "");
    });
  }
  if (event === "seller_tier_config_changed") {
    // changed = {tier: {field: [old, new]}}
    const changed = isObj(m.changed) ? m.changed : {};
    return Object.entries(changed).flatMap(([tier, diff]) =>
      isObj(diff) ? pairRows(diff, m, `Hạng ${TIER_NAME[tier] ?? tier} · `) : []);
  }
  if (isObj(m.changed)) return pairRows(m.changed, m);
  // Older events / seller runtime config: diff the full old and new snapshots.
  if (isObj(m.old) && isObj(m.new)) {
    const nested = event === "seller_trust_config_changed";
    const oldV = nested ? flatten(m.old) : m.old;
    const newV = nested ? flatten(m.new) : m.new;
    const pairs: Record<string, unknown> = {};
    for (const k of Object.keys(newV)) if (!same(oldV[k], newV[k])) pairs[k] = [oldV[k], newV[k]];
    return pairRows(pairs, m);
  }
  return [];
}

/** Rows for a pending/decided approval request (its `diff` is the section's `changed`). */
export function requestChanges(req: { settings_event: string | null; diff: Record<string, unknown>; context: Record<string, unknown> | null }): SettingChange[] {
  if (!req.settings_event) return [];
  return settingsChanges({ event: req.settings_event, changed: req.diff, ...(req.context ? { labels: req.context } : {}) });
}

/** "Phí sàn: 5% → 6% · Giữ tiền mặc định: 3 ngày → 5 ngày · +2 thay đổi". */
export function settingsSummary(changes: SettingChange[], max = 2): string {
  if (!changes.length) return "không đổi giá trị nào";
  const head = changes.slice(0, max).map((c) => `${c.label}: ${c.before} → ${c.after}`);
  const rest = changes.length - max;
  return rest > 0 ? `${head.join(" · ")} · +${rest} thay đổi` : head.join(" · ");
}

/** Log title, e.g. "Đổi phí & giữ tiền: Phí sàn: 5% → 6%". */
export function describeSettingsEvent(md: Md): string {
  const event = String(md.event ?? "");
  if (event in CONFIG_CHANGE_EVENTS) {
    const section = typeof md.section_label === "string" ? ` · ${md.section_label}` : "";
    return `${CONFIG_CHANGE_EVENTS[event]}${section}: ${settingsSummary(settingsChanges(md))}`;
  }
  return `${SETTINGS_EVENTS[event] ?? event}: ${settingsSummary(settingsChanges(md))}`;
}
