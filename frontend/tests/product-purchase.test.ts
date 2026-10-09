import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  alternativePackages, belowMinimum, clampQty, ctaState, deliverySummary, maxQtyFor, minQtyFor, noticeFor, perOrderBounds,
  resolveSelected,
} from "../app/[locale]/products/[key]/purchase.ts";
import { inspectionDeadline, topUpHref, walletShortfall } from "../features/checkout/model.ts";
import type { Variant } from "../lib/types.ts";

function variant(stock_count: number, delivery_mode: Variant["delivery_mode"]): Variant {
  return {
    id: 1,
    name: "Bulk",
    price: 1,
    stock_count,
    delivery_mode,
  } as Variant;
}

describe("product purchase quantity", () => {
  it("allows an instant order up to available stock and the global 5,000 cap", () => {
    assert.equal(maxQtyFor(variant(4_000, "instant")), 4_000);
    assert.equal(maxQtyFor(variant(8_000, "instant")), 5_000);
  });

  it("clamps manual and instant quantities to 5,000", () => {
    assert.equal(clampQty(6_000, variant(8_000, "instant")), 5_000);
    assert.equal(clampQty(6_000, variant(0, "manual")), 5_000);
  });
});


describe("checkout wallet shortfall", () => {
  it("is zero when the balance covers the total or is unknown", () => {
    assert.equal(walletShortfall(50_000, 80_000), 0);
    assert.equal(walletShortfall(50_000, 50_000), 0);
    assert.equal(walletShortfall(50_000, null), 0);
    assert.equal(walletShortfall(50_000, undefined), 0);
  });

  it("returns the missing amount, rounded up to a whole unit", () => {
    assert.equal(walletShortfall(50_000, 12_000), 38_000);
    assert.equal(walletShortfall(10.4, 10), 1);
  });

  it("builds a wallet link that prefills the amount and only keeps a local return path", () => {
    assert.equal(topUpHref(38_000, "/products/gmail-abc12345"), "/wallet?amount=38000&return=%2Fproducts%2Fgmail-abc12345");
    assert.equal(topUpHref(5, "https://evil.example"), "/wallet?amount=5");
    assert.equal(topUpHref(5, "//evil.example"), "/wallet?amount=5");
  });

  it("knows the inspection deadline only when delivery is instant", () => {
    const now = Date.UTC(2026, 8, 27, 10, 0);
    assert.equal(inspectionDeadline(now, 48, true)?.toISOString(), "2026-09-29T10:00:00.000Z");
    assert.equal(inspectionDeadline(now, 48, false), null);
    assert.equal(inspectionDeadline(now, 0, true), null);
    // Holds are in hours: a 30 h hold ends 30 h later.
    assert.equal(inspectionDeadline(now, 30, true)?.toISOString(), "2026-09-28T16:00:00.000Z");
  });
});

describe("delivery summary fact", () => {
  const v = (delivery_mode: Variant["delivery_mode"], sla_hours: number | null = null, is_active = true) =>
    ({ id: 1, name: "x", price: 1, delivery_mode, sla_hours, is_active }) as unknown as Variant;

  it("says instant when every active package is instant", () => {
    assert.deepEqual(deliverySummary([v("instant"), v("manual", 6, false)], "fixed"), { kind: "instant" });
  });

  it("promises the slowest SLA for manual packages, and flags a mix", () => {
    assert.deepEqual(deliverySummary([v("manual", 6), v("manual", 24)], "fixed"), { kind: "hours", hours: 24 });
    assert.deepEqual(deliverySummary([v("instant"), v("manual", 12)], null), { kind: "mixed", hours: 12 });
  });

  it("treats provider-backed products as automatic", () => {
    assert.deepEqual(deliverySummary([], "config"), { kind: "auto" });
  });
});

describe("per-order bounds", () => {
  const pkg = (extra: Partial<Variant>) => ({ ...variant(10, "instant"), max_quantity: 10, ...extra }) as Variant;

  it("keeps the quantity inside the seller's bounds", () => {
    const bounded = pkg({ min_per_order: 3, max_per_order: 5, max_quantity: 5 });
    assert.equal(minQtyFor(bounded), 3);
    assert.equal(clampQty(1, bounded), 3);
    assert.equal(clampQty(9, bounded), 5);
    assert.equal(minQtyFor(pkg({})), 1);
    assert.equal(minQtyFor(null), 1);
  });

  it("describes only bounds that exist", () => {
    assert.equal(perOrderBounds(pkg({})), null);
    assert.deepEqual(perOrderBounds(pkg({ min_per_order: 2 })), { min: 2, max: null });
    assert.deepEqual(perOrderBounds(pkg({ max_per_order: 4 })), { min: 1, max: 4 });
  });

  it("blocks buying when stock cannot cover one order", () => {
    const thin = pkg({ min_per_order: 5, max_quantity: 3 });
    assert.equal(belowMinimum(thin), true);
    assert.equal(belowMinimum(pkg({ min_per_order: 5 })), false);
    assert.equal(belowMinimum({ ...thin, delivery_mode: "manual" } as Variant), false);
    assert.deepEqual(ctaState({ loggedIn: true, placing: false, selected: thin }), {
      labelKey: "notEnoughStock", disabled: true, intent: "none",
    });
  });
});

describe("recovering a confirm dialog", () => {
  const pkg = (id: number, price: number, stock_state: Variant["stock_state"], extra: Partial<Variant> = {}) =>
    ({ id, name: `P${id}`, price, stock_state, delivery_mode: "instant", is_active: true, ...extra }) as Variant;

  it("keeps the picked package with its current price and stock", () => {
    const fresh = [pkg(1, 1000, "in_stock"), pkg(2, 2500, "in_stock")];
    assert.equal(resolveSelected(fresh, 2)?.price, 2500);
    assert.equal(resolveSelected(fresh, null)?.id, 1);
    // A package that disappeared falls back to the default.
    assert.equal(resolveSelected(fresh, 9)?.id, 1);
  });

  it("lets a made-to-order package be bought and blocks dry or paused ones", () => {
    const manual = pkg(1, 290000, "manual", { delivery_mode: "manual", max_quantity: 50 });
    assert.deepEqual(ctaState({ loggedIn: true, placing: false, selected: manual }), { labelKey: "placeOrder", disabled: false, intent: "confirm" });
    assert.equal(maxQtyFor(manual), 50);
    assert.deepEqual(ctaState({ loggedIn: true, placing: false, selected: pkg(2, 1000, "out") }), { labelKey: "outOfStock", disabled: true, intent: "none" });
    assert.deepEqual(ctaState({ loggedIn: true, placing: false, selected: pkg(3, 1000, "paused") }), { labelKey: "pausedLabel", disabled: true, intent: "none" });
    // The default pick skips dry packages but lands on the made-to-order one.
    assert.equal(resolveSelected([pkg(4, 1000, "out"), manual], null)?.id, 1);
  });

  it("offers other packages that can still be bought", () => {
    const variants = [pkg(1, 1000, "out"), pkg(2, 2000, "in_stock"), pkg(3, 0, "in_stock"), pkg(4, 900, "low"), pkg(5, 900, "in_stock", { is_active: false })];
    assert.deepEqual(alternativePackages(variants, 1).map((v) => v.id), [2, 4]);
    assert.deepEqual(alternativePackages(variants, 2, 1).map((v) => v.id), [4]);
  });

  it("recognises the errors it can recover from", () => {
    assert.deepEqual(noticeFor("ORDER_PRICE_CHANGED", 1000), { kind: "price", oldPrice: 1000 });
    assert.deepEqual(noticeFor("RESOURCE_UNAVAILABLE", 1000), { kind: "soldOut" });
    assert.equal(noticeFor("INSUFFICIENT_BALANCE", 1000), null);
    assert.equal(noticeFor(undefined, 1000), null);
  });
});
