import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { queryKeys } from "../lib/query-keys.ts";

describe("buyer order query keys", () => {
  it("isolates order lists and stats between signed-in accounts", () => {
    const filters = { status: "active", page: 1 };

    assert.notDeepEqual(queryKeys.orders(filters, 101), queryKeys.orders(filters, 202));
    assert.notDeepEqual(queryKeys.orderStats(101), queryKeys.orderStats(202));
  });

  it("keeps account-less keys as invalidation prefixes", () => {
    assert.deepEqual(queryKeys.orders(), ["orders"]);
    assert.deepEqual(queryKeys.orderStats(), ["order-stats"]);
  });
});
