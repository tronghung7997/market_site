import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addRow,
  applyMargin,
  changeCount,
  resetEditor,
  editorFromPlans,
  floorPrice,
  hasRow,
  marginPct,
  paramsFromEditor,
  planPricesFromRows,
  rowIssue,
  summarize,
} from "../features/seller-product-form/proxy-plans.ts";
import { effectiveMinPrice } from "../lib/pricing-display.ts";
import type { ProxyPlanRow, ProxyProductPlans } from "../lib/types.ts";

function plan(type: string, network: string, days: number, price: number | null, cost: number | null, label = network): ProxyPlanRow {
  return {
    plan_key: `${type}|${network}|${days}`, type, network, days, network_label: label, price, cost_price: cost,
    floor_price: null, margin_pct: null, margin_ok: true, supported: true,
  };
}

const TOPPROXY: ProxyProductPlans = {
  adapter: "topproxy", min_margin_pct: 10, from_formula: true, can_add: true, protocols: ["HTTP", "SOCKS5"],
  networks: [{ code: "DatacenterA", label: "Dùng riêng" }, { code: "DatacenterC", label: "Share 3" }],
  plans: [
    plan("SOCKS5", "DatacenterC", 30, 36000, 9600, "Share 3"),
    plan("HTTP", "DatacenterA", 30, 126000, 48000, "Dùng riêng"),
    plan("SOCKS5", "DatacenterA", 30, 126000, 48000, "Dùng riêng"),
    plan("HTTP", "DatacenterA", 3, 12600, 8400, "Dùng riêng"),
    plan("SOCKS5", "DatacenterA", 3, 12600, 8400, "Dùng riêng"),
    plan("HTTP", "DatacenterC", 30, 36000, 9600, "Share 3"),
  ],
};

const BASE_PARAMS = {
  base_price: 36000, type_mult: { HTTP: 1, SOCKS5: 1 }, network_mult: { DatacenterA: 3.5, DatacenterC: 1 },
  duration_options: [{ days: 3 }, { days: 30 }], network_display: { DatacenterA: "Dùng riêng" },
  field_labels: { network: "Mức chia sẻ" },
};

describe("proxy plan editor", () => {
  it("collapses HTTP/SOCKS5 into one row per plan, ordered by network then days", () => {
    const editor = editorFromPlans(TOPPROXY, BASE_PARAMS);
    assert.deepEqual(editor.rows.map((r) => r.id), ["DatacenterA|3", "DatacenterA|30", "DatacenterC|30"]);
    assert.deepEqual(editor.rows[1].types, ["HTTP", "SOCKS5"]);
    assert.equal(editor.rows[1].price, 126000);
    assert.equal(editor.rows[1].cost, 48000);
  });

  it("keeps DProxy plans one row per upstream plan", () => {
    const editor = editorFromPlans({
      ...TOPPROXY, adapter: "dproxy", protocols: [], can_add: false,
      networks: [{ code: "VN", label: "VN" }],
      plans: [plan("residential", "VN", 30, 50000, 25000), plan("datacenter", "VN", 30, 60000, 30000)],
    }, {});
    assert.deepEqual(editor.rows.map((r) => r.id).sort(), ["datacenter|VN|30", "residential|VN|30"]);
  });

  it("expands rows back to one plan_prices key per protocol and drops the old formula", () => {
    const editor = editorFromPlans(TOPPROXY, BASE_PARAMS);
    const params = paramsFromEditor(editor);
    assert.equal(params.base_price, undefined);
    assert.equal(params.type_mult, undefined);
    assert.equal(params.duration_options, undefined);
    assert.deepEqual(params.field_labels, { network: "Mức chia sẻ" });
    assert.deepEqual(params.network_display, { DatacenterA: "Dùng riêng", DatacenterC: "Share 3" });
    assert.deepEqual(params.plan_prices, {
      "HTTP|DatacenterA|3": 12600, "SOCKS5|DatacenterA|3": 12600,
      "HTTP|DatacenterA|30": 126000, "SOCKS5|DatacenterA|30": 126000,
      "HTTP|DatacenterC|30": 36000, "SOCKS5|DatacenterC|30": 36000,
    });
  });

  it("prices every plan from its own cost ladder when a margin is applied", () => {
    const rows = applyMargin(editorFromPlans(TOPPROXY, BASE_PARAMS).rows, 50);
    // 8.400 × 1.5 = 12.600 (gói nhỏ làm tròn hàng trăm), 48.000 × 1.5 = 72.000, 9.600 × 1.5 = 14.400.
    assert.deepEqual(rows.map((r) => r.price), [12600, 72000, 14400]);
    assert.deepEqual(planPricesFromRows(rows.slice(1, 2)), { "HTTP|DatacenterA|30": 72000, "SOCKS5|DatacenterA|30": 72000 });
  });

  it("flags prices under cost × (1 + minimum margin) exactly like the backend", () => {
    const [row] = editorFromPlans(TOPPROXY, BASE_PARAMS).rows;   // cost 8.400, min 10% → 9.240
    assert.equal(rowIssue({ ...row, price: 9239 }, 10), "below_floor");
    assert.equal(rowIssue({ ...row, price: 9240 }, 10), null);
    assert.equal(rowIssue({ ...row, price: 0 }, 10), "missing_price");
    assert.equal(rowIssue({ ...row, supported: false }, 10), "unsupported");
    assert.equal(floorPrice(8400, 10), 9300);
    assert.equal(floorPrice(48000, 10), 53000);
    assert.equal(marginPct(126000, 48000), 162.5);
  });

  it("adds a new duration in order and knows duplicates", () => {
    const editor = editorFromPlans(TOPPROXY, BASE_PARAMS);
    assert.equal(hasRow(editor, "DatacenterA", 30), true);
    const next = addRow(editor, {
      id: "DatacenterA|14", types: ["HTTP", "SOCKS5"], network: "DatacenterA", networkLabel: "Dùng riêng",
      days: 14, price: 54000, savedPrice: null, cost: 35840, supported: true,
    });
    assert.deepEqual(next.rows.map((r) => r.id), ["DatacenterA|3", "DatacenterA|14", "DatacenterA|30", "DatacenterC|30"]);
    const summary = summarize(next.rows, 10);
    assert.equal(summary.count, 4);
    assert.equal(summary.changed, 1);
    assert.equal(summary.minPrice, 12600);
    // Xoá một gói cũ + thêm một gói mới = 2 thay đổi; hoàn tác trả lại bảng lúc tải.
    const removed = { ...next, rows: next.rows.filter((r) => r.id !== "DatacenterC|30") };
    assert.equal(changeCount(removed), 2);
    assert.deepEqual(resetEditor(removed).rows.map((r) => r.id), ["DatacenterA|3", "DatacenterA|30", "DatacenterC|30"]);
  });
});

describe("storefront from-price", () => {
  it("uses the cheapest plan when a product only has plan_prices", () => {
    assert.equal(effectiveMinPrice({
      pricing_strategy: "config", variants: [],
      pricing_params: { plan_prices: { "HTTP|DatacenterA|30": 72000, "HTTP|DatacenterA|3": 13000 } },
    } as never), 13000);
    assert.equal(effectiveMinPrice({
      pricing_strategy: "config", variants: [],
      pricing_params: { base_price: 36000, type_mult: { HTTP: 1 }, network_mult: { DatacenterA: 3.5 }, duration_options: [{ days: 3 }] },
    } as never), 12600);
  });
});
