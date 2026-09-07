import assert from "node:assert/strict";
import test from "node:test";

import { isGoogleIndexingEnabled } from "../lib/search-indexing.ts";

test("Google indexing is disabled unless explicitly enabled", () => {
  const previous = process.env.GOOGLE_INDEXING_ENABLED;

  try {
    delete process.env.GOOGLE_INDEXING_ENABLED;
    assert.equal(isGoogleIndexingEnabled(), false);

    process.env.GOOGLE_INDEXING_ENABLED = "false";
    assert.equal(isGoogleIndexingEnabled(), false);

    process.env.GOOGLE_INDEXING_ENABLED = "TRUE";
    assert.equal(isGoogleIndexingEnabled(), false);

    process.env.GOOGLE_INDEXING_ENABLED = "true";
    assert.equal(isGoogleIndexingEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_INDEXING_ENABLED;
    else process.env.GOOGLE_INDEXING_ENABLED = previous;
  }
});
