import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dproxyBaseFromSalePrice,
  dproxyParamsFromPackages,
  dproxySalePriceFromBase,
  formatDproxyPlanKey,
  guessDproxyMapping,
  isSingleConfigPlan,
  packagesFromDproxyParams,
  parseDproxyPlanKey,
} from "../lib/dproxy-plan.ts";
import { applyDproxySinglePlan, buildDynamicPricingPlan, dproxySalePrice } from "../features/seller-workbench/logic.ts";

describe("DProxy plan helpers", () => {
  it("parses and formats mapping keys", () => {
    assert.equal(formatDproxyPlanKey("residential", "VN", 7), "residential|VN|7");
    assert.deepEqual(parseDproxyPlanKey("residential|VN|7"), { type: "residential", network: "VN", days: 7 });
  });

  it("guesses buyer-facing mapping from catalog names", () => {
    assert.deepEqual(guessDproxyMapping("Residential VN 7d", 7), { type: "residential", network: "VN", days: 7 });
    assert.equal(guessDproxyMapping("Datacenter US 30 days").type, "datacenter");
    assert.equal(guessDproxyMapping("Residential Viettel 7d").network, "viettel");
    assert.equal(guessDproxyMapping("ISP Vinaphone 30 ngày").network, "vinaphone");
  });

  it("converts sale price to the 30-day base used by config pricing", () => {
    assert.equal(dproxyBaseFromSalePrice(21000, 7), 90000);
    assert.equal(dproxySalePriceFromBase(90000, 7), 21000);
  });

  it("treats one type, one country, and one duration as a single product plan", () => {
    assert.equal(isSingleConfigPlan({
      type_mult: { residential: 1 },
      network_mult: { VN: 1 },
      duration_options: [{ days: 7 }],
    }), true);
    assert.equal(isSingleConfigPlan({
      type_mult: { residential: 1, datacenter: 1 },
      network_mult: { VN: 1 },
      duration_options: [{ days: 7 }],
    }), false);
  });

  it("stores independent sale prices for each mapped package", () => {
    const params = dproxyParamsFromPackages([
      { type: "residential", network: "VN", days: 7, price: 21000 },
      { type: "datacenter", network: "US", days: 30, price: 90000 },
    ]);
    assert.deepEqual(params.plan_prices, {
      "residential|VN|7": 21000,
      "datacenter|US|30": 90000,
    });
    assert.equal(packagesFromDproxyParams(params).length, 2);
    assert.equal(isSingleConfigPlan(params), false);
  });

  it("collapses seller B1 config to one DProxy package", () => {
    const next = applyDproxySinglePlan({
      basePrice: 90000,
      types: [
        { key: "residential", label: "Residential cao cấp", mult: 1.4 },
        { key: "datacenter", label: "Datacenter", mult: 1 },
      ],
      networks: [
        { key: "fpt", label: "FPT", mult: 1 },
        { key: "VN", label: "Việt Nam", mult: 1 },
      ],
      durations: [
        { days: 7, label: "7 days" },
        { days: 30, label: "30 days" },
      ],
      selectedType: "residential",
      selectedNetwork: "VN",
      selectedDays: 7,
      qty: 2,
      isSingleUnit: false,
    }, { salePrice: 21000 });
    assert.equal(next.types.length, 1);
    assert.equal(next.networks.length, 1);
    assert.equal(next.durations.length, 1);
    assert.equal(next.isSingleUnit, true);
    assert.equal(next.qty, 1);
    assert.equal(dproxySalePrice(next), 21000);

    const pricing = buildDynamicPricingPlan("B1", next, {
      creditPrice: 0,
      packages: [],
      selectedPackageSize: 0,
    }, {
      basePrice: 0,
      platforms: [],
      selectedPlatform: "",
      urls: "",
    }, "dproxy");
    assert.deepEqual(pricing.params.plan_prices, { "residential|VN|7": 21000 });
    assert.deepEqual(pricing.params.type_display, { residential: "Residential cao cấp" });
    assert.deepEqual(pricing.params.network_display, { VN: "Việt Nam" });
  });
});
