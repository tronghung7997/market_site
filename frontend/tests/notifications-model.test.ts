import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bellBadge, notificationMessage, relativeTime } from "../features/notifications/model.ts";

const money = (amount: number) => `${amount}đ`;
const row = (kind: string, params: Record<string, string | number | boolean | null>, href: string | null = null) => ({ kind, params, href });

describe("notification messages", () => {
  it("picks the seller wording for two-sided order events", () => {
    assert.equal(notificationMessage(row("order_refunded", { order_code: "ORD-1" }, "/orders/ORD-1"), money).key, "order_refunded");
    assert.equal(notificationMessage(row("order_refunded", { order_code: "ORD-1" }, "/seller/orders/ORD-1"), money).key, "order_refunded_seller");
    assert.equal(notificationMessage(row("dispute_resolved", { order_code: "ORD-1", outcome: "resolved_reject" }, "/seller/orders/ORD-1"), money).key, "dispute_resolved_seller");
    // One-sided kinds keep their key whatever the link.
    assert.equal(notificationMessage(row("order_new", { order_code: "ORD-1" }, "/seller/orders/ORD-1"), money).key, "order_new");
  });

  it("tells a seller that a stock order already went out", () => {
    const auto = notificationMessage(row("order_new", { order_code: "ORD-2", auto: true }, "/seller/orders/ORD-2"), money);
    assert.deepEqual(auto, { key: "order_new_auto", values: { order_code: "ORD-2" } });
  });

  it("formats amounts and flags an optional reason", () => {
    const paid = notificationMessage(row("deposit_credited", { amount: 20000, code: "NAP123" }), money);
    assert.equal(paid.values.amount, "20000đ");
    assert.equal(paid.values.code, "NAP123");
    assert.equal(notificationMessage(row("withdrawal_rejected", { amount: 5, reason: "Sai STK" }), money).values.hasReason, "yes");
    assert.equal(notificationMessage(row("withdrawal_rejected", { amount: 5 }), money).values.hasReason, "no");
  });

  it("words a chat by who wrote it, and unknown kinds generically", () => {
    const shop = notificationMessage(row("chat_message", { from: "shop", name: "Kho A", count: 3 }), money);
    assert.deepEqual(shop, { key: "chat_message_shop", values: { name: "Kho A", count: 3 } });
    assert.equal(notificationMessage(row("chat_message", { from: "desk", count: 1 }), money).key, "chat_message_desk");
    assert.equal(notificationMessage(row("chat_message", { from: "???" }), money).key, "chat_message_buyer");
    assert.deepEqual(notificationMessage(row("something_new", {}), money), { key: "unknown", values: {} });
  });

  it("words tier, fee-promo and cashback rows", () => {
    const cashback = notificationMessage(row("cashback_credited", { amount: 30, order_code: "ORD-9", rate: 3 }), money);
    assert.equal(cashback.key, "cashback_credited");
    assert.equal(cashback.values.amount, "30đ");
    assert.equal(cashback.values.rate, 3);
    const promo = notificationMessage(row("seller_fee_promo", { fee_percent: 0, ends_at: "2027-01-05T03:00:00+00:00" }), money);
    assert.equal(promo.values.date, "05/01/2027");
    assert.equal(promo.values.fee, 0);
    // An open-ended own fee has no end date.
    assert.deepEqual(notificationMessage(row("seller_fee_promo", { fee_percent: 2.5 }), money), { key: "seller_fee_promo_open", values: { fee: 2.5 } });
    assert.equal(notificationMessage(row("tier_at_risk", { tier: "verified", days: 14 }), money).values.days, 14);
    assert.equal(notificationMessage(row("buyer_tier_changed", { old: "l1", new: "l2" }), money).values.new, "l2");
  });
});

describe("bell badge", () => {
  it("counts unread notifications and shows a dot for to-dos only", () => {
    assert.deepEqual(bellBadge(3, 5), { count: 3, dot: false });
    assert.deepEqual(bellBadge(0, 2), { count: 0, dot: true });
    assert.deepEqual(bellBadge(0, 0), { count: 0, dot: false });
  });
});

describe("relative time", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  it("goes from seconds to days, then a date", () => {
    assert.equal(relativeTime("2026-09-27T11:59:30Z", now, "en"), "now");
    assert.equal(relativeTime("2026-09-27T11:55:00Z", now, "en"), "5 minutes ago");
    assert.equal(relativeTime("2026-09-27T09:00:00Z", now, "en"), "3 hours ago");
    assert.equal(relativeTime("2026-09-26T12:00:00Z", now, "en"), "yesterday");
    assert.match(relativeTime("2026-09-01T12:00:00Z", now, "en"), /Sep 1, 2026/);
    assert.equal(relativeTime("2026-09-27T11:55:00Z", now, "vi"), "5 phút trước");
  });
});
