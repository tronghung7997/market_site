// Readable before → after rows for the admin settings audit events
// (fee & escrow config, seller tier rules, seller runtime config).
// Self-contained (no "@/…" runtime imports) so node tests can load it.

type Md = Record<string, unknown>;

export interface SettingChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

type Fmt = "pct" | "pp" | "days" | "hours" | "vnd" | "count" | "bool" | "account" | "limit" | "limitVnd" | "badge";

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
  escrow_default_days: { label: "Giữ tiền mặc định", fmt: "days" },
  escrow_min_days: { label: "Giữ tiền tối thiểu", fmt: "days" },
  category_escrow_min_days: { label: "Giữ tiền tối thiểu", fmt: "days", perCategory: true },
  withdraw_min_amount: { label: "Rút tối thiểu", fmt: "vnd" },
  withdraw_fee_fixed: { label: "Phí rút cố định", fmt: "vnd" },
  withdraw_fee_percent: { label: "Phí rút theo %", fmt: "pct" },
  dispute_seller_response_hours: { label: "Hạn người bán phản hồi khiếu nại", fmt: "hours" },
  dispute_evidence_image_required: { label: "Bắt buộc ảnh bằng chứng khiếu nại", fmt: "bool" },
  platform_account_id: { label: "Tài khoản nhận phí sàn", fmt: "account" },
  // seller_tier_config (per tier)
  max_active_products: { label: "Sản phẩm đang bán tối đa", fmt: "limit" },
  withdraw_limit_per_request: { label: "Hạn mức mỗi lệnh rút", fmt: "limitVnd" },
  fee_discount_pp: { label: "Giảm phí sàn", fmt: "pp" },
  escrow_reduction_days: { label: "Giảm ngày giữ tiền", fmt: "days" },
  badge: { label: "Huy hiệu", fmt: "badge" },
  // seller_runtime_config
  low_stock_threshold: { label: "Ngưỡng báo sắp hết hàng", fmt: "count" },
  inventory_export_row_limit: { label: "Giới hạn dòng khi xuất kho", fmt: "count" },
  review_window_days: { label: "Thời hạn đánh giá", fmt: "days" },
  auto_review_days: { label: "Tự đánh giá sau", fmt: "days" },
  auto_review_enabled: { label: "Tự đánh giá", fmt: "bool" },
};

export const TIER_NAME: Record<string, string> = {
  new: "Mới", verified: "Đã xác minh", trusted: "Uy tín", enterprise: "Doanh nghiệp",
};

/** Events whose metadata carries settings old/new values. */
export const SETTINGS_EVENTS: Record<string, string> = {
  fee_runtime_config_changed: "Đổi phí & giữ tiền",
  seller_tier_config_changed: "Đổi quy tắc hạng người bán",
  seller_runtime_config_changed: "Đổi cài đặt người bán",
};

const nf = (n: number) => n.toLocaleString("vi-VN");

export function formatSetting(fmt: Fmt, v: unknown): string {
  if (fmt === "limit" || fmt === "limitVnd") {
    if (v === null || v === undefined) return "Không giới hạn";
    return typeof v === "number" ? (fmt === "limitVnd" ? `${nf(v)} ₫` : nf(v)) : String(v);
  }
  if (fmt === "badge") return v ? "Có ảnh" : "Không có";
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Bật" : "Tắt";
  if (typeof v !== "number") return String(v);
  switch (fmt) {
    case "pct": return `${nf(v)}%`;
    case "pp": return `${nf(v)} điểm %`;
    case "days": return `${nf(v)} ngày`;
    case "hours": return `${nf(v)} giờ`;
    case "vnd": return `${nf(v)} ₫`;
    case "account": return `#${v}`;
    default: return nf(v);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function fieldRows(field: string, before: unknown, after: unknown, md: Md, prefix = ""): SettingChange[] {
  const spec = SETTING_FIELDS[field] ?? { label: field.replace(/_/g, " "), fmt: "count" as Fmt };
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
  if (!(event in SETTINGS_EVENTS)) return [];
  if (event === "seller_tier_config_changed") {
    // changed = {tier: {field: [old, new]}}
    const changed = isObj(m.changed) ? m.changed : {};
    return Object.entries(changed).flatMap(([tier, diff]) =>
      isObj(diff) ? pairRows(diff, m, `Hạng ${TIER_NAME[tier] ?? tier} · `) : []);
  }
  if (isObj(m.changed)) return pairRows(m.changed, m);
  // Older events / seller runtime config: diff the full old and new snapshots.
  if (isObj(m.old) && isObj(m.new)) {
    const oldV = m.old;
    const newV = m.new;
    const pairs: Record<string, unknown> = {};
    for (const k of Object.keys(newV)) if (!same(oldV[k], newV[k])) pairs[k] = [oldV[k], newV[k]];
    return pairRows(pairs, m);
  }
  return [];
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
  return `${SETTINGS_EVENTS[event] ?? event}: ${settingsSummary(settingsChanges(md))}`;
}
