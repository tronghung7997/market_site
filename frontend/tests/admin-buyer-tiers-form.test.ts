import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buyerChangedCount, fromBuyerForm, toBuyerForm } from "../features/admin-buyer-tiers/form.ts";
import type { BuyerTierConfig } from "../lib/types.ts";

const CFG: BuyerTierConfig = {
  criterion: "total_spent",
  ip_requests_per_minute: 500,
  levels: {
    l1: { name_vi: "Thành viên", name_en: "Member", min_amount: 0, cashback_percent: 0, api_requests_per_minute: 30, api_orders_per_minute: 20 },
    l2: { name_vi: "Thân thiết", name_en: "Loyal", min_amount: 25_000_000, cashback_percent: 1, api_requests_per_minute: 100, api_orders_per_minute: 60 },
    l3: { name_vi: "VIP", name_en: "VIP", min_amount: 125_000_000, cashback_percent: 3, api_requests_per_minute: null, api_orders_per_minute: null },
  },
};

describe("buyer tier settings form", () => {
  it("round-trips saved settings, blank API limit = unlimited", () => {
    const { config, errors } = fromBuyerForm(toBuyerForm(CFG));
    assert.deepEqual(errors, {});
    assert.deepEqual(config, CFG);
    assert.equal(buyerChangedCount(toBuyerForm(CFG), CFG), 0);
  });

  it("accepts a decimal comma and counts changes", () => {
    const form = toBuyerForm(CFG);
    form.criterion = "total_deposit";
    form.levels.l2.cashback_percent = "1,5";
    form.levels.l3.api_requests_per_minute = "500";
    form.ip_requests_per_minute = "2000";
    const { config } = fromBuyerForm(form);
    assert.equal(config?.levels.l2.cashback_percent, 1.5);
    assert.equal(config?.levels.l3.api_requests_per_minute, 500);
    assert.equal(config?.ip_requests_per_minute, 2000);
    assert.equal(buyerChangedCount(form, CFG), 4);
  });

  it("blocks a ladder that does not climb, a non-zero L1, blanks and out-of-range values", () => {
    const form = toBuyerForm(CFG);
    form.levels.l1.min_amount = "5";
    form.levels.l3.min_amount = "1000";
    form.levels.l2.name_en = " ";
    form.levels.l3.cashback_percent = "80";
    form.levels.l1.api_requests_per_minute = "0";
    form.ip_requests_per_minute = "59";
    const { config, errors } = fromBuyerForm(form);
    assert.equal(config, null);
    assert.equal(errors["l1.min_amount"], "L1 luôn bắt đầu từ 0");
    assert.equal(errors["l3.min_amount"], "Phải lớn hơn mức L2");
    assert.equal(errors["l2.name_en"], "Bắt buộc");
    assert.ok(errors["l3.cashback_percent"]);
    assert.ok(errors["l1.api_requests_per_minute"]);
    assert.equal(errors["ip_requests_per_minute"], "Từ 60 đến 10.000");
  });

  it("requires the per-IP limit and keeps it whole", () => {
    const form = toBuyerForm(CFG);
    form.ip_requests_per_minute = "";
    assert.equal(fromBuyerForm(form).errors["ip_requests_per_minute"], "Bắt buộc");
    form.ip_requests_per_minute = "120.5";
    assert.equal(fromBuyerForm(form).errors["ip_requests_per_minute"], "Phải là số nguyên");
    form.ip_requests_per_minute = "10000";
    assert.equal(fromBuyerForm(form).config?.ip_requests_per_minute, 10_000);
  });
});
