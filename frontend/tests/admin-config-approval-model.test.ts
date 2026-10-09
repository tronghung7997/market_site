import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isQueued, personLabel, reasonOk, savedConfig } from "../features/admin-config-approval/model.ts";

const queued = {
  status: "pending_approval" as const,
  request: { id: 1 } as never,
  applied_fields: ["orders_frozen"],
  config: { platform_fee_percent: 0 },
};

describe("config approval model", () => {
  it("tells a queued save from an applied one", () => {
    assert.equal(isQueued(queued), true);
    assert.equal(isQueued({ platform_fee_percent: 5 }), false);
    // A config that happens to have a `status` field is not a queued save.
    assert.equal(isQueued({ status: "ok" } as never), false);
  });

  it("returns the section as it is now either way", () => {
    assert.deepEqual(savedConfig(queued), { platform_fee_percent: 0 });
    assert.deepEqual(savedConfig({ platform_fee_percent: 5 }), { platform_fee_percent: 5 });
  });

  it("asks for a real reason", () => {
    assert.equal(reasonOk("  ab "), false);
    assert.equal(reasonOk("abc"), true);
  });

  it("labels people by name when they have one", () => {
    assert.equal(personLabel({ email: "a@x.com", name: null }), "a@x.com");
    assert.equal(personLabel({ email: "a@x.com", name: "An" }), "An (a@x.com)");
    assert.equal(personLabel(null), "—");
  });
});
