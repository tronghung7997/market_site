import assert from "node:assert/strict";
import test from "node:test";

import {
  LatestRequestGate,
  RESOURCE_LINE_MAX_LENGTH,
  chunkRestockItems,
  runInRestockBatches,
  runRestockBatches,
  summarizeRestockPreview,
  tooLongRestockLines,
  type RestockProgress,
  canArchiveInventoryResource,
  canEditInventoryResource,
  canRestockInventoryResource,
  inventoryStockState,
  isDefectiveReturnResource,
  isInventoryManagedProduct,
  isInstantDelivery,
  mergeRestockText,
  nextSellerProductStatus,
  parseResourceItems,
  parseRestockFileContent,
  restockTemplateContent,
  restockableVariants,
} from "../features/seller-inventory/logic.ts";

test("dynamic pricing products are not classified by variant stock", () => {
  const product = { pricing_strategy: "config", total_stock: 0 };

  assert.equal(isInventoryManagedProduct(product), false);
  assert.equal(inventoryStockState(product, 20), "not_managed");
});

test("fixed products retain low and out-of-stock classification", () => {
  assert.equal(
    inventoryStockState({ pricing_strategy: "fixed", total_stock: 0 }, 20),
    "out",
  );
  assert.equal(
    inventoryStockState({ pricing_strategy: "fixed", total_stock: 5 }, 20),
    "low",
  );
  assert.equal(
    inventoryStockState({ pricing_strategy: "fixed", total_stock: 21 }, 20),
    "in_stock",
  );
});

test("only instant variants can receive inventory resources", () => {
  const variants = [
    { id: 1, delivery_mode: "manual" },
    { id: 2, delivery_mode: "instant" },
    { id: 3, delivery_mode: "auto" },
  ];

  assert.deepEqual(restockableVariants(variants).map((variant) => variant.id), [2]);
  assert.equal(isInstantDelivery("instant"), true);
  assert.equal(isInstantDelivery("manual"), false);
  assert.equal(isInstantDelivery("auto"), false);
});

test("resource parser trims blanks and optionally deduplicates the upload preview", () => {
  const input = " first|secret \n\nsecond|secret\nfirst|secret\n";

  assert.deepEqual(parseResourceItems(input, true), ["first|secret", "second|secret"]);
  assert.deepEqual(parseResourceItems(input, false), [
    "first|secret", "second|secret", "first|secret",
  ]);
});

test("CSV restock upload strips known headers and unwraps quoted rows", () => {
  const csv = [
    "data",
    "uid_csv_a|pass_a",
    '"uid_csv_c|quoted|2fa_c"',
    '"license""quoted"',
    "LICENSE-CSV-TEST-9901",
  ].join("\n");

  assert.equal(
    parseRestockFileContent("sample-restock.csv", csv),
    "uid_csv_a|pass_a\nuid_csv_c|quoted|2fa_c\nlicense\"quoted\nLICENSE-CSV-TEST-9901",
  );
});

test("CSV restock upload keeps the first row when it is not a header", () => {
  const csv = "uid1|pass1\nuid2|pass2";
  assert.equal(parseRestockFileContent("pack.CSV", csv), csv);
});

test("TXT restock upload is passed through unchanged", () => {
  const txt = "uid_txt_a|pass_a\n\nLICENSE-TXT-TEST-9902\n";
  assert.equal(parseRestockFileContent("sample-restock.txt", txt), txt);
});

test("empty CSV restock upload yields an empty payload", () => {
  assert.equal(parseRestockFileContent("empty.csv", "  \n\n"), "");
});

test("restock file merge appends without dropping existing lines", () => {
  assert.equal(mergeRestockText("", "a|b"), "a|b");
  assert.equal(mergeRestockText("a|b", "c|d"), "a|b\nc|d");
  assert.equal(mergeRestockText("a|b", ""), "a|b");
});

test("CSV restock template starts with a data header", () => {
  const csv = restockTemplateContent("csv");
  const txt = restockTemplateContent("txt");
  assert.equal(csv.mimeType, "text/csv");
  assert.equal(txt.mimeType, "text/plain");
  assert.match(csv.content, /^data\n/);
  assert.equal(txt.content.startsWith("data\n"), false);
  assert.equal(parseResourceItems(parseRestockFileContent("t.csv", csv.content), true).length, 3);
});

test("available and error resources expose editing", () => {
  assert.equal(canEditInventoryResource("available"), true);
  assert.equal(canEditInventoryResource("error"), true);
  for (const status of ["assigned", "expired"]) {
    assert.equal(canEditInventoryResource(status), false);
  }
  assert.equal(canEditInventoryResource("error", 123), false);
});

test("restock and archive capability rules", () => {
  assert.equal(canRestockInventoryResource("error"), true);
  assert.equal(canRestockInventoryResource("available"), false);
  assert.equal(canRestockInventoryResource("assigned"), false);
  assert.equal(canRestockInventoryResource("error", 123), false);

  assert.equal(canArchiveInventoryResource("error"), true);
  assert.equal(canArchiveInventoryResource("available"), true);
  assert.equal(canArchiveInventoryResource("assigned"), false);

  assert.equal(isDefectiveReturnResource("error", 123), true);
  assert.equal(isDefectiveReturnResource("error", null), false);
  assert.equal(isDefectiveReturnResource("available", 123), false);
});

test("seller lifecycle actions do not override admin suspension", () => {
  assert.equal(nextSellerProductStatus("active"), "paused");
  assert.equal(nextSellerProductStatus("paused"), "active");
  assert.equal(nextSellerProductStatus("draft"), "active");
  assert.equal(nextSellerProductStatus("suspended"), null);
});

test("latest request gate rejects a stale variant response", () => {
  const gate = new LatestRequestGate();
  const variantA = gate.begin();
  const variantB = gate.begin();

  assert.equal(gate.isCurrent(variantA), false);
  assert.equal(gate.isCurrent(variantB), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(variantB), false);
});

test("restock batches stay under the byte budget and keep line order", () => {
  const items = Array.from({ length: 10 }, (_, i) => `user${i}|` + "c".repeat(90));
  const batches = chunkRestockItems(items, 300);
  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat(), items);
  for (const batch of batches) {
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= 300 + 2, "batch fits the budget");
  }
});

test("restock batches give an oversized line its own batch and cap items per batch", () => {
  assert.deepEqual(chunkRestockItems(["a", "x".repeat(50), "b"], 20), [["a"], ["x".repeat(50)], ["b"]]);
  assert.deepEqual(chunkRestockItems(["a", "b", "c"], 1_000, 2), [["a", "b"], ["c"]]);
});

test("restock flags lines over the shared cap by code points", () => {
  const atCap = "x".repeat(RESOURCE_LINE_MAX_LENGTH);
  const emojiAtCap = "😀".repeat(RESOURCE_LINE_MAX_LENGTH); // 2 UTF-16 units each, still at cap
  assert.deepEqual(tooLongRestockLines(["ok", atCap, atCap + "x", emojiAtCap]), [3]);
});

test("restock sends unique lines batch by batch and sums the counters", async () => {
  const sent: string[][] = [];
  const progress: RestockProgress[] = [];
  const items = ["a", "b", "a", "c"];
  const result = await runRestockBatches(items, async (batch) => {
    sent.push(batch);
    return { count: batch.length - (batch.includes("b") ? 1 : 0), skipped_duplicate: 0, skipped_existing: batch.includes("b") ? 1 : 0, skipped_market: batch.includes("c") ? 1 : 0 };
  }, (next) => progress.push(next));
  assert.deepEqual(sent.flat(), ["a", "b", "c"]);
  assert.deepEqual(result, { count: 2, skipped_duplicate: 1, skipped_existing: 1, skipped_market: 1 });
  assert.deepEqual(progress.at(-1), { done: 3, total: 3, added: 2 });
});

test("restock failure keeps progress of committed batches and rethrows the error", async () => {
  const items = Array.from({ length: 6 }, (_, i) => `line${i}|` + "x".repeat(400_000));
  let calls = 0;
  let last: RestockProgress | null = null;
  const boom = new Error("network");
  await assert.rejects(
    runRestockBatches(items, async (batch) => {
      calls += 1;
      if (calls === 2) throw boom;
      return { count: batch.length, skipped_duplicate: 0, skipped_existing: 0, skipped_market: 0 };
    }, (next) => { last = next; }),
    (error) => error === boom,
  );
  assert.equal(calls, 2);
  assert.ok(last !== null);
  const reached = last as RestockProgress;
  assert.ok(reached.done > 0 && reached.done < 6);
  assert.equal(reached.added, reached.done);
});

test("restock preview summary combines batch stock hits with whole-file checks", () => {
  const items = ["a|1|x", "b|2", "a|1|x", "c|3|x"];
  const summary = summarizeRestockPreview(items, [
    { existing_in_stock: 1, expected_field_count: 3 },
    { existing_in_stock: 0, expected_field_count: 3 },
  ]);
  assert.deepEqual(summary, {
    total_lines: 4,
    duplicate_in_file: 1,
    existing_in_stock: 1,
    to_add: 2,
    expected_field_count: 3,
    malformed: [{ line: 2, fields: 2 }],
    malformed_total: 1,
  });
});

function tooLarge(maxBytes?: number) {
  return Object.assign(new Error("too large"), {
    errorCode: "REQUEST_TOO_LARGE",
    params: maxBytes === undefined ? {} : { max_bytes: maxBytes },
  });
}

test("restock re-splits the rest of the upload under the cap the server reports", async () => {
  const items = Array.from({ length: 8 }, (_, i) => `line${i}|` + "x".repeat(300_000));
  const serverCap = 700_000;
  const sent: string[][] = [];
  const results = await runInRestockBatches(items, async (batch) => {
    if (Buffer.byteLength(JSON.stringify({ items: batch })) > serverCap) throw tooLarge(serverCap);
    sent.push(batch);
    return batch.length;
  });
  assert.deepEqual(sent.flat(), items, "every line is sent once, in order");
  assert.ok(sent.every((batch) => Buffer.byteLength(JSON.stringify({ items: batch })) <= serverCap));
  assert.equal(results.reduce((sum, n) => sum + n, 0), items.length);
});

test("restock halves batches when the too-large error carries no cap", async () => {
  const items = Array.from({ length: 4 }, (_, i) => `line${i}|` + "x".repeat(400_000));
  const sizes: number[] = [];
  await runInRestockBatches(items, async (batch) => {
    if (batch.length > 1) throw tooLarge();
    sizes.push(batch.length);
    return null;
  });
  assert.deepEqual(sizes, [1, 1, 1, 1]);
});

test("restock rethrows too-large for a single line and any other error as-is", async () => {
  await assert.rejects(runInRestockBatches(["one"], async () => { throw tooLarge(10); }), /too large/);
  const boom = new Error("boom");
  let calls = 0;
  await assert.rejects(
    runInRestockBatches(["a", "b"], async () => { calls += 1; throw boom; }),
    (error) => error === boom,
  );
  assert.equal(calls, 1, "non-size errors are not retried");
});
