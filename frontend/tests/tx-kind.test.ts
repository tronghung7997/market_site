import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { txKind, txNote, txOrderHref, txStatus } from "../lib/tx-kind.ts";

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

  it("reads a purchase's status from its order, not from the ledger type", () => {
    assert.deepEqual(txStatus({ type: "purchase_hold", order_status: "completed" }), { kind: "hold", orderStatus: "completed" });
    assert.deepEqual(txStatus({ type: "purchase_hold", order_status: "delivered" }), { kind: "hold", orderStatus: "delivered" });
    assert.deepEqual(txStatus({ type: "withdraw_lock" }), { kind: "pending" });
    assert.deepEqual(txStatus({ type: "topup" }), { kind: "recorded" });
  });

  it("keeps only the admin reason of a credit as its note", () => {
    assert.equal(txNote("Admin topup — Bù phí"), "Bù phí");
    assert.equal(txNote("Admin topup"), null);
    assert.equal(txNote("Demo topup"), null);
    assert.equal(txNote("GMMO cộng tiền — Bù phí"), "Bù phí");
    assert.equal(txNote("Nạp thử (demo)"), null);
    assert.equal(txNote("Mua Gmail — Gói 1"), "Mua Gmail — Gói 1");
    assert.equal(txNote(null), null);
  });

  it("never names the payment processor", () => {
    assert.equal(txNote("Nạp tiền qua SePay (lệnh #12)"), "Nạp tiền chuyển khoản ngân hàng");
    assert.equal(txNote("Nạp tiền qua PayOS (lệnh #3)"), "Nạp tiền chuyển khoản ngân hàng");
    assert.equal(txNote("Nạp tiền USDT (NOWPayments)"), "Nạp tiền USDT");
    assert.equal(txNote("Nạp tiền chuyển khoản ngân hàng (lệnh #40)"), "Nạp tiền chuyển khoản ngân hàng");
    assert.equal(txNote("Nạp tiền USDT (lệnh #7)"), "Nạp tiền USDT");
  });
});
