import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { txKind, txOrderHref } from "../lib/tx-kind.ts";

describe("ledger row kinds", () => {
  it("groups ledger types", () => {
    assert.equal(txKind("deposit"), "topup");
    assert.equal(txKind("topup"), "topup");
    assert.equal(txKind("purchase_hold"), "purchase");
    assert.equal(txKind("purchase_release"), "sale");
    assert.equal(txKind("withdraw_unlock"), "withdraw");
    assert.equal(txKind("affiliate_clawback"), "affiliate");
    assert.equal(txKind("something_new"), "adjustment");
  });

  it("links a row to the side of the order it belongs to", () => {
    assert.equal(txOrderHref({ type: "purchase_hold", order_code: "ORD-A1" }), "/orders?order=ORD-A1");
    assert.equal(txOrderHref({ type: "refund", order_code: "ORD-A1" }), "/orders?order=ORD-A1");
    assert.equal(txOrderHref({ type: "purchase_release", order_code: "ORD-A1" }), "/seller/orders/ORD-A1");
    assert.equal(txOrderHref({ type: "deposit", order_code: null }), null);
  });
});
