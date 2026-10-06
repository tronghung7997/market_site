import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { committableDate, isCompleteDate, orderedDateRange } from "../lib/date-input.ts";

describe("date filter input", () => {
  it("rejects the half-typed years a date input reports while typing", () => {
    for (const partial of ["0002-10-06", "0020-10-06", "0202-10-06", "2-10-06", "20261-10-06"]) {
      assert.equal(isCompleteDate(partial), false, partial);
      assert.equal(committableDate(partial), null, partial);
    }
    assert.equal(committableDate("2026-10-06"), "2026-10-06");
  });

  it("rejects days that do not exist", () => {
    assert.equal(isCompleteDate("2026-02-30"), false);
    assert.equal(isCompleteDate("2026-13-01"), false);
    assert.equal(isCompleteDate("2028-02-29"), true);
  });

  it("lets a cleared field through and holds values outside the bounds", () => {
    assert.equal(committableDate(""), "");
    assert.equal(committableDate("2026-10-07", { max: "2026-10-06" }), null);
    assert.equal(committableDate("2026-09-30", { min: "2026-10-01" }), null);
    assert.equal(committableDate("2026-10-03", { min: "2026-10-01", max: "2026-10-06" }), "2026-10-03");
  });

  it("puts a reversed range back in order", () => {
    assert.deepEqual(orderedDateRange("2026-10-06", "2026-10-01"), { from: "2026-10-01", to: "2026-10-06" });
    assert.deepEqual(orderedDateRange("2026-10-01", ""), { from: "2026-10-01", to: "" });
  });
});
