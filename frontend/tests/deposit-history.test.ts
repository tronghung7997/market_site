import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { countDeposits, depositRef, depositsCsv, filterDeposits } from "../app/[locale]/wallet/deposit-history.ts";
import type { DepositIntent } from "../lib/types.ts";

const row = (id: number, status: DepositIntent["status"], extra: Partial<DepositIntent> = {}): DepositIntent =>
  ({ id, amount: id * 10_000, status, provider: "sepay", created_at: `2026-09-2${id}T10:00:00Z`, expires_at: "", ...extra }) as DepositIntent;

const rows = [row(1, "paid", { payment_code: "NAP123" }), row(2, "pending"), row(3, "expired"), row(4, "cancelled", { provider: "nowpayments" })];

describe("wallet top-up history", () => {
  it("filters by status and groups expired with cancelled", () => {
    assert.deepEqual(filterDeposits(rows, "paid").map((d) => d.id), [1]);
    assert.deepEqual(filterDeposits(rows, "closed").map((d) => d.id), [3, 4]);
    assert.equal(filterDeposits(rows, "all").length, 4);
    assert.deepEqual(countDeposits(rows), { all: 4, paid: 1, pending: 1, closed: 2 });
  });

  it("prefers the transfer code as the reference", () => {
    assert.equal(depositRef(rows[0]), "NAP123");
    assert.equal(depositRef(rows[1]), "#2");
  });

  it("writes a CSV with a header and neutralised formulas", () => {
    const csv = depositsCsv(
      [row(1, "paid", { payment_code: "=HYPERLINK(1)" }), row(2, "pending", { provider: "a,b" })],
      { code: "Code", time: "Time", method: "Method", amount: "Amount", status: "Status" },
      (s) => (s === "paid" ? "Paid" : "Waiting"),
    );
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "Code,Time,Method,Amount,Status");
    assert.equal(lines[1], "'=HYPERLINK(1),2026-09-21T10:00:00Z,sepay,10000,Paid");
    assert.equal(lines[2], '#2,2026-09-22T10:00:00Z,"a,b",20000,Waiting');
  });
});
