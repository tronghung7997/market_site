import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { clearUserScopedStorage, identityChanged, USER_SCOPED_STORAGE_KEYS } from "../lib/session-identity.ts";
import { RECENT_STORAGE_KEY as FB_RECENT } from "../features/facebook-lookup/model.ts";

describe("session identity", () => {
  it("treats only a real switch as a change", () => {
    // First /me after page load: nothing cached for anyone yet.
    assert.equal(identityChanged(undefined, null), false);
    assert.equal(identityChanged(undefined, 7), false);
    // Profile refresh for the same person.
    assert.equal(identityChanged(7, 7), false);
    assert.equal(identityChanged(null, null), false);
    // Sign-out, sign-in, account switch.
    assert.equal(identityChanged(7, null), true);
    assert.equal(identityChanged(null, 8), true);
    assert.equal(identityChanged(7, 8), true);
  });

  it("forgets per-person history and survives blocked storage", () => {
    assert.ok(USER_SCOPED_STORAGE_KEYS.includes(FB_RECENT as (typeof USER_SCOPED_STORAGE_KEYS)[number]));
    const store = new Map<string, string>(USER_SCOPED_STORAGE_KEYS.map((k) => [k, "x"]));
    store.set("gmmo.display-currency", "VND");
    clearUserScopedStorage({ removeItem: (k: string) => { store.delete(k); } });
    assert.deepEqual([...store.keys()], ["gmmo.display-currency"]);
    assert.doesNotThrow(() => clearUserScopedStorage({ removeItem: () => { throw new Error("blocked"); } }));
  });
});
