import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addAxisValue,
  addDays,
  adjustPrices,
  buyerChoices,
  cellState,
  copyTypePrices,
  gridFromParams,
  isGridParams,
  paramsFromGrid,
  priceToMargin,
  removeAxisValue,
  removeDays,
  renameAxisValue,
  renameDays,
  setPrice,
  summarize,
  type CostMap,
} from "../features/pricing-grid/model.ts";

// Product 30 trên dev DB: TopProxy, HTTP/SOCKS5 × FPT/VNPT + San Jose chỉ HTTP 30 ngày.
const PRODUCT_30 = {
  plan_prices: {
    "HTTP|FPT|3": 3600, "HTTP|FPT|30": 36000, "HTTP|US|30": 7000,
    "SOCKS5|FPT|3": 3600, "SOCKS5|FPT|30": 36000,
    "HTTP|VNPT|3": 3600,
    "bad-key": 100, "HTTP|FPT|0": 5, "HTTP|VNPT|7": 0,
  },
  field_labels: { network: "Nhà mạng" },
  type_display: {},
  network_display: { US: "San Jose", FPT: "FPT" },
  volume_tiers: [{ min_qty: 5, discount: 0.05 }],
};

describe("pricing grid — reading params", () => {
  it("builds axes from plan_prices and drops keys the backend would ignore", () => {
    const grid = gridFromParams(PRODUCT_30);
    assert.deepEqual(grid.types.map((t) => t.code), ["HTTP", "SOCKS5"]);
    assert.deepEqual(grid.networks.map((n) => [n.code, n.label]), [["FPT", "FPT"], ["US", "San Jose"], ["VNPT", "VNPT"]]);
    assert.deepEqual(grid.days, [3, 30]);
    assert.equal(Object.keys(grid.prices).length, 6);
    assert.equal(grid.fromFormula, false);
    assert.equal(grid.typeLabel, "Giao thức", "HTTP/SOCKS5 codes default to a protocol axis name");
    assert.equal(grid.networkLabel, "Nhà mạng");
  });

  it("derives the formula table when no plan_prices exist", () => {
    const grid = gridFromParams({
      base_price: 36000,
      type_mult: { HTTP: 1, SOCKS5: 1 },
      network_mult: { DatacenterA: 3.5, DatacenterC: 1 },
      network_display: { DatacenterA: "Dùng riêng" },
      duration_options: [{ days: 7, label: "7 ngày" }, { days: 30, label: "30 ngày" }],
    });
    assert.equal(grid.fromFormula, true);
    assert.equal(grid.prices["HTTP|DatacenterA|30"], 126000);
    assert.equal(grid.prices["SOCKS5|DatacenterC|7"], 8400);
    assert.equal(grid.networks[0].label, "Dùng riêng");
  });

  it("starts empty for a brand-new config product", () => {
    const grid = gridFromParams({});
    assert.equal(grid.types.length + grid.networks.length + grid.days.length, 0);
    assert.equal(grid.fromFormula, false);
    assert.equal(grid.typeLabel, "Loại proxy");
  });

  it("routes plan × month (VPS) params away from the grid", () => {
    assert.equal(isGridParams({ plan_options: [{ key: "basic", multiplier: 1 }], duration_options: [{ months: 1 }] }), false);
    assert.equal(isGridParams(PRODUCT_30), true);
    assert.equal(isGridParams({}), true);
  });
});

describe("pricing grid — writing params", () => {
  it("writes plan_prices in axis order, keeps unrelated keys and drops the formula", () => {
    const grid = gridFromParams({ ...PRODUCT_30, base_price: 1, type_mult: { HTTP: 1 }, network_mult: { FPT: 1 }, duration_options: [{ days: 3 }] });
    const params = paramsFromGrid(grid, { ...PRODUCT_30, base_price: 1, type_mult: { HTTP: 1 } });
    assert.equal("base_price" in params, false);
    assert.equal("type_mult" in params, false);
    assert.deepEqual(params.volume_tiers, PRODUCT_30.volume_tiers);
    assert.deepEqual(Object.keys(params.plan_prices as object), [
      "HTTP|FPT|3", "HTTP|FPT|30", "HTTP|US|30", "HTTP|VNPT|3", "SOCKS5|FPT|3", "SOCKS5|FPT|30",
    ]);
    assert.deepEqual(params.field_labels, { network: "Nhà mạng", type: "Giao thức" });
    assert.deepEqual(params.network_display, { FPT: "FPT", US: "San Jose", VNPT: "VNPT" });
  });

  it("never saves an opened-but-unpriced cell", () => {
    let grid = gridFromParams(PRODUCT_30);
    grid = setPrice(grid, "SOCKS5|US|30", 0);
    const params = paramsFromGrid(grid, PRODUCT_30);
    assert.equal("SOCKS5|US|30" in (params.plan_prices as object), false);
  });

  it("keeps an axis value with no packages yet through a save round-trip", () => {
    const grid = addAxisValue(gridFromParams(PRODUCT_30), "network", { code: "Viettel", label: "Viettel" });
    const again = gridFromParams(paramsFromGrid(grid, PRODUCT_30));
    assert.ok(again.networks.some((n) => n.code === "Viettel"));
  });
});

describe("pricing grid — labels buyers already see", () => {
  // Product 31 before the grid: formula params + labels in the translation buckets.
  const FORMULA_31 = {
    base_price: 36000,
    type_mult: { HTTP: 1, SOCKS5: 1 },
    network_mult: { DatacenterA: 3.5 },
    network_display: { DatacenterA: "Dùng riêng" },
    duration_options: [{ days: 1, label: "24 giờ" }, { days: 7, label: "7 ngày" }],
  };
  const EN = { field_labels: { network: "Sharing level" }, network_display: { DatacenterA: "Dedicated" } };
  const VI = { field_labels: { network: "Mức chia sẻ" }, type_display: { HTTP: "HTTP + SOCKS5" } };

  it("shows a formula product with the en → vi overlays the backend applies for Vietnamese buyers", () => {
    const grid = gridFromParams(FORMULA_31, [EN, VI]);
    assert.equal(grid.networkLabel, "Mức chia sẻ");
    assert.equal(grid.types.find((t) => t.code === "HTTP")?.label, "HTTP + SOCKS5");
    assert.equal(grid.networks[0].label, "Dedicated", "en fills what vi does not own, exactly like the backend");
    assert.deepEqual(grid.dayLabels, { "1": "24 giờ" });
  });

  it("writes those labels into params on save so nothing changes for the buyer", () => {
    const params = paramsFromGrid(gridFromParams(FORMULA_31, [EN, VI]), FORMULA_31);
    assert.deepEqual(params.type_display, { HTTP: "HTTP + SOCKS5", SOCKS5: "SOCKS5" });
    assert.deepEqual(params.duration_labels, { "1": "24 giờ" });
    assert.equal((params.field_labels as Record<string, string>).network, "Mức chia sẻ");
  });

  it("ignores translation overlays once the product has a plan table", () => {
    const grid = gridFromParams(PRODUCT_30, [EN, { network_display: { US: "US" } }]);
    assert.equal(grid.networks.find((n) => n.code === "US")?.label, "San Jose");
  });

  it("renames a duration and drops labels equal to the default", () => {
    let grid = gridFromParams({ plan_prices: { "HTTP|FPT|1": 1000 } });
    grid = renameDays(grid, 1, "24 giờ");
    assert.equal(buyerChoices(grid)[0].label, "HTTP · FPT · 24 giờ");
    grid = renameDays(grid, 1, "1 ngày");
    assert.deepEqual(grid.dayLabels, {});
    assert.equal("duration_labels" in paramsFromGrid(grid, { duration_labels: { "1": "x" } }), false);
  });
});

describe("pricing grid — editing", () => {
  it("rejects codes that would break the type|network|days key", () => {
    const grid = gridFromParams(PRODUCT_30);
    assert.equal(addAxisValue(grid, "type", { code: "A|B", label: "x" }), grid);
    assert.equal(addAxisValue(grid, "type", { code: "HTTP", label: "dup" }), grid);
    assert.equal(addAxisValue(grid, "type", { code: "  ", label: "x" }), grid);
  });

  it("renames only the label, never the machine code", () => {
    const grid = renameAxisValue(gridFromParams(PRODUCT_30), "network", "US", "San Jose, CA");
    const us = grid.networks.find((n) => n.code === "US");
    assert.equal(us?.label, "San Jose, CA");
    assert.equal(grid.prices["HTTP|US|30"], 7000);
  });

  it("removing a value or a duration removes its prices", () => {
    const base = gridFromParams(PRODUCT_30);
    const noSocks = removeAxisValue(base, "type", "SOCKS5");
    assert.equal(Object.keys(noSocks.prices).some((k) => k.startsWith("SOCKS5|")), false);
    const no30 = removeDays(base, 30);
    assert.equal(Object.keys(no30.prices).some((k) => k.endsWith("|30")), false);
    assert.deepEqual(addDays(base, 7).days, [3, 7, 30]);
    assert.equal(addDays(base, 0), base);
  });

  it("copies one protocol's prices to the others, skipping unsupported cells", () => {
    const base = gridFromParams(PRODUCT_30);
    const copied = copyTypePrices(base, "HTTP", (key) => key !== "SOCKS5|US|30");
    assert.equal(copied.prices["SOCKS5|VNPT|3"], 3600);
    assert.equal(copied.prices["SOCKS5|US|30"], undefined);
  });

  it("adjusts by percent and prices to a margin, rounding up", () => {
    const base = gridFromParams({ plan_prices: { "HTTP|FPT|3": 3600, "HTTP|FPT|30": 36000 } });
    const up = adjustPrices(base, 10);
    assert.equal(up.prices["HTTP|FPT|3"], 4000);
    assert.equal(up.prices["HTTP|FPT|30"], 40000);
    const costs: CostMap = { "HTTP|FPT|3": { cost: 2400, supported: true }, "HTTP|FPT|30": { cost: null, supported: true } };
    const byMargin = priceToMargin(base, 50, costs);
    assert.equal(byMargin.prices["HTTP|FPT|3"], 3600);
    assert.equal(byMargin.prices["HTTP|FPT|30"], 36000, "cells without a cost keep their price");
  });
});

describe("pricing grid — checks", () => {
  const costs: CostMap = {
    "HTTP|FPT|3": { cost: 2400, supported: true },
    "HTTP|FPT|30": { cost: 14400, supported: true },
    "HTTP|US|30": { cost: 4800, supported: true },
    "SOCKS5|US|30": { cost: null, supported: false },
    "SOCKS5|FPT|3": { cost: 2400, supported: false },
  };

  it("flags below-floor and unsupported priced cells the backend would reject", () => {
    let grid = gridFromParams(PRODUCT_30);
    grid = setPrice(grid, "HTTP|FPT|3", 2500);
    assert.equal(cellState(grid, "HTTP|FPT|3", costs, 10), "below_floor");
    assert.equal(cellState(grid, "HTTP|FPT|30", costs, 10), "ok");
    assert.equal(cellState(grid, "SOCKS5|US|30", costs, 10), "unsupported");
    assert.equal(cellState(grid, "SOCKS5|FPT|3", costs, 10), "unsupported");
    assert.equal(cellState(grid, "SOCKS5|VNPT|3", costs, 10), "off");

    const s = summarize(grid, costs, 10);
    assert.equal(s.belowFloor, 1);
    assert.equal(s.unsupportedPriced, 1);
    assert.equal(s.selling, 5);
    assert.equal(s.minPrice, 2500);
  });

  it("lists buyer choices with the labels the backend composes", () => {
    const choices = buyerChoices(gridFromParams(PRODUCT_30));
    assert.equal(choices.length, 6);
    assert.deepEqual(choices.find((c) => c.value === "HTTP|US|30"), { value: "HTTP|US|30", label: "HTTP · San Jose · 30 ngày", price: 7000 });
  });
});
