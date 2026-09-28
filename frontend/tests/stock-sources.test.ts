import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeStockSources,
  removeStockSource,
  stockSourceFromText,
  stockSourceLineCount,
  stockSourceLines,
  stockUploadLines,
  toggleStockSourceHeader,
} from "../features/seller-inventory/stock-sources.ts";

test("an uploaded file becomes parsed lines with its column header split off", () => {
  const source = stockSourceFromText(1, "file", "accs.txt", 64, "Username|Password|2FA\nu1|p1|k1\n\nu2|p2|k2\r\n");
  assert.equal(source.header, "Username|Password|2FA");
  assert.deepEqual(source.items, ["u1|p1|k1", "u2|p2|k2"]);
  assert.equal(stockSourceLineCount(source), 2);
  const kept = toggleStockSourceHeader([source], 1)[0];
  assert.deepEqual(stockSourceLines([kept]), ["Username|Password|2FA", "u1|p1|k1", "u2|p2|k2"]);
  assert.equal(stockSourceLineCount(kept), 3);
});

test("csv files lose their single-column header and quoting like before", () => {
  const source = stockSourceFromText(1, "file", "accs.csv", 20, 'data\n"a|b"\nc|d\n');
  assert.deepEqual(source.items, ["a|b", "c|d"]);
});

test("sources and typed text combine in order without duplicates", () => {
  const a = stockSourceFromText(1, "file", "a.txt", 1, "x|1\ny|2");
  const b = stockSourceFromText(2, "paste", "Pasted", 1, "y|2\nz|3");
  assert.deepEqual(stockUploadLines([a, b], "z|3\nw|4\n"), ["x|1", "y|2", "z|3", "w|4"]);
  assert.deepEqual(stockSourceLines(removeStockSource([a, b], 1)), ["y|2", "z|3"]);
  const seen = new Set<string>();
  assert.deepEqual(dedupeStockSources([a, b], seen).map((s) => s.items), [["x|1", "y|2"], ["z|3"]]);
  assert.deepEqual([...seen], ["x|1", "y|2", "z|3"]);
});
