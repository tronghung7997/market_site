/** Pure helpers for the wallet's top-up history: status filter and CSV. */

import type { DepositIntent } from "../../../lib/types.ts";

export const DEPOSIT_FILTERS = ["all", "paid", "pending", "closed"] as const;
export type DepositFilter = (typeof DEPOSIT_FILTERS)[number];

/** "closed" groups the two outcomes that never touched the balance. */
export function filterDeposits(rows: DepositIntent[], filter: DepositFilter): DepositIntent[] {
  if (filter === "all") return rows;
  if (filter === "closed") return rows.filter((d) => d.status === "expired" || d.status === "cancelled");
  return rows.filter((d) => d.status === filter);
}

export function countDeposits(rows: DepositIntent[]): Record<DepositFilter, number> {
  return Object.fromEntries(DEPOSIT_FILTERS.map((f) => [f, filterDeposits(rows, f).length])) as Record<DepositFilter, number>;
}

/** Transfer code when the rail has one (bank), otherwise the internal id. */
export function depositRef(d: DepositIntent): string {
  return d.payment_code || `#${d.id}`;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  // Neutralise spreadsheet formulas and quote anything with separators.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV with a header row; amounts stay in ledger VND. */
export function depositsCsv(
  rows: DepositIntent[],
  headers: { code: string; time: string; method: string; amount: string; status: string },
  statusLabel: (status: DepositIntent["status"]) => string,
): string {
  const lines = [[headers.code, headers.time, headers.method, headers.amount, headers.status].map(csvCell).join(",")];
  for (const d of rows) {
    lines.push([depositRef(d), d.created_at, d.provider ?? "", d.amount, statusLabel(d.status)].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
