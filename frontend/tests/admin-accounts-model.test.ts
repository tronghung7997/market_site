import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { accountsQuery, accountsUrlSearch, activeView, DEFAULT_FILTERS, lockLine, parseAccountsUrl } from "../features/admin-accounts/model.ts";

describe("admin accounts model", () => {
  it("parses and validates URL filters", () => {
    const f = parseAccountsUrl(new URLSearchParams("q=ORD-1&role=seller&tier=trusted,bogus,new&status=risky&sort=balance&page=3&per_page=50"));
    assert.deepEqual(f, { q: "ORD-1", role: "seller", tier: ["trusted", "new"], status: "risky", sort: "balance", page: 3, perPage: 50 });
    assert.deepEqual(parseAccountsUrl(new URLSearchParams("role=root&per_page=7&page=0")), DEFAULT_FILTERS);
  });

  it("omits defaults and drops the legacy ?account param", () => {
    assert.equal(accountsUrlSearch(DEFAULT_FILTERS, new URLSearchParams("account=5&x=1")), "x=1");
    assert.equal(accountsUrlSearch({ ...DEFAULT_FILTERS, tier: ["new", "trusted"], page: 2 }), "tier=new%2Ctrusted&page=2");
  });

  it("builds the API query", () => {
    assert.deepEqual(accountsQuery({ ...DEFAULT_FILTERS, q: "  a@b ", tier: ["new"] }), {
      search: "a@b", role: undefined, tier: ["new"], status: undefined, sort: "newest", page: 1, per_page: 20,
    });
  });

  it("recognises saved views", () => {
    assert.equal(activeView(DEFAULT_FILTERS), "all");
    assert.equal(activeView({ ...DEFAULT_FILTERS, status: "risky" }), "risky");
    assert.equal(activeView({ ...DEFAULT_FILTERS, role: "seller", status: "locked" }), null);
    assert.equal(activeView({ ...DEFAULT_FILTERS, tier: ["new"] }), null);
  });

  it("describes a lock", () => {
    assert.equal(lockLine({ is_active: true, locked_at: null, locked_by_email: null, lock_reason: null }), null);
    const at = new Date(2026, 8, 12, 10).toISOString();
    assert.equal(lockLine({ is_active: false, locked_at: at, locked_by_email: "a@x", lock_reason: "clone" }), "Khóa 12/09 bởi a@x · clone");
    assert.equal(lockLine({ is_active: false }), "Khóa");
  });
});
