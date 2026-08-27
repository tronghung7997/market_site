import assert from "node:assert/strict";
import test from "node:test";

import {
  LatestRequestGate,
  canEditInventoryResource,
  inventoryStockState,
  isInventoryManagedProduct,
  isInstantDelivery,
  mergeRestockText,
  nextSellerProductStatus,
  parseResourceItems,
  parseRestockFileContent,
  restockTemplateContent,
  restockableVariants,
} from "../features/seller-inventory/index.ts";

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

test("only available resources expose editing", () => {
  assert.equal(canEditInventoryResource("available"), true);
  for (const status of ["assigned", "expired", "error"]) {
    assert.equal(canEditInventoryResource(status), false);
  }
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
