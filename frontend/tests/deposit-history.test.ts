import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { countDeposits, depositRef, depositsCsv, depositTotals, filterDeposits, needsDepositCheck } from "../app/[locale]/wallet/deposit-history.ts";
import type { DepositIntent } from "../lib/types.ts";

const row = (id: number, status: DepositIntent["status"], extra: Partial<DepositIntent> = {}): DepositIntent =>
  ({ id, amount: id * 10_000, status, provider: "sepay", created_at: `2026-09-2${id}T10:00:00Z`, expires_at: "", ...extra }) as DepositIntent;

const rows = [row(1, "paid", { payment_code: "NAP123" }), row(2, "pending"), row(3, "expired"), row(4, "cancelled", { provider: "nowpayments" })];

describe("wallet top-up history", () => {
  it("filters by each status", () => {
    assert.deepEqual(filterDeposits(rows, "paid").map((d) => d.id), [1]);
    assert.deepEqual(filterDeposits(rows, "expired").map((d) => d.id), [3]);
    assert.deepEqual(filterDeposits(rows, "cancelled").map((d) => d.id), [4]);
    assert.equal(filterDeposits(rows, "all").length, 4);
    assert.deepEqual(countDeposits(rows), { all: 4, paid: 1, pending: 1, expired: 1, cancelled: 1 });
  });

  it("totals what was credited and what is still on its way", () => {
    assert.deepEqual(depositTotals(rows), { credited: 10_000, pending: 20_000 });
    // A mismatched transfer credits what actually arrived.
    assert.deepEqual(depositTotals([row(1, "paid", { paid_amount: 9_000 })]), { credited: 9_000, pending: 0 });
    // A pending request past its deadline is no longer money on its way, and counts as expired.
    const late = row(7, "pending", { expires_at: "2026-09-20T10:00:00Z" });
    const now = Date.parse("2026-09-21T10:00:00Z");
    assert.deepEqual(depositTotals([late], now), { credited: 0, pending: 0 });
    assert.deepEqual(filterDeposits([late], "expired", now).map((d) => d.id), [7]);
    assert.deepEqual(filterDeposits([late], "pending", now), []);
  });

  it("quotes the transfer code or the USDT invoice, never the row id", () => {
    assert.equal(depositRef(rows[0]), "NAP123");
    assert.equal(depositRef(row(5, "paid", { provider: "nowpayments", now_invoice_id: "4522" })), "NP-4522");
    assert.equal(depositRef(row(6, "paid", { payment_code: null, sepay_reference: "SB4A3EAEA57B66" })), "SB4A3EAEA57B66");
    assert.equal(depositRef(rows[1]), "—");
  });

  it("offers a credit check after 10 minutes, and for 3 days after expiry", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
    assert.equal(needsDepositCheck({ status: "pending", created_at: at(5), expires_at: at(-10) }, now), false);
    assert.equal(needsDepositCheck({ status: "pending", created_at: at(11), expires_at: at(-4) }, now), true);
    assert.equal(needsDepositCheck({ status: "expired", created_at: at(200), expires_at: at(60) }, now), true);
    assert.equal(needsDepositCheck({ status: "expired", created_at: at(5000), expires_at: at(4400) }, now), false);
    assert.equal(needsDepositCheck({ status: "paid", created_at: at(30), expires_at: at(10) }, now), false);
  });

  it("writes a CSV with a header and neutralised formulas", () => {
    const csv = depositsCsv(
      [row(1, "paid", { payment_code: "=HYPERLINK(1)" }), row(2, "pending", { provider: "a,b" })],
      { code: "Code", time: "Time", method: "Method", amount: "Amount", status: "Status" },
      (s) => (s === "paid" ? "Paid" : "Waiting"),
      (d) => (d.provider === "nowpayments" ? "USDT" : "Bank, transfer"),
    );
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "Code,Time,Method,Amount,Status");
    // The provider's name never reaches the file, only the buyer-facing method.
    assert.equal(lines[1], "'=HYPERLINK(1),2026-09-21T10:00:00Z,\"Bank, transfer\",10000,Paid");
    assert.equal(lines[2], '—,2026-09-22T10:00:00Z,"Bank, transfer",20000,Waiting');
    assert.ok(!csv.toLowerCase().includes("sepay"));
  });
});
