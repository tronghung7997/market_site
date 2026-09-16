/**
 * Order references as they appear in URLs, deep links and search boxes:
 * the public code (`ORD-3F9K2M7Q`, any case, `#` and prefix optional) or a
 * legacy numeric id. Customer-facing UI shows only the code; the id is kept
 * for old links and notifications.
 */

const ORDER_CODE_BODY = /^[0-9A-Z]{8}$/;

/** Normalise `ord-3f9k2m7q`, `#3F9K2M7Q`, `ORD-3F9K2M7Q` → `ORD-3F9K2M7Q`; null when it is not a code. */
export function normalizeOrderCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let body = raw.trim().replace(/^#/, "").toUpperCase();
  if (body.startsWith("ORD-")) body = body.slice(4);
  if (!ORDER_CODE_BODY.test(body) || /^\d+$/.test(body)) return null;
  return `ORD-${body}`;
}

export function matchesOrderRef(order: { id: number; order_code?: string | null }, ref: string): boolean {
  const trimmed = ref.trim().replace(/^#/, "");
  if (!trimmed) return false;
  const code = normalizeOrderCode(trimmed);
  if (code) return order.order_code === code;
  return /^\d+$/.test(trimmed) && order.id === Number(trimmed);
}

/** Label for a stock line inside an order (1-based). Line numbers, never row ids, are what people see. */
export function lineLabel(line: number): string {
  return `#${String(line).padStart(2, "0")}`;
}

/** Resource id → 1-based line number for the order's full stock list (sorted by id, as the API returns it). */
export function resourceLineMap(rows: Array<{ id: number }>): Record<number, number> {
  const lines: Record<number, number> = {};
  rows.forEach((row, index) => {
    lines[row.id] = index + 1;
  });
  return lines;
}
