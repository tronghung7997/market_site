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
    // A commission points at someone else's order: no link.
    assert.equal(txOrderHref({ type: "affiliate_commission", order_code: "ORD-A1" }), null);
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
    // System notes that only repeat the label (some English) are dropped.
    assert.equal(txNote("Order payment"), null);
    assert.equal(txNote("Order refund"), null);
    assert.equal(txNote("Khoá tiền chờ duyệt rút"), null);
    assert.equal(txNote("Mua Gmail — 1 tháng (x2)"), "Mua Gmail — 1 tháng (x2)");
    // Deposit / promo notes that echo the label keep only their extra detail.
    assert.equal(txNote("Nạp tiền chuyển khoản ngân hàng"), null);
    assert.equal(txNote("Nạp tiền qua SePay (lệnh #12)"), null);
    assert.equal(txNote("Nạp tiền USDT (lệnh #3)"), null);
    assert.equal(txNote("Nạp tiền chuyển khoản ngân hàng — LỆCH: dự kiến 100, thực nhận 90"), "LỆCH: dự kiến 100, thực nhận 90");
    assert.equal(txNote("Sàn bù khuyến mãi SALE10"), "SALE10");
    assert.equal(txNote("Mua Gmail — Gói 1"), "Mua Gmail — Gói 1");
    assert.equal(txNote(null), null);
  });

  it("never names the payment processor", () => {
    // What is left after hiding the processor only repeats the label, so nothing shows.
    for (const raw of ["Nạp tiền qua SePay (lệnh #12)", "Nạp tiền qua PayOS (lệnh #3)", "Nạp tiền USDT (NOWPayments)",
      "Nạp tiền chuyển khoản ngân hàng (lệnh #40)", "Nạp tiền USDT (lệnh #7)"]) {
      assert.equal(txNote(raw), null);
    }
    assert.equal(txNote("Nạp tiền qua SePay — LỆCH: dự kiến 5, thực nhận 4"), "LỆCH: dự kiến 5, thực nhận 4");
    assert.equal(txNote("Top-up via PayOS"), "Top-up by bank transfer");
  });
});
