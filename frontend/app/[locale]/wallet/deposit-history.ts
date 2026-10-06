/** Pure helpers for the wallet's top-up history: status filter, totals,
 *  when to offer a credit check, and CSV. */

import type { DepositIntent } from "../../../lib/types.ts";

export const DEPOSIT_FILTERS = ["all", "paid", "pending", "expired", "cancelled"] as const;
export type DepositFilter = (typeof DEPOSIT_FILTERS)[number];

/** A pending request past its deadline is already "expired" (as on the server). */
function timedOut(d: DepositIntent, now: number): boolean {
  return d.status === "pending" && !!d.expires_at && Date.parse(d.expires_at) <= now;
}

export function filterDeposits(rows: DepositIntent[], filter: DepositFilter, now: number = Date.now()): DepositIntent[] {
  if (filter === "all") return rows;
  if (filter === "pending") return rows.filter((d) => d.status === "pending" && !timedOut(d, now));
  if (filter === "expired") return rows.filter((d) => d.status === "expired" || timedOut(d, now));
  return rows.filter((d) => d.status === filter);
}

export function countDeposits(rows: DepositIntent[], now: number = Date.now()): Record<DepositFilter, number> {
  return Object.fromEntries(DEPOSIT_FILTERS.map((f) => [f, filterDeposits(rows, f, now).length])) as Record<DepositFilter, number>;
}

/** Money credited and money still on its way, over the loaded rows. A pending
 *  request whose time ran out is not on its way any more (same rule as the
 *  wallet's server-side `pending_deposits`). */
export function depositTotals(rows: DepositIntent[], now: number = Date.now()): { credited: number; pending: number } {
  let credited = 0;
  let pending = 0;
  for (const d of rows) {
    if (d.status === "paid") credited += d.paid_amount ?? d.amount;
    else if (d.status === "pending" && (!d.expires_at || Date.parse(d.expires_at) > now)) pending += d.amount;
  }
  return { credited, pending };
}

/** What the buyer quotes to support: the bank transfer code, or the USDT
 *  invoice. Never the internal row id. */
export function depositRef(d: DepositIntent): string {
  if (d.payment_code) return d.payment_code;
  if (d.now_invoice_id) return `NP-${d.now_invoice_id}`;
  // Standing-code transfers have no per-request code; the bank reference
  // is what the buyer sees on their statement.
  if (d.sepay_reference) return d.sepay_reference;
  return "—";
}

const CHECK_AFTER_MS = 10 * 60_000;
const CHECK_EXPIRED_WITHIN_MS = 72 * 3_600_000;

/** A request worth a check: open for 10 minutes without credit, or expired
 *  in the last 3 days (money may have arrived after the code expired). */
export function needsDepositCheck(d: Pick<DepositIntent, "status" | "created_at" | "expires_at">, now: number): boolean {
  if (d.status === "pending") return now - new Date(d.created_at).getTime() >= CHECK_AFTER_MS;
  if (d.status === "expired") return now - new Date(d.expires_at).getTime() <= CHECK_EXPIRED_WITHIN_MS;
  return false;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  // Neutralise spreadsheet formulas and quote anything with separators.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV with a header row; amounts stay in ledger VND. The method column is
 *  the buyer-facing label (bank transfer / USDT), never the provider's name. */
export function depositsCsv(
  rows: DepositIntent[],
  headers: { code: string; time: string; method: string; amount: string; status: string },
  statusLabel: (status: DepositIntent["status"]) => string,
  methodLabel: (deposit: DepositIntent) => string,
): string {
  const lines = [[headers.code, headers.time, headers.method, headers.amount, headers.status].map(csvCell).join(",")];
  for (const d of rows) {
    lines.push([depositRef(d), d.created_at, methodLabel(d), d.amount, statusLabel(d.status)].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
