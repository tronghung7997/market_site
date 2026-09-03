import assert from "node:assert/strict";
import test from "node:test";

import {
  DISPUTE_RESOURCE_BATCH_SIZE,
  chunkDisputeResourceIds,
  chunkPairedDisputeResources,
} from "../lib/dispute-batches.ts";

test("chunks large dispute selections at the backend contract limit", () => {
  const ids = Array.from({ length: 2_000 }, (_, index) => index + 1);
  const batches = chunkDisputeResourceIds(ids);

  assert.equal(DISPUTE_RESOURCE_BATCH_SIZE, 2_000);
  assert.deepEqual(batches.map((batch) => batch.length), [2_000]);
  assert.deepEqual(batches.flat(), ids);
});

test("deduplicates resource IDs before creating batches", () => {
  assert.deepEqual(chunkDisputeResourceIds([3, 1, 3, 2], 2), [[3, 1], [2]]);
});

test("rejects an invalid batch size", () => {
  assert.throws(() => chunkDisputeResourceIds([1], 0), RangeError);
});

test("pairs claimed accounts with chosen replacements in the same batch order", () => {
  const batches = chunkPairedDisputeResources([1, 2, 3, 4], [11, 12, 13, 14], 2);
  assert.deepEqual(batches, [
    { resourceIds: [1, 2], replacementResourceIds: [11, 12] },
    { resourceIds: [3, 4], replacementResourceIds: [13, 14] },
  ]);
  assert.deepEqual(chunkPairedDisputeResources([1, 2], undefined, 2), [{ resourceIds: [1, 2] }]);
  assert.throws(() => chunkPairedDisputeResources([1, 2], [11], 2), RangeError);
});
