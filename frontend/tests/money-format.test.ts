import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatBrowseMoney,
  formatCheckoutMoney,
  formatUnitMoney,
} from "../lib/money/format.ts";

const USD = { locale: "en", currency: "USD" as const, fxRate: 26_000 };

describe("display money formatting", () => {
  it("never renders a positive sub-cent VND amount as zero USD", () => {
    assert.equal(formatBrowseMoney(10, USD), "$0.000385");
    assert.equal(formatCheckoutMoney(12, USD), "$0.000462");
    assert.equal(formatUnitMoney(10, USD), "$0.000385");
  });

  it("keeps ordinary USD display amounts at two decimal places", () => {
    assert.equal(formatBrowseMoney(500_000, USD), "$19.23");
  });
});
