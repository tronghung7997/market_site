import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { accountsQuery, accountsUrlSearch, activeView, ariaSort, DEFAULT_FILTERS, lockLine, parseAccountsUrl, sortState, toggleSort } from "../features/admin-accounts/model.ts";

describe("admin accounts model", () => {
  it("parses and validates URL filters", () => {
    const f = parseAccountsUrl(new URLSearchParams("q=ORD-1&role=seller&tier=trusted,bogus,new&status=risky&sort=balance&page=3&per_page=50"));
    assert.deepEqual(f, { q: "ORD-1", role: "seller", tier: ["trusted", "new"], status: "risky", sort: "balance", dir: "", page: 3, perPage: 50 });
    assert.deepEqual(parseAccountsUrl(new URLSearchParams("role=root&per_page=7&page=0&dir=up")), DEFAULT_FILTERS);
  });

  it("omits defaults and drops the legacy ?account param", () => {
    assert.equal(accountsUrlSearch(DEFAULT_FILTERS, new URLSearchParams("account=5&x=1")), "x=1");
    assert.equal(accountsUrlSearch({ ...DEFAULT_FILTERS, tier: ["new", "trusted"], page: 2 }), "tier=new%2Ctrusted&page=2");
    assert.equal(accountsUrlSearch({ ...DEFAULT_FILTERS, sort: "spent", dir: "asc", perPage: 100 }), "sort=spent&dir=asc&per_page=100");
  });

  it("builds the API query", () => {
    assert.deepEqual(accountsQuery({ ...DEFAULT_FILTERS, q: "  a@b ", tier: ["new"] }), {
      search: "a@b", role: undefined, tier: ["new"], status: undefined, sort: "newest", dir: undefined, page: 1, per_page: 50,
    });
  });

  it("recognises saved views", () => {
    assert.equal(activeView(DEFAULT_FILTERS), "all");
    assert.equal(activeView({ ...DEFAULT_FILTERS, status: "risky" }), "risky");
    assert.equal(activeView({ ...DEFAULT_FILTERS, role: "seller", status: "locked" }), null);
    assert.equal(activeView({ ...DEFAULT_FILTERS, tier: ["new"] }), null);
  });

  it("toggles column sorts in the shortest URL form", () => {
    assert.deepEqual(sortState(DEFAULT_FILTERS), { key: "created", dir: "desc" });
    assert.deepEqual(sortState({ sort: "oldest", dir: "" }), { key: "created", dir: "asc" });
    assert.deepEqual(sortState({ sort: "email", dir: "" }), { key: "email", dir: "asc" });
    // Created flips through the legacy newest/oldest names.
    assert.deepEqual(toggleSort(DEFAULT_FILTERS, "created"), { sort: "oldest", dir: "" });
    assert.deepEqual(toggleSort({ sort: "oldest", dir: "" }, "created"), { sort: "newest", dir: "" });
    // A new column starts at its default direction; the same column flips.
    assert.deepEqual(toggleSort(DEFAULT_FILTERS, "spent"), { sort: "spent", dir: "" });
    assert.deepEqual(toggleSort({ sort: "spent", dir: "" }, "spent"), { sort: "spent", dir: "asc" });
    assert.deepEqual(toggleSort({ sort: "spent", dir: "asc" }, "spent"), { sort: "spent", dir: "" });
    assert.deepEqual(toggleSort(DEFAULT_FILTERS, "email"), { sort: "email", dir: "" });
    assert.deepEqual(toggleSort({ sort: "email", dir: "" }, "email"), { sort: "email", dir: "desc" });
    assert.equal(ariaSort({ sort: "spent", dir: "asc" }, "spent"), "ascending");
    assert.equal(ariaSort({ sort: "spent", dir: "" }, "spent"), "descending");
    assert.equal(ariaSort({ sort: "spent", dir: "" }, "balance"), "none");
    // Legacy links keep working; a dir without a valid sort is dropped.
    assert.equal(parseAccountsUrl(new URLSearchParams("sort=balance")).sort, "balance");
    assert.equal(parseAccountsUrl(new URLSearchParams("sort=nope&dir=asc")).dir, "");
  });

  it("describes a lock", () => {
    assert.equal(lockLine({ is_active: true, locked_at: null, locked_by_email: null, lock_reason: null }), null);
    const at = new Date(2026, 8, 12, 10).toISOString();
    assert.equal(lockLine({ is_active: false, locked_at: at, locked_by_email: "a@x", lock_reason: "clone" }), "Khóa 12/09 bởi a@x · clone");
    assert.equal(lockLine({ is_active: false }), "Khóa");
  });
});
