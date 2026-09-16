import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { actionVisible, QUICK_ACTIONS, visibleActions } from "../features/search/actions.ts";
import {
  DEFAULT_SEARCH_FILTERS,
  foldText,
  matchesLabel,
  parseCommand,
  parseSearchFilters,
  pushRecentSearch,
  removeRecentSearch,
  sanitizeRecentSearches,
  searchFiltersToApiQuery,
  searchFiltersToQuery,
  searchPageHref,
} from "../features/search/model.ts";

describe("parseCommand", () => {
  it("recognises Linear-style scope prefixes and strips them from the term", () => {
    assert.deepEqual(parseCommand("#  Mạng xã hội "), { scope: "categories", term: "Mạng xã hội", direct: null });
    assert.equal(parseCommand("@orbit").scope, "sellers");
    assert.equal(parseCommand(">sign out").scope, "actions");
    assert.equal(parseCommand("> sign out").term, "sign out");
  });

  it("collapses whitespace and caps the term length", () => {
    const parsed = parseCommand("  tài   khoản  " + "x".repeat(200));
    assert.equal(parsed.scope, "all");
    assert.equal(parsed.term.length, 80);
    assert.ok(parsed.term.startsWith("tài khoản x"));
  });

  it("turns an order code into a direct link, in any spelling", () => {
    // `#` is the category prefix in the palette, so the "#CODE" spelling is not a direct ref here.
    for (const raw of ["ORD-3F9K2M7Q", "ord-3f9k2m7q", "3f9k2m7q"]) {
      const parsed = parseCommand(raw);
      assert.deepEqual(parsed.direct, { kind: "order", code: "ORD-3F9K2M7Q", href: "/orders/ORD-3F9K2M7Q" }, raw);
    }
    // Eight plain digits are a legacy id, never a code; ordinary words are not codes either.
    assert.equal(parseCommand("12345678").direct, null);
    assert.equal(parseCommand("facebook").direct, null);
    // A letters-only code still works with its prefix.
    assert.deepEqual(parseCommand("ord-abcdefgh").direct, { kind: "order", code: "ORD-ABCDEFGH", href: "/orders/ORD-ABCDEFGH" });
    assert.equal(parseCommand("#3F9K2M7Q").scope, "categories");
  });

  it("opens a pasted same-origin path, dropping the locale prefix", () => {
    assert.deepEqual(parseCommand("/vi/products/proxy-dan-cu-k7f3q9x2").direct, { kind: "path", href: "/products/proxy-dan-cu-k7f3q9x2" });
    assert.deepEqual(parseCommand("/wallet").direct, { kind: "path", href: "/wallet" });
    assert.equal(parseCommand("//evil.example/x").direct, null);
    assert.equal(parseCommand("/has space").direct, null);
    // Direct refs only apply to the mixed scope.
    assert.equal(parseCommand("#/wallet").direct, null);
  });
});

describe("foldText / matchesLabel", () => {
  it("folds Vietnamese diacritics including đ", () => {
    assert.equal(foldText("Tài Khoản Đẹp"), "tai khoan dep");
  });

  it("matches labels by substring, keyword and subsequence, accent-insensitively", () => {
    assert.equal(matchesLabel("don hang", "My orders", ["đơn hàng", "purchases"]), true);
    assert.equal(matchesLabel("ĐƠN", "My orders", ["đơn hàng"]), true);
    assert.equal(matchesLabel("sdb", "Seller dashboard"), true);
    assert.equal(matchesLabel("wallet", "Seller dashboard", ["shop"]), false);
    assert.equal(matchesLabel("", "Anything"), true);
    // Single characters do not subsequence-match (too noisy).
    assert.equal(matchesLabel("z", "Seller dashboard"), false);
  });
});

describe("results page filters", () => {
  it("parses URL state with safe defaults", () => {
    const parsed = parseSearchFilters(new URLSearchParams("q=+tai+khoan+&sort=price_asc&stock=1&instant=0&cat=12&page=3"));
    assert.deepEqual(parsed, { q: "tai khoan", sort: "price_asc", inStock: true, instant: false, categoryId: 12, page: 3 });
    assert.deepEqual(parseSearchFilters({ sort: "bogus", page: "-2", cat: "abc" }), DEFAULT_SEARCH_FILTERS);
    assert.deepEqual(parseSearchFilters({ q: ["first", "second"] }).q, "first");
  });

  it("round-trips through a short query string and omits defaults", () => {
    assert.equal(searchFiltersToQuery(DEFAULT_SEARCH_FILTERS), "");
    const filters = { ...DEFAULT_SEARCH_FILTERS, q: "proxy", sort: "newest" as const, instant: true, categoryId: 4, page: 2 };
    const qs = searchFiltersToQuery(filters);
    assert.equal(qs, "?q=proxy&sort=newest&instant=1&cat=4&page=2");
    assert.deepEqual(parseSearchFilters(new URLSearchParams(qs)), filters);
    assert.equal(searchPageHref({ q: "tài khoản" }), "?q=t%C3%A0i+kho%E1%BA%A3n".replace("?", "/search?"));
  });

  it("maps page filters to the backend query", () => {
    const api = new URLSearchParams(searchFiltersToApiQuery({ ...DEFAULT_SEARCH_FILTERS, q: "acc", inStock: true, categoryId: 7, sort: "rating" }));
    assert.equal(api.get("q"), "acc");
    assert.equal(api.get("per_page"), "24");
    assert.equal(api.get("in_stock"), "true");
    assert.equal(api.get("category_id"), "7");
    assert.equal(api.get("sort"), "rating");
    assert.equal(api.get("fulfillment"), null);
  });
});

describe("recent searches", () => {
  it("dedupes case/accent-insensitively, newest first, capped", () => {
    let list = pushRecentSearch([], "Tài khoản");
    list = pushRecentSearch(list, "proxy");
    list = pushRecentSearch(list, "tai khoan");
    assert.deepEqual(list, ["tai khoan", "proxy"]);
    for (let i = 0; i < 10; i += 1) list = pushRecentSearch(list, `q${i}`);
    assert.equal(list.length, 6);
    assert.equal(pushRecentSearch(list, "   ").length, 6);
    assert.deepEqual(removeRecentSearch(["a", "B"], "b"), ["a"]);
  });

  it("sanitises whatever came out of storage", () => {
    assert.deepEqual(sanitizeRecentSearches(["ok", 3, "", "  ok ", null, "x".repeat(100)]), ["ok", "x".repeat(80)]);
    assert.deepEqual(sanitizeRecentSearches("nope"), []);
  });
});

describe("quick actions", () => {
  it("gates by audience", () => {
    const anon = visibleActions(null).map((a) => a.id);
    assert.ok(anon.includes("signIn") && anon.includes("home"));
    assert.ok(!anon.includes("orders") && !anon.includes("sellerDashboard"));

    const buyer = visibleActions({ roles: ["buyer"] }).map((a) => a.id);
    assert.ok(buyer.includes("orders") && buyer.includes("becomeSeller") && buyer.includes("signOut"));
    assert.ok(!buyer.includes("signIn") && !buyer.includes("sellerDashboard") && !buyer.includes("admin"));

    const seller = visibleActions({ roles: ["buyer", "seller"] }).map((a) => a.id);
    assert.ok(seller.includes("sellerNewProduct") && !seller.includes("becomeSeller"));

    const admin = QUICK_ACTIONS.find((a) => a.id === "admin")!;
    assert.equal(actionVisible(admin, { roles: ["buyer", "admin"] }), true);
    assert.equal(actionVisible(admin, { roles: ["seller"] }), false);
  });

  it("every link action points at a locale-free absolute path", () => {
    for (const action of QUICK_ACTIONS) {
      if (action.kind !== "link") continue;
      assert.match(action.href!, /^\/(?!(en|vi)(\/|$))/, action.id);
    }
  });
});
