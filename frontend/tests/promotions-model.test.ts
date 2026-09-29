import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePromoCode, payableTotal, promoQuoteKey } from "../features/checkout/model.ts";
import {
  conditionChips, describeCampaign, describeOffer, draftFromPromotion, emptyDraft, matchesFilter, randomCode,
  usageRatio, validateDraft,
} from "../features/admin-promotions/model.ts";
import type { Promotion } from "../lib/types.ts";

const money = (n: number) => `${n.toLocaleString("vi-VN")} ₫`;

test("checkout: a quote holds only for the body it priced", () => {
  const body = { variant_id: 7, quantity: 2, expected_unit_price: 1000 };
  const key = promoQuoteKey(body)!;
  assert.equal(promoQuoteKey({ ...body, promo_code: "SALE" }), key, "the code itself is not part of the key");
  const quote = { key, total_amount: 1800 };
  assert.equal(payableTotal(2000, quote, key), 1800);
  assert.equal(payableTotal(3000, quote, promoQuoteKey({ ...body, quantity: 3 })), 3000, "another quantity drops it");
  assert.equal(payableTotal(2000, null, key), 2000);
  assert.equal(promoQuoteKey(null), null);
  assert.equal(normalizePromoCode("  sale10 "), "SALE10");
});

test("admin: draft validation mirrors the API rules", () => {
  const ok = validateDraft({ ...emptyDraft(), code: " welcome ", name: "Khách mới", discount_value: "15", max_discount_amount: "50000" });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.input?.code, "WELCOME");
  assert.equal(ok.input?.max_discount_amount, 50000);
  assert.equal(ok.input?.per_buyer_limit, 1);
  assert.equal(ok.input?.usage_limit, null);

  const fixed = validateDraft({ ...emptyDraft(), code: "OFF20K", name: "x", discount_type: "fixed", discount_value: "20000", max_discount_amount: "5000" });
  assert.equal(fixed.input?.max_discount_amount, null, "a cap never goes out with a fixed discount");

  const bad = validateDraft({ ...emptyDraft(), code: "a", name: " ", discount_value: "150", starts_at: "2026-10-10T10:00", ends_at: "2026-10-01T10:00" });
  assert.equal(bad.input, null);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["code", "discount_value", "ends_at", "name"]);
});

const promo: Promotion = {
  id: 1, code: "SALE10", name: "Sale", note: null, discount_type: "percent", discount_value: 10, max_discount_amount: 50000,
  min_order_amount: 100000, starts_at: null, ends_at: null, usage_limit: 100, per_buyer_limit: 1, budget_amount: 2000000,
  category_ids: [3], new_buyers_only: true, is_active: true, uses: 25, discount_given: 500000, state: "running",
  created_at: null, updated_at: null,
};

test("admin: a campaign reads as plain language", () => {
  assert.equal(describeOffer(promo, money), "Giảm 10%, tối đa 50.000 ₫");
  assert.equal(describeOffer({ discount_type: "fixed", discount_value: 20000, max_discount_amount: null }, money), "Giảm 20.000 ₫");
  assert.deepEqual(conditionChips(promo, money, () => "Facebook"), ["Đơn từ 100.000 ₫", "Facebook", "Chỉ đơn đầu tiên", "1 lần/khách"]);
  const sentence = describeCampaign(promo, money, () => "Facebook");
  assert.match(sentence, /^Khách nhập SALE10 được giảm 10%, tối đa 50\.000 ₫, cho đơn từ 100\.000 ₫, trong Facebook/);
  assert.match(sentence, /Dừng khi hết 100 lượt hoặc ngân sách 2\.000\.000 ₫\./);
  assert.match(sentence, /Thời gian: không thời hạn\.$/);
});

test("admin: round-trip, filters, usage and random codes", () => {
  const again = validateDraft(draftFromPromotion(promo)).input!;
  assert.equal(again.code, promo.code);
  assert.equal(again.budget_amount, promo.budget_amount);
  assert.deepEqual(again.category_ids, promo.category_ids);
  assert.equal(matchesFilter({ state: "exhausted" }, "done"), true);
  assert.equal(matchesFilter({ state: "paused" }, "running"), false);
  assert.equal(usageRatio(25, 100), 0.25);
  assert.equal(usageRatio(150, 100), 1);
  assert.equal(usageRatio(5, null), null);
  const code = randomCode("vip", 6, () => 0);
  assert.equal(code, "VIPAAAAAA");
  assert.match(randomCode(), /^[A-Z2-9]{8}$/);
});
