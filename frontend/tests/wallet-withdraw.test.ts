import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { withdrawCap } from "../features/wallet-withdraw/model.ts";

describe("withdrawal cap", () => {
  it("lets a seller withdraw the whole available balance", () => {
    assert.deepEqual(withdrawCap({ available_balance: 90_000, withdrawable_commission: null }), { max: 90_000, commissionOnly: false });
    assert.deepEqual(withdrawCap({ available_balance: 90_000 }), { max: 90_000, commissionOnly: false });
  });

  it("limits a non-seller to earned commission, never above the balance", () => {
    assert.deepEqual(withdrawCap({ available_balance: 53_000, withdrawable_commission: 3_000 }), { max: 3_000, commissionOnly: true });
    assert.deepEqual(withdrawCap({ available_balance: 500, withdrawable_commission: 2_000 }), { max: 500, commissionOnly: true });
    assert.deepEqual(withdrawCap({ available_balance: 100_000, withdrawable_commission: 0 }), { max: 0, commissionOnly: true });
  });

  it("reads a missing wallet as nothing to withdraw", () => {
    assert.deepEqual(withdrawCap(null), { max: 0, commissionOnly: false });
  });
});
