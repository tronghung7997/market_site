import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AUDIT_ITEMS, catalogIntegrity } from "../features/site-audit/model/catalog.ts";
import { GATES, SURFACES } from "../features/site-audit/model/types.ts";
import {
  defaultFilters,
  emptyStore,
  filterItems,
  parseStore,
  statusOf,
  summarize,
} from "../features/site-audit/model/score.ts";

describe("site audit catalog", () => {
  it("has unique complete items covering every surface and gate", () => {
    assert.deepEqual(catalogIntegrity(), []);
    assert.ok(AUDIT_ITEMS.length >= 30);
    for (const surface of SURFACES) {
      assert.ok(AUDIT_ITEMS.some((item) => item.surface === surface), `missing ${surface}`);
    }
    for (const gate of GATES) {
      assert.ok(AUDIT_ITEMS.some((item) => item.gate === gate), `missing ${gate}`);
    }
  });

  it("treats unmarked items as open unless baseline is known debt", () => {
    const store = emptyStore();
    const open = AUDIT_ITEMS.find((item) => item.baseline === "fail");
    const debt = AUDIT_ITEMS.find((item) => item.baseline === "na");
    assert.ok(open && debt);
    assert.equal(statusOf(open, store), "open");
    assert.equal(statusOf(debt, store), "na");
    const marked = { ...store, verdicts: { [open.id]: "pass" as const } };
    assert.equal(statusOf(open, marked), "pass");
  });

  it("summarizes and filters without inventing extra items", () => {
    const fail = AUDIT_ITEMS.find((item) => item.baseline === "fail");
    assert.ok(fail);
    const store = parseStore({
      version: 1,
      verdicts: { [fail.id]: "fail", nope: "maybe" },
      notes: { [fail.id]: "reproduced" },
    });
    const summary = summarize(AUDIT_ITEMS, store);
    assert.equal(summary.total, AUDIT_ITEMS.length);
    assert.equal(summary.fail, 1);
    assert.equal(summary.pass + summary.fail + summary.skip + summary.open + summary.na, summary.total);

    const onlyFail = filterItems(AUDIT_ITEMS, store, { ...defaultFilters(), status: "fail" });
    assert.deepEqual(onlyFail.map((item) => item.id), [fail.id]);
  });
});
