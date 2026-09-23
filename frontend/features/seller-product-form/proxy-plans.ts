import type { ProxyPlanRow, ProxyProductPlans } from "@/lib/types";

/** Bảng gói của sản phẩm proxy trong trang sửa sản phẩm.
 *
 * Mỗi dòng là một gói buyer chọn được (mức chia sẻ/khu vực × thời hạn). Ở
 * TopProxy, HTTP và SOCKS5 cùng giá vốn nên gộp thành MỘT dòng: lưu ra
 * `plan_prices` thì dòng đó nở thành một key cho mỗi giao thức, buyer vẫn tự
 * chọn giao thức. Mọi thứ ở đây là bản nháp — chỉ ghi khi seller bấm Lưu. */
export interface PlanDraftRow {
  /** `network|days` khi gộp giao thức, không thì chính `plan_key`. */
  id: string;
  types: string[];
  network: string;
  networkLabel: string;
  days: number;
  price: number;
  /** Giá lúc tải trang; null = gói mới thêm. */
  savedPrice: number | null;
  cost: number | null;
  supported: boolean;
}

export interface ProxyPlanEditor {
  meta: Omit<ProxyProductPlans, "plans">;
  rows: PlanDraftRow[];
  /** Dòng lúc tải — "Hoàn tác" trả về đúng bảng này (kể cả gói đã xoá). */
  savedRows: PlanDraftRow[];
  /** `pricing_params` đang lưu — giữ nhãn hiển thị, chỉ thay phần giá. */
  baseParams: Record<string, unknown>;
}

const FORMULA_KEYS = ["base_price", "type_mult", "network_mult", "duration_options"] as const;

function rowId(network: string, days: number, type: string | null): string {
  return type == null ? `${network}|${days}` : `${type}|${network}|${days}`;
}

function sortRows(rows: PlanDraftRow[], networkOrder: string[]): PlanDraftRow[] {
  const rank = (network: string) => {
    const index = networkOrder.indexOf(network);
    return index < 0 ? networkOrder.length : index;
  };
  return [...rows].sort((a, b) => rank(a.network) - rank(b.network) || a.days - b.days || a.id.localeCompare(b.id));
}

/** Các dòng quote/API → dòng nháp, gộp giao thức cùng giá khi nguồn cho phép. */
export function draftRowsFromPlans(plans: ProxyPlanRow[], protocols: string[], networkOrder: string[]): PlanDraftRow[] {
  const merge = protocols.length > 0;
  const byId = new Map<string, PlanDraftRow>();
  for (const plan of plans) {
    const collapsible = merge && protocols.includes(plan.type);
    const id = rowId(plan.network, plan.days, collapsible ? null : plan.type);
    const price = plan.price ?? 0;
    const current = byId.get(id);
    if (!current) {
      byId.set(id, {
        id, types: [plan.type], network: plan.network, networkLabel: plan.network_label, days: plan.days,
        price, savedPrice: plan.price, cost: plan.cost_price, supported: plan.supported,
      });
      continue;
    }
    // Hai giao thức lỡ khác giá: lấy giá CAO hơn — không bao giờ tự hạ giá.
    current.types = [...new Set([...current.types, plan.type])].sort();
    current.price = Math.max(current.price, price);
    current.savedPrice = current.savedPrice == null || plan.price == null ? current.savedPrice ?? plan.price : Math.max(current.savedPrice, plan.price);
    current.cost = current.cost == null || plan.cost_price == null ? current.cost ?? plan.cost_price : Math.max(current.cost, plan.cost_price);
    current.supported = current.supported && plan.supported;
  }
  return sortRows([...byId.values()], networkOrder);
}

export function editorFromPlans(data: ProxyProductPlans, baseParams: Record<string, unknown> | null | undefined): ProxyPlanEditor {
  const { plans, ...meta } = data;
  const rows = draftRowsFromPlans(plans, data.protocols, data.networks.map((n) => n.code));
  return { meta, rows, savedRows: rows, baseParams: { ...(baseParams ?? {}) } };
}

/** Giá bán thấp nhất backend nhận: vốn × (1 + lãi tối thiểu) — không làm tròn. */
export function minimumPrice(cost: number | null, minMarginPct: number): number | null {
  return cost && cost > 0 ? cost * (1 + minMarginPct / 100) : null;
}

/** Bước làm tròn giá gợi ý: gói nhỏ làm tròn hàng trăm (làm tròn 1.000đ
 *  biến vốn 800đ thành giá 2.000đ = lãi 150%), gói từ 20.000đ hàng nghìn. */
export function roundStep(amount: number): number {
  return amount < 20_000 ? 100 : 1000;
}

function roundUp(amount: number): number {
  const step = roundStep(amount);
  return Math.ceil(Math.round(amount * 100) / 100 / step) * step;
}

/** Giá sàn để HIỂN THỊ: mức tối thiểu làm tròn lên như giá gợi ý. */
export function floorPrice(cost: number | null, minMarginPct: number): number | null {
  const min = minimumPrice(cost, minMarginPct);
  return min == null ? null : roundUp(min);
}

export function marginPct(price: number, cost: number | null): number | null {
  if (!cost || cost <= 0 || price <= 0) return null;
  return Math.round(((price - cost) / cost) * 1000) / 10;
}

export function suggestPrice(cost: number | null, pct: number): number {
  if (!cost || cost <= 0) return 0;
  return roundUp(cost * (1 + pct / 100));
}

export type RowIssue = "unsupported" | "missing_price" | "below_floor" | null;

export function rowIssue(row: PlanDraftRow, minMarginPct: number): RowIssue {
  if (!row.supported) return "unsupported";
  if (row.price <= 0) return "missing_price";
  const min = minimumPrice(row.cost, minMarginPct);
  if (min != null && row.price < min) return "below_floor";
  return null;
}

export function applyMargin(rows: PlanDraftRow[], pct: number): PlanDraftRow[] {
  return rows.map((row) => (row.cost ? { ...row, price: suggestPrice(row.cost, pct) } : row));
}

export function isChanged(row: PlanDraftRow): boolean {
  return row.savedPrice == null || row.savedPrice !== row.price;
}

/** Số thay đổi chưa lưu: giá sửa, gói thêm, gói xoá. */
export function changeCount(editor: ProxyPlanEditor): number {
  const kept = new Set(editor.rows.map((row) => row.id));
  return editor.rows.filter(isChanged).length + editor.savedRows.filter((row) => !kept.has(row.id)).length;
}

export function resetEditor(editor: ProxyPlanEditor): ProxyPlanEditor {
  return { ...editor, rows: editor.savedRows };
}

export function addRow(editor: ProxyPlanEditor, row: PlanDraftRow): ProxyPlanEditor {
  const rows = [...editor.rows.filter((item) => item.id !== row.id), row];
  return { ...editor, rows: sortRows(rows, editor.meta.networks.map((n) => n.code)) };
}

export function hasRow(editor: ProxyPlanEditor, network: string, days: number): boolean {
  return editor.rows.some((row) => row.network === network && row.days === days);
}

/** Bảng `plan_prices` gửi backend — mỗi giao thức của dòng là một key. */
export function planPricesFromRows(rows: PlanDraftRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const type of row.types) out[`${type}|${row.network}|${row.days}`] = row.price;
  }
  return out;
}

/** `pricing_params` mới: bỏ công thức cũ (giá tuyến tính theo ngày), giữ nhãn. */
export function paramsFromEditor(editor: ProxyPlanEditor): Record<string, unknown> {
  const params: Record<string, unknown> = { ...editor.baseParams };
  for (const key of FORMULA_KEYS) delete params[key];
  const networkDisplay = { ...((editor.baseParams.network_display as Record<string, string> | undefined) ?? {}) };
  for (const row of editor.rows) if (!networkDisplay[row.network]) networkDisplay[row.network] = row.networkLabel;
  params.network_display = networkDisplay;
  params.plan_prices = planPricesFromRows(editor.rows);
  return params;
}

export function perDay(price: number, days: number): number {
  return days > 0 ? Math.round(price / days) : 0;
}

/** Tóm tắt cho thanh trạng thái phía trên bảng. */
export function summarize(rows: PlanDraftRow[], minMarginPct: number) {
  const margins = rows.map((row) => marginPct(row.price, row.cost)).filter((m): m is number => m != null);
  return {
    count: rows.length,
    minMargin: margins.length ? Math.min(...margins) : null,
    maxMargin: margins.length ? Math.max(...margins) : null,
    issues: rows.filter((row) => rowIssue(row, minMarginPct) != null).length,
    changed: rows.filter(isChanged).length,
    minPrice: rows.filter((row) => row.price > 0).reduce<number | null>((min, row) => (min == null || row.price < min ? row.price : min), null),
  };
}
