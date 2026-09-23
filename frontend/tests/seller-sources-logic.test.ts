import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceDays,
  blockReason,
  countListings,
  existingProducts,
  fixPrice,
  listingState,
  lowBalance,
  needsAction,
  planPlacement,
  suggestPrice,
} from "../features/seller-sources/logic.ts";
import type { SourceCatalogItem, SourceListing } from "../lib/types.ts";

function listing(over: Partial<SourceListing> = {}): SourceListing {
  return {
    listing_id: 1, provider_id: 1, product_id: 10, product_title: "Clone Facebook", product_status: "active",
    public_key: "abcd1234", seller_id: 2, variant_id: 5, variant_public_key: "v1", variant_name: "Reg 1–7 ngày",
    variant_active: true, price: 6000, external_id: "128630", external_name: "H160. Clone", cost_price: 3920,
    margin_pct: 53.1, margin_ok: true, upstream_amount: 100, sellable: 100, upstream_min: 1, upstream_max: null,
    format_hint: null, synced_at: null, sync_error: null, fail_streak: 0, last_fail_at: null, last_fail_reason: null,
    auto_paused_at: null, category_path: ["Facebook"], group_name: "Facebook", price_manual: false, rule_price: 6000,
    ...over,
  };
}

function item(over: Partial<SourceCatalogItem> = {}): SourceCatalogItem {
  return {
    external_id: "1", name: "H201. Clone Name Random | Reg 3-7 Ngày", cost_price: 3360, amount: 50, min_qty: 1,
    max_qty: null, format_hint: null, group_name: "Facebook", category_path: ["Facebook"], synced_at: "", attached: [],
    ...over,
  };
}

test("suggestPrice rounds up like the backend", () => {
  assert.equal(suggestPrice(2800, 30), 4000);
  assert.equal(suggestPrice(2800, 30, 100), 3700);
  assert.equal(suggestPrice(0, 30), 0);
});

test("a variant has exactly one of three states, with the blocking reason first", () => {
  assert.equal(listingState(listing()), "selling");
  assert.equal(listingState(listing({ variant_active: false })), "off");
  assert.equal(blockReason(listing({ sync_error: "delisted", variant_active: false })), "delisted");
  assert.equal(blockReason(listing({ auto_paused_at: "2026-09-23T00:00:00Z", variant_active: false })), "autoPaused");
  assert.equal(blockReason(listing({ margin_ok: false })), "lowMargin");
  assert.equal(blockReason(listing({ sellable: 0 })), "outOfStock");
  // Tắt tay + lãi thấp: là "Bạn đã tắt", không phải việc cần làm.
  assert.equal(listingState(listing({ variant_active: false, margin_ok: false })), "off");
  assert.equal(needsAction(listing({ sellable: 0 })), false);
  assert.equal(needsAction(listing({ margin_ok: false })), true);
  assert.deepEqual(
    countListings([listing(), listing({ margin_ok: false }), listing({ variant_active: false })]),
    { all: 3, selling: 1, blocked: 1, off: 1 },
  );
});

test("fixPrice clears the minimum margin and never goes below the rule price", () => {
  const rule = { markup_pct: 30, round_to: 1000 };
  // vốn 4.600: luật 30% → 6.000; sàn 10% → 6.000 (5.060 làm tròn)
  assert.equal(fixPrice(listing({ cost_price: 4600 }), 10, rule), 6000);
  // luật thấp hơn ngưỡng → lấy ngưỡng
  assert.equal(fixPrice(listing({ cost_price: 4600 }), 40, { markup_pct: 5, round_to: 1000 }), 7000);
});

test("balance lasts balance / daily cost, unknown without sales", () => {
  assert.equal(balanceDays(1_240_000, 1_396_640), 6);
  assert.equal(balanceDays(1_240_000, 0), null);
  assert.equal(balanceDays(null, 1000), null);
  assert.equal(lowBalance({ balance_vnd: 85_000, low_balance_vnd: 200_000 }), true);
  assert.equal(lowBalance({ balance_vnd: 85_000, low_balance_vnd: null }), false);
});

test("planPlacement puts a group with a product on sale into that product, others into new drafts", () => {
  const existing = existingProducts([listing()]);
  const rule = { markup_pct: 30, round_to: 1000 };
  const plan = planPlacement(
    [item(), item({ external_id: "2", name: "Gmail New | Reg US", group_name: "Gmail", category_path: ["Gmail"], cost_price: 3080 })],
    existing, rule,
  );
  assert.deepEqual(plan.variants.map((v) => [v.external_id, v.target, v.price]), [
    ["1", "existing:10", 5000],
    ["2", "new:Gmail", 5000],
  ]);
  assert.deepEqual(plan.products.map((p) => p.key), ["new:Gmail"]);
  assert.equal(plan.variants[0].variant_name, "Clone Name Random | Reg 3-7 Ngày");

  // Sửa tay được giữ khi chọn thêm mặt hàng.
  const edited = {
    products: plan.products.map((p) => ({ ...p, title: "Gmail US", category_id: 7 })),
    variants: plan.variants.map((v) => (v.external_id === "1" ? { ...v, price: 9000, target: "new:1" } : v)),
  };
  const again = planPlacement([item(), item({ external_id: "2", group_name: "Gmail", category_path: ["Gmail"], cost_price: 3080 })], existing, rule, {
    ...edited, products: [...edited.products, { key: "new:1", title: "Riêng", category_id: 3, group: "Facebook" }],
  });
  assert.equal(again.variants[0].price, 9000);
  assert.equal(again.variants[0].target, "new:1");
  assert.deepEqual(again.products.map((p) => [p.key, p.title, p.category_id]), [["new:1", "Riêng", 3], ["new:Gmail", "Gmail US", 7]]);
});
