/** Bảng giá theo trục cho chiến lược `config` (proxy-style).
 *
 * Mô hình: hai trục có mã máy (`type`, `network`) + trục thời hạn (`days`).
 * Mỗi ô `type|network|days` là một gói; giá lưu ở `plan_prices` — đúng hợp
 * đồng backend đang có (ConfigPricing, adapter DProxy/TopProxy đọc cùng key).
 * Nhãn trục/giá trị chỉ là lớp hiển thị (`field_labels`, `type_display`,
 * `network_display`); mã máy là thứ gửi thẳng cho nhà cung cấp nên không
 * bao giờ bị đổi khi đổi nhãn.
 *
 * Mọi hàm ở đây thuần: trả về bảng mới, không sửa bảng cũ. */

export type AxisKey = "type" | "network";

export interface AxisValue {
  /** Mã máy — gửi nguyên văn cho nhà cung cấp. */
  code: string;
  /** Nhãn buyer thấy. */
  label: string;
}

export interface PriceGrid {
  typeLabel: string;
  networkLabel: string;
  types: AxisValue[];
  networks: AxisValue[];
  days: number[];
  /** Nhãn thời hạn khác mặc định "N ngày" (vd 1 → "24 giờ"), key = số ngày. */
  dayLabels: Record<string, string>;
  /** key `type|network|days` → giá VND. 0 = ô vừa mở, chưa có giá (không lưu). */
  prices: Record<string, number>;
  /** Giá đang suy từ công thức cũ (base × hệ số × ngày/30); lưu lại là chuyển hẳn sang bảng. */
  fromFormula: boolean;
}

/** Giá vốn / khả năng mua của một ô, lấy từ `/products/{id}/proxy-plans/quote`. */
export interface CellCost {
  cost: number | null;
  supported: boolean;
}

export type CostMap = Record<string, CellCost>;

export type CellState = "off" | "empty" | "ok" | "below_floor" | "unsupported";

const FORMULA_KEYS = ["base_price", "type_mult", "network_mult", "duration_options"] as const;
const PROTOCOL_CODES = new Set(["HTTP", "HTTPS", "SOCKS5", "SOCKS4"]);

export const DEFAULT_NETWORK_LABEL = "Nhà mạng";

export function cellKey(type: string, network: string, days: number): string {
  return `${type}|${network}|${days}`;
}

function parseKey(key: string): { type: string; network: string; days: number } | null {
  const parts = key.split("|");
  if (parts.length !== 3) return null;
  const [type, network, rawDays] = parts.map((part) => part.trim());
  const days = Number(rawDays);
  if (!type || !network || !Number.isInteger(days) || days <= 0) return null;
  return { type, network, days };
}

/** Giống `humanize_code` phía backend: chỉ làm sạch, không dịch. */
function humanize(code: string): string {
  const words = code.replace(/[_-]/g, " ").split(" ").filter(Boolean);
  return words.length ? words.map((w) => w.slice(0, 1).toUpperCase() + w.slice(1)).join(" ") : code;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record(value))) if (typeof v === "string" && v.trim()) out[k] = v;
  return out;
}

/** `plan_prices` hợp lệ theo đúng luật backend (`plan_prices_map`). */
function planPrices(params: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record(params.plan_prices))) {
    const parsed = parseKey(key);
    if (!parsed || typeof value !== "number" || !Number.isInteger(value) || value <= 0) continue;
    out[cellKey(parsed.type, parsed.network, parsed.days)] = value;
  }
  return out;
}

/** Bảng tương đương của công thức cũ — khớp `formula_prices` phía backend. */
function formulaPrices(params: Record<string, unknown>): Record<string, number> {
  const base = params.base_price;
  const types = record(params.type_mult);
  const networks = record(params.network_mult);
  const durations = Array.isArray(params.duration_options) ? params.duration_options : [];
  if (typeof base !== "number") return {};
  const out: Record<string, number> = {};
  for (const [type, tMult] of Object.entries(types)) {
    for (const [network, nMult] of Object.entries(networks)) {
      for (const item of durations) {
        const days = Number(record(item).days);
        const price = Math.round(base * Number(tMult) * Number(nMult) * days / 30);
        if (Number.isInteger(days) && days > 0 && price > 0) out[cellKey(type, network, days)] = price;
      }
    }
  }
  return out;
}

function uniqueInOrder(...lists: string[][]): string[] {
  return [...new Set(lists.flat().map((s) => s.trim()).filter(Boolean))];
}

export function defaultTypeLabel(codes: string[]): string {
  return codes.length > 0 && codes.every((code) => PROTOCOL_CODES.has(code.toUpperCase())) ? "Giao thức" : "Loại proxy";
}

export function defaultDayLabel(days: number): string {
  return `${days} ngày`;
}

/** Nhãn buyer tiếng Việt đang thấy. Sản phẩm đã có bảng giá: nhãn nằm hết
 *  trong params. Sản phẩm công thức cũ: backend còn phủ `pricing_labels` của
 *  bản dịch (en rồi vi — `resolve_product_pricing_params`), truyền vào
 *  `overlays` theo đúng thứ tự đó để bảng hiện y như buyer thấy; lưu lại là
 *  các nhãn này về hẳn params. */
export function gridFromParams(
  params: Record<string, unknown> | null | undefined,
  overlays: (Record<string, unknown> | null | undefined)[] = [],
): PriceGrid {
  const p = params ?? {};
  const explicit = planPrices(p);
  const fromFormula = Object.keys(explicit).length === 0;
  const prices = fromFormula ? formulaPrices(p) : explicit;
  const parsed = Object.keys(prices).map(parseKey).filter((x): x is NonNullable<typeof x> => x != null);
  const layers = fromFormula ? overlays.map(record) : [];
  const layered = (key: string): Record<string, string> =>
    layers.reduce<Record<string, string>>((acc, layer) => ({ ...acc, ...stringRecord(layer[key]) }), stringRecord(p[key]));

  const typeDisplay = layered("type_display");
  const networkDisplay = layered("network_display");
  const typeCodes = uniqueInOrder(Object.keys(record(p.type_mult)), parsed.map((x) => x.type), Object.keys(typeDisplay));
  const networkCodes = uniqueInOrder(Object.keys(record(p.network_mult)), parsed.map((x) => x.network), Object.keys(networkDisplay));
  const durationDays = (Array.isArray(p.duration_options) ? p.duration_options : [])
    .map((item) => Number(record(item).days))
    .filter((d) => Number.isInteger(d) && d > 0);
  const days = [...new Set([...durationDays, ...parsed.map((x) => x.days)])].sort((a, b) => a - b);
  const labels = layered("field_labels");
  const durationOptionLabels: Record<string, string> = {};
  for (const item of Array.isArray(p.duration_options) ? p.duration_options : []) {
    const r = record(item);
    if (typeof r.label === "string" && r.label.trim()) durationOptionLabels[String(r.days)] = r.label;
  }
  const allDayLabels = { ...durationOptionLabels, ...layered("duration_labels") };
  const dayLabels = Object.fromEntries(days.flatMap((d) => {
    const label = allDayLabels[String(d)]?.trim();
    return label && label !== defaultDayLabel(d) ? [[String(d), label]] : [];
  }));

  return {
    typeLabel: labels.type ?? defaultTypeLabel(typeCodes),
    networkLabel: labels.network ?? DEFAULT_NETWORK_LABEL,
    types: typeCodes.map((code) => ({ code, label: typeDisplay[code] ?? humanize(code) })),
    networks: networkCodes.map((code) => ({ code, label: networkDisplay[code] ?? code })),
    days,
    dayLabels,
    prices,
    fromFormula: fromFormula && Object.keys(prices).length > 0,
  };
}

/** `pricing_params` mới: bảng `plan_prices` theo thứ tự trục (buyer thấy đúng
 *  thứ tự này), bỏ công thức cũ, giữ nguyên mọi key khác (volume_tiers…). */
export function paramsFromGrid(grid: PriceGrid, base: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const params: Record<string, unknown> = { ...(base ?? {}) };
  for (const key of FORMULA_KEYS) delete params[key];
  const plan: Record<string, number> = {};
  for (const t of grid.types) {
    for (const n of grid.networks) {
      for (const d of grid.days) {
        const price = grid.prices[cellKey(t.code, n.code, d)];
        if (price && price > 0) plan[cellKey(t.code, n.code, d)] = Math.round(price);
      }
    }
  }
  params.plan_prices = plan;
  params.type_display = Object.fromEntries(grid.types.map((v) => [v.code, v.label.trim() || v.code]));
  params.network_display = Object.fromEntries(grid.networks.map((v) => [v.code, v.label.trim() || v.code]));
  const dayLabels = Object.fromEntries(grid.days.flatMap((d) => {
    const label = grid.dayLabels[String(d)]?.trim();
    return label && label !== defaultDayLabel(d) ? [[String(d), label]] : [];
  }));
  if (Object.keys(dayLabels).length > 0) params.duration_labels = dayLabels;
  else delete params.duration_labels;
  params.field_labels = {
    ...stringRecord(base?.field_labels),
    type: grid.typeLabel.trim() || defaultTypeLabel(grid.types.map((v) => v.code)),
    network: grid.networkLabel.trim() || DEFAULT_NETWORK_LABEL,
  };
  return params;
}

// ── Sửa trục ──────────────────────────────────────────────────────────

function axisList(grid: PriceGrid, axis: AxisKey): AxisValue[] {
  return axis === "type" ? grid.types : grid.networks;
}

function withAxis(grid: PriceGrid, axis: AxisKey, values: AxisValue[]): PriceGrid {
  return axis === "type" ? { ...grid, types: values } : { ...grid, networks: values };
}

function keepPrices(grid: PriceGrid, keep: (key: { type: string; network: string; days: number }) => boolean): Record<string, number> {
  return Object.fromEntries(Object.entries(grid.prices).filter(([key]) => {
    const parsed = parseKey(key);
    return parsed != null && keep(parsed);
  }));
}

/** Mã chứa `|` sẽ làm hỏng key `type|network|days` → không nhận. */
export function isValidCode(code: string): boolean {
  const c = code.trim();
  return c.length > 0 && c.length <= 40 && !c.includes("|");
}

export function addAxisValue(grid: PriceGrid, axis: AxisKey, value: AxisValue): PriceGrid {
  const code = value.code.trim();
  if (!isValidCode(code) || axisList(grid, axis).some((v) => v.code === code)) return grid;
  return withAxis(grid, axis, [...axisList(grid, axis), { code, label: value.label.trim() || code }]);
}

export function renameAxisValue(grid: PriceGrid, axis: AxisKey, code: string, label: string): PriceGrid {
  return withAxis(grid, axis, axisList(grid, axis).map((v) => (v.code === code ? { ...v, label } : v)));
}

export function removeAxisValue(grid: PriceGrid, axis: AxisKey, code: string): PriceGrid {
  const next = withAxis(grid, axis, axisList(grid, axis).filter((v) => v.code !== code));
  return { ...next, prices: keepPrices(grid, (k) => (axis === "type" ? k.type : k.network) !== code) };
}

export function addDays(grid: PriceGrid, days: number): PriceGrid {
  if (!Number.isInteger(days) || days <= 0 || days > 3650 || grid.days.includes(days)) return grid;
  return { ...grid, days: [...grid.days, days].sort((a, b) => a - b) };
}

export function removeDays(grid: PriceGrid, days: number): PriceGrid {
  const dayLabels = { ...grid.dayLabels };
  delete dayLabels[String(days)];
  return { ...grid, days: grid.days.filter((d) => d !== days), dayLabels, prices: keepPrices(grid, (k) => k.days !== days) };
}

export function dayLabel(grid: PriceGrid, days: number): string {
  return grid.dayLabels[String(days)] || defaultDayLabel(days);
}

export function renameDays(grid: PriceGrid, days: number, label: string): PriceGrid {
  const dayLabels = { ...grid.dayLabels };
  const clean = label.trim();
  if (!clean || clean === defaultDayLabel(days)) delete dayLabels[String(days)];
  else dayLabels[String(days)] = clean;
  return { ...grid, dayLabels };
}

// ── Sửa giá ───────────────────────────────────────────────────────────

export function setPrice(grid: PriceGrid, key: string, price: number | null): PriceGrid {
  const prices = { ...grid.prices };
  if (price == null) delete prices[key];
  else prices[key] = Math.max(0, Math.round(price));
  return { ...grid, prices };
}

/** Bước làm tròn: gói nhỏ hàng trăm, từ 20.000đ hàng nghìn (như bảng gói seller). */
export function roundStep(amount: number): number {
  return amount < 20_000 ? 100 : 1000;
}

function roundUp(amount: number): number {
  const step = roundStep(amount);
  return Math.ceil(Math.round(amount * 100) / 100 / step) * step;
}

/** Giá thấp nhất backend nhận: vốn × (1 + lãi tối thiểu) — `margin_ok`. */
export function minimumPrice(cost: number | null | undefined, minMarginPct: number): number | null {
  return cost && cost > 0 ? cost * (1 + minMarginPct / 100) : null;
}

export function floorPrice(cost: number | null | undefined, minMarginPct: number): number | null {
  const min = minimumPrice(cost, minMarginPct);
  return min == null ? null : roundUp(min);
}

/** Lãi tính trên giá vốn (cùng định nghĩa với lãi tối thiểu của nguồn). */
export function marginPct(price: number, cost: number | null | undefined): number | null {
  if (!cost || cost <= 0 || price <= 0) return null;
  return Math.round(((price - cost) / cost) * 1000) / 10;
}

/** Chép giá của một giá trị trục `type` sang mọi giá trị `type` khác —
 *  bỏ qua ô nguồn không mua được. */
export function copyTypePrices(grid: PriceGrid, fromType: string, supported: (key: string) => boolean = () => true): PriceGrid {
  const prices = { ...grid.prices };
  for (const t of grid.types) {
    if (t.code === fromType) continue;
    for (const n of grid.networks) {
      for (const d of grid.days) {
        const target = cellKey(t.code, n.code, d);
        const source = grid.prices[cellKey(fromType, n.code, d)];
        if (source && source > 0 && supported(target)) prices[target] = source;
        else delete prices[target];
      }
    }
  }
  return { ...grid, prices };
}

/** Tăng/giảm mọi ô đang bán theo %, làm tròn lên. */
export function adjustPrices(grid: PriceGrid, pct: number): PriceGrid {
  if (!Number.isFinite(pct) || pct <= -100) return grid;
  const prices = Object.fromEntries(Object.entries(grid.prices).map(([key, price]) => [key, price > 0 ? roundUp(price * (1 + pct / 100)) : price]));
  return { ...grid, prices };
}

/** Đặt mọi ô đang bán (có giá vốn) = vốn × (1 + lãi%), làm tròn lên. */
export function priceToMargin(grid: PriceGrid, pct: number, costs: CostMap): PriceGrid {
  if (!Number.isFinite(pct) || pct < 0) return grid;
  const prices = { ...grid.prices };
  for (const key of Object.keys(prices)) {
    const cost = costs[key]?.cost;
    if (cost && cost > 0) prices[key] = roundUp(cost * (1 + pct / 100));
  }
  return { ...grid, prices };
}

// ── Đọc bảng ──────────────────────────────────────────────────────────

export function cellState(grid: PriceGrid, key: string, costs: CostMap, minMarginPct: number): CellState {
  const price = grid.prices[key];
  const info = costs[key];
  if (price == null) return info && !info.supported ? "unsupported" : "off";
  if (info && !info.supported) return "unsupported";
  if (price <= 0) return "empty";
  const min = minimumPrice(info?.cost, minMarginPct);
  return min != null && price < min ? "below_floor" : "ok";
}

export function allCells(grid: PriceGrid): { key: string; type: string; network: string; days: number }[] {
  return grid.types.flatMap((t) => grid.networks.flatMap((n) => grid.days.map((d) => ({ key: cellKey(t.code, n.code, d), type: t.code, network: n.code, days: d }))));
}

export interface GridSummary {
  selling: number;
  emptyCells: number;
  belowFloor: number;
  unsupportedPriced: number;
  unpriced: number;
  minMargin: number | null;
  maxMargin: number | null;
  minPrice: number | null;
  maxPrice: number | null;
}

export function summarize(grid: PriceGrid, costs: CostMap, minMarginPct: number): GridSummary {
  const cells = allCells(grid);
  const margins: number[] = [];
  const sold: number[] = [];
  let belowFloor = 0;
  let unsupportedPriced = 0;
  let unpriced = 0;
  let emptyCells = 0;
  for (const { key } of cells) {
    const state = cellState(grid, key, costs, minMarginPct);
    const price = grid.prices[key] ?? 0;
    if (state === "off" || (state === "unsupported" && grid.prices[key] == null)) { emptyCells += 1; continue; }
    if (state === "unsupported") { unsupportedPriced += 1; continue; }
    if (state === "empty") { unpriced += 1; continue; }
    if (state === "below_floor") belowFloor += 1;
    sold.push(price);
    const m = marginPct(price, costs[key]?.cost);
    if (m != null) margins.push(m);
  }
  return {
    selling: sold.length,
    emptyCells,
    belowFloor,
    unsupportedPriced,
    unpriced,
    minMargin: margins.length ? Math.min(...margins) : null,
    maxMargin: margins.length ? Math.max(...margins) : null,
    minPrice: sold.length ? Math.min(...sold) : null,
    maxPrice: sold.length ? Math.max(...sold) : null,
  };
}

/** Lựa chọn buyer sẽ thấy — cùng dạng field `plan_key` backend trả về. */
export function buyerChoices(grid: PriceGrid): { value: string; label: string; price: number }[] {
  const out: { value: string; label: string; price: number }[] = [];
  for (const t of grid.types) {
    for (const n of grid.networks) {
      for (const d of grid.days) {
        const key = cellKey(t.code, n.code, d);
        const price = grid.prices[key];
        if (price && price > 0) out.push({ value: key, label: `${t.label || t.code} · ${n.label || n.code} · ${dayLabel(grid, d)}`, price });
      }
    }
  }
  return out;
}

/** Bảng giá theo trục dùng cho `config` dạng proxy. Dạng "gói × tháng"
 *  (`plan_options` không kèm `type_mult`, VPS) tính theo hệ số khác — không vào đây. */
export function isGridParams(params: Record<string, unknown> | null | undefined): boolean {
  const p = params ?? {};
  const planOptions = Array.isArray(p.plan_options) && p.plan_options.length > 0;
  return !(planOptions && !("type_mult" in p));
}
