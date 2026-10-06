import assert from "node:assert/strict";
import test from "node:test";

import type { Transaction } from "../lib/types.ts";
import {
  DEFAULT_TX_VIEW, hasTxFilters, kindsOfGroup, matchesWordStarts, parseTxView, periodBounds,
  txChannel, txGroup, txLabelKey, txState, txViewToSearch,
} from "../features/wallet-ledger/model.ts";

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: 1, type: "deposit", amount: 100_000, direction: "in", description: null, reference_id: null,
    created_at: "2026-10-05T10:00:00+07:00", ...over,
  };
}

test("rows fall into buying, selling, funds and other", () => {
  assert.equal(txGroup("purchase_hold"), "buy");
  assert.equal(txGroup("refund"), "buy");
  assert.equal(txGroup("purchase_release"), "sell");
  assert.equal(txGroup("promo_subsidy"), "sell");
  assert.equal(txGroup("deposit"), "funds");
  assert.equal(txGroup("withdraw_lock"), "funds");
  assert.equal(txGroup("affiliate_commission"), "other");
  assert.equal(txGroup("something_new"), "other");
  assert.deepEqual(kindsOfGroup("buy"), ["purchase", "refund"]);
  assert.equal(kindsOfGroup("all").length, 7);
});

test("labels and channels never name the processor", () => {
  assert.equal(txLabelKey(tx({ description: "Nạp tiền qua SePay" })), "deposit_bank");
  assert.equal(txLabelKey(tx({ reference_id: "nowpayments-1" })), "deposit_usdt");
  assert.equal(txChannel(tx({ description: "USDT TRC20" })), "usdt");
  assert.equal(txChannel(tx({ type: "withdraw_lock" })), "bank");
  assert.equal(txChannel(tx({ type: "purchase_hold" })), null);
  assert.equal(txLabelKey(tx({ type: "purchase_release" })), "purchase_release");
  assert.equal(txLabelKey(tx({ type: "brand_new_type" })), "unknown");
});

test("state follows the order for purchases and the request for withdrawals", () => {
  const hold = (order_status: string) => txState(tx({ type: "purchase_hold", direction: "out", order_status }));
  assert.deepEqual(hold("delivered"), { key: "buy_awaiting_confirm", tone: "warn", open: true });
  assert.deepEqual(hold("disputed"), { key: "buy_disputed", tone: "bad", open: true });
  assert.equal(hold("completed").key, "buy_paid_to_shop");
  assert.equal(hold("cancelled").key, "buy_refunded");
  const lock = (withdraw_status: Transaction["withdraw_status"]) =>
    txState(tx({ type: "withdraw_lock", direction: "out", withdraw_status }));
  assert.equal(lock("pending").open, true);
  assert.equal(lock("approved").open, true);
  assert.deepEqual(lock("paid"), { key: "withdraw_paid", tone: "good", open: false });
  assert.equal(lock("rejected").open, false);
  // An old lock whose request is unknown is not "waiting" forever.
  assert.equal(lock(null).open, false);
  assert.equal(txState(tx({ type: "withdraw", direction: "neutral" })).key, "settled");
  assert.equal(txState(tx({ type: "adjustment_debit", direction: "out" })).key, "debited");
});

test("the URL view round-trips and reads older links", () => {
  const view = parseTxView(new URLSearchParams("q=ORD-1&kind=refund&dir=in&open=1&channel=bank&period=custom&from=2026-10-09&to=2026-10-01&page=3"));
  assert.equal(view.group, "buy"); // implied by the kind
  assert.deepEqual([view.from, view.to], ["2026-10-01", "2026-10-09"]);
  assert.deepEqual(parseTxView(new URLSearchParams(txViewToSearch(view).slice(1))), view);
  const legacy = parseTxView(new URLSearchParams("dir=pending&via=usdt"));
  assert.equal(legacy.open, true);
  assert.equal(legacy.dir, "all");
  assert.equal(legacy.channel, "usdt");
  const junk = parseTxView(new URLSearchParams("group=sell&kind=refund&period=yesterday&page=-2&channel=gmmo"));
  assert.equal(junk.kind, "all"); // a kind outside its group is dropped
  assert.equal(junk.period, "all");
  assert.equal(junk.page, 1);
  assert.equal(junk.channel, "all");
  assert.equal(txViewToSearch(DEFAULT_TX_VIEW), "");
  assert.equal(hasTxFilters({ ...DEFAULT_TX_VIEW, page: 4 }), false);
  assert.equal(hasTxFilters({ ...DEFAULT_TX_VIEW, open: true }), true);
});

test("periods are local days, end exclusive", () => {
  const now = new Date(2026, 9, 6, 15, 30);
  assert.deepEqual(periodBounds({ period: "7d", from: "", to: "" }, now), { start: new Date(2026, 8, 30) });
  assert.deepEqual(periodBounds({ period: "last_month", from: "", to: "" }, now), { start: new Date(2026, 8, 1), end: new Date(2026, 9, 1) });
  assert.deepEqual(periodBounds({ period: "custom", from: "2026-10-01", to: "" }, now), { start: new Date(2026, 9, 1) });
  assert.deepEqual(periodBounds({ period: "custom", from: "", to: "2026-10-02" }, now), { end: new Date(2026, 9, 3) });
});

test("search matches word starts, code fragments anywhere", () => {
  assert.equal(matchesWordStarts("Hoàn tiền đơn mua ORD-ZNR6", "hoan tien"), true);
  assert.equal(matchesWordStarts("Chuyển khoản rút tiền", "hoan tien"), false);
  assert.equal(matchesWordStarts("Thanh toán đơn mua ORD-ZNR6AB", "znr6"), true);
  assert.equal(matchesWordStarts("Thanh toán đơn mua ORD-ZNR6AB", "ord-znr"), true);
  assert.equal(matchesWordStarts("Nạp tiền qua ngân hàng FT123", "ngan hang"), true);
  assert.equal(matchesWordStarts("anything", "  "), true);
});
