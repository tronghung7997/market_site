import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clampQuantity, isPoolProxy, orderConfig, orderQuantity, perOrderMax, quantityControl, type QuantityOptions,
} from "../components/dynamic-order-quantity.ts";
import { MAX_ORDER_QUANTITY } from "../lib/order-limits.ts";

const planProxy = (max_quantity: number | null | undefined): QuantityOptions => ({ strategy: "config", adapter_type: "auto_proxy", max_quantity });
const poolProxy: QuantityOptions = { strategy: "credit", adapter_type: "auto_proxy", max_quantity: 1 };

describe("dynamic order quantity", () => {
  it("offers a stepper up to max_quantity for a proxy sold by package", () => {
    assert.deepEqual(quantityControl(planProxy(50)), { kind: "stepper", max: 50, proxy: true });
    assert.deepEqual(quantityControl(planProxy(20)), { kind: "stepper", max: 20, proxy: true });
  });

  it("keeps a pool proxy, a limit of one, and a backend without the field at exactly one proxy", () => {
    assert.deepEqual(quantityControl(poolProxy), { kind: "single" });
    assert.deepEqual(quantityControl({ ...poolProxy, max_quantity: 20 }), { kind: "single" });
    assert.deepEqual(quantityControl(planProxy(1)), { kind: "single" });
    assert.deepEqual(quantityControl(planProxy(null)), { kind: "single" });
    assert.deepEqual(quantityControl(planProxy(undefined)), { kind: "single" });
  });

  it("leaves task and request-package orders to their own fields", () => {
    assert.deepEqual(quantityControl({ strategy: "task", adapter_type: null, max_quantity: null }), { kind: "none" });
    assert.deepEqual(quantityControl({ strategy: "credit", adapter_type: "mock", max_quantity: null }), { kind: "none" });
  });

  it("caps other configurable orders at the adapter limit or the marketplace cap", () => {
    assert.deepEqual(quantityControl({ strategy: "config", adapter_type: "mock", max_quantity: null }), { kind: "stepper", max: MAX_ORDER_QUANTITY, proxy: false });
    assert.deepEqual(quantityControl({ strategy: "config", adapter_type: "mock", max_quantity: 7 }), { kind: "stepper", max: 7, proxy: false });
    assert.equal(perOrderMax(99_999), MAX_ORDER_QUANTITY);
    assert.equal(perOrderMax(0), 1);
    assert.equal(perOrderMax(Number.NaN), MAX_ORDER_QUANTITY);
  });

  it("clamps typed and stepped values to whole numbers within 1…max", () => {
    assert.equal(clampQuantity(0, 20), 1);
    assert.equal(clampQuantity(-3, 20), 1);
    assert.equal(clampQuantity(21, 20), 20);
    assert.equal(clampQuantity(3.7, 20), 3);
    assert.equal(clampQuantity(Number.NaN, 20), 1);
    assert.equal(clampQuantity(5, 0), 1);
  });

  it("sends the picked quantity only when the buyer can pick one", () => {
    assert.equal(orderQuantity(quantityControl(planProxy(50)), 3), 3);
    assert.equal(orderQuantity(quantityControl(planProxy(50)), 80), 50);
    assert.equal(orderQuantity(quantityControl(poolProxy), 3), 1);
    assert.equal(orderQuantity({ kind: "none" }, 3), 1);
  });

  it("puts the quantity in user_config and pins a pool proxy's package to one", () => {
    assert.deepEqual(orderConfig({ plan_key: "res|vn|7" }, planProxy(50), 3), { plan_key: "res|vn|7", quantity: 3 });
    assert.deepEqual(orderConfig({ package_size: 5 }, poolProxy, 1), { package_size: 1, quantity: 1 });
    assert.equal(isPoolProxy(poolProxy), true);
    assert.equal(isPoolProxy(planProxy(50)), false);
  });
});
