import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { apiParams, parseQuery, periodRange, queryToParams, DEFAULT_QUERY, vnToday } from "../features/admin-ledger/model.ts";

// 2026-10-01 20:30 UTC = 2026-10-02 03:30 giờ VN.
const NOW = new Date("2026-10-01T20:30:00Z");

describe("admin ledger model", () => {
  it("round-trips URL state and drops junk", () => {
    const q = parseQuery(new URLSearchParams("period=custom&from=2026-09-01&to=2026-09-30&dir=out&types=refund,bogus&role=seller&account=12&group=order:7&amount=1500"));
    assert.deepEqual(q, {
      period: "custom", from: "2026-09-01", to: "2026-09-30", dir: "out", types: ["refund"], role: "seller",
      account: 12, group: "order:7", amount: 1500, entry: null, actor: null,
    });
    assert.equal(queryToParams(q).toString(), "period=custom&from=2026-09-01&to=2026-09-30&dir=out&types=refund&role=seller&account=12&group=order%3A7&amount=1500");
    assert.equal(parseQuery(new URLSearchParams("actor=admin")).actor, "admin");
    assert.equal(apiParams(parseQuery(new URLSearchParams("actor=admin")), NOW).actor, "admin");
    const junk = parseQuery(new URLSearchParams("period=year&dir=up&account=-3&group=order:1;drop&amount=1.5&from=yesterday&actor=robot"));
    assert.deepEqual(junk, DEFAULT_QUERY);
    assert.equal(queryToParams(DEFAULT_QUERY).toString(), "");
  });


  it("computes periods in Vietnam time", () => {
    assert.equal(vnToday(NOW), "2026-10-02");
    assert.deepEqual(periodRange({ ...DEFAULT_QUERY, period: "today" }, NOW), { start: "2026-10-02T00:00:00+07:00" });
    assert.deepEqual(periodRange({ ...DEFAULT_QUERY, period: "7d" }, NOW), { start: "2026-09-26T00:00:00+07:00" });
    assert.deepEqual(periodRange({ ...DEFAULT_QUERY, period: "month" }, NOW), { start: "2026-10-01T00:00:00+07:00" });
    assert.deepEqual(periodRange({ ...DEFAULT_QUERY, period: "all" }, NOW), {});
    // Custom range: `to` counts the whole day; reversed or open ranges are clamped.
    assert.deepEqual(periodRange({ ...DEFAULT_QUERY, period: "custom", from: "2026-09-01", to: "2026-09-30" }, NOW),
      { start: "2026-09-01T00:00:00+07:00", end: "2026-10-01T00:00:00+07:00" });
    assert.deepEqual(periodRange({ ...DEFAULT_QUERY, period: "custom", from: "2026-09-10", to: "2026-09-01" }, NOW),
      { start: "2026-09-10T00:00:00+07:00", end: "2026-09-11T00:00:00+07:00" });
    assert.deepEqual(periodRange({ ...DEFAULT_QUERY, period: "custom", from: "2026-09-10", to: "2026-12-31" }, NOW),
      { start: "2026-09-10T00:00:00+07:00", end: undefined });
  });

  it("ignores the period when a single event or row is pinned", () => {
    const params = apiParams({ ...DEFAULT_QUERY, group: "order:7" }, NOW);
    assert.equal(params.start, undefined);
    assert.equal(params.group, "order:7");
    const ranged = apiParams({ ...DEFAULT_QUERY, account: 3 }, NOW);
    assert.equal(ranged.start, "2026-09-03T00:00:00+07:00");
    assert.equal(ranged.account_id, 3);
  });
});

describe("ledger type names", () => {
  // Admin and the account owner name a ledger row the same way.
  it("match what buyers and sellers read in their transaction history", async () => {
    const { TYPE_LABEL, typeLabel } = await import("../features/admin-ledger/model.ts");
    const { readFileSync } = await import("node:fs");
    const vi = JSON.parse(readFileSync(new URL("../messages/vi.json", import.meta.url), "utf8"));
    const owner: Record<string, string> = vi.transactions.label;
    for (const [type, label] of Object.entries(TYPE_LABEL)) {
      if (type === "deposit") {
        assert.ok(owner.deposit_bank.startsWith(label) && owner.deposit_usdt.startsWith(label), type);
        continue;
      }
      assert.equal(label, owner[type], type);
    }
    assert.equal(typeLabel("platform_fee", "admin", "withdraw:5"), owner.withdraw_fee);
    assert.equal(typeLabel("platform_fee", "system", "order:5"), owner.platform_fee);
  });
});

describe("admin notes on ledger rows", () => {
  it("only manual credits and debits show the admin's reason", async () => {
    const { hasAdminNote } = await import("../features/admin-ledger/model.ts");
    assert.equal(hasAdminNote({ type: "adjustment_debit", actor: "admin", description: "Trừ nhầm" }), true);
    assert.equal(hasAdminNote({ type: "topup", actor: "admin", description: "GMMO cộng tiền — đền bù" }), true);
    // An admin's withdrawal decision books system text ("Withdrawal fee"): not a note.
    assert.equal(hasAdminNote({ type: "platform_fee", actor: "admin", description: "Withdrawal fee" }), false);
    assert.equal(hasAdminNote({ type: "withdraw", actor: "admin", description: "Đã chuyển khoản rút tiền" }), false);
    assert.equal(hasAdminNote({ type: "topup", actor: "admin", description: null }), false);
  });
});
