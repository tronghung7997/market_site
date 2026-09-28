import assert from "node:assert/strict";
import test from "node:test";

import {
  checkStockGroup,
  cleanLoginNote,
  mismatchedLines,
  splitStockFormat,
  stripBatchHeader,
} from "../features/seller-inventory/logic.ts";
import { stockAppendLines, stockFormatGroups, stockSourceFromText, stockUploadBatches } from "../features/seller-inventory/stock-sources.ts";
import { labelledFields, startsBatchBlock } from "../features/buyer-orders/model.ts";

test("line 1 of an upload is its format and a # line under it the login notes", () => {
  assert.deepEqual(splitStockFormat(["UID|PASS|2FA", "#  Đăng nhập   m.facebook.com ", "u1|p1|x", "u2|p2|y"]), {
    format: "UID|PASS|2FA", note: "Đăng nhập m.facebook.com", items: ["u1|p1|x", "u2|p2|y"],
  });
  assert.deepEqual(splitStockFormat(["UID|PASS", "u1|p1"]), { format: "UID|PASS", note: null, items: ["u1|p1"] });
  assert.deepEqual(splitStockFormat(["KEY"]), { format: "KEY", note: null, items: [] });
  assert.deepEqual(splitStockFormat([]), { format: null, note: null, items: [] });
  assert.equal(cleanLoginNote("## "), null);
});

test("each file or paste is one batch, the typed text another", () => {
  const file = stockSourceFromText(1, "file", "lo-a.txt", 40, "UID|PASS\n# ghi chú\na|1\nb|2\n");
  // A file whose first line reads like a column header still gives it as the format.
  const csvLike = stockSourceFromText(2, "file", "lo-b.txt", 40, "Username|Password|Cookie\nc|3|x\n");
  const groups = stockFormatGroups([file, csvLike], "MAIL|PASS\nm@x.vn|9\nm@x.vn|9", "Nội dung dán");
  assert.deepEqual(groups.map((g) => [g.key, g.name, g.format, g.note, g.items]), [
    ["source-1", "lo-a.txt", "UID|PASS", "ghi chú", ["a|1", "b|2"]],
    ["source-2", "lo-b.txt", "Username|Password|Cookie", null, ["c|3|x"]],
    ["typed", "Nội dung dán", "MAIL|PASS", null, ["m@x.vn|9", "m@x.vn|9"]],
  ]);
  assert.deepEqual(stockUploadBatches([], "MAIL|PASS\nm@x.vn|9\nm@x.vn|9", "t")[0].items, ["m@x.vn|9"]);
  assert.deepEqual(stockFormatGroups([], "   \n", "t"), []);
});

test("adding to a batch drops a leading copy of its format, as a downloaded batch starts", () => {
  assert.deepEqual(stripBatchHeader(["UID|PASS", "# notes", "a|1"], "UID|PASS"), ["a|1"]);
  assert.deepEqual(stripBatchHeader(["a|1", "b|2"], "UID|PASS"), ["a|1", "b|2"]);
  const downloaded = stockSourceFromText(3, "file", "stock_batch_7.txt", 30, "UID|PASS\n# notes\na|1\n");
  assert.deepEqual(stockAppendLines([downloaded], "b|2", "UID|PASS"), ["a|1", "b|2"]);
});

test("column-count mismatches are counted, never refused", () => {
  assert.deepEqual(mismatchedLines(["a|b|c", "a|b", "a|b|c|d", "a|b|c"], 3), { total: 2, lines: [2, 3] });
  const check = checkStockGroup({ format: "UID|PASS|2FA", note: null, items: ["a|b|c", "a|b"] });
  assert.equal(check?.fieldCount, 3);
  assert.equal(check?.mismatch.total, 1);
  assert.equal(check?.empty, false);
  assert.equal(check?.looksLikeData, false);
  assert.equal(checkStockGroup({ format: "100087654321001|pass|mail@x.vn", note: null, items: [] })?.looksLikeData, true);
  assert.equal(checkStockGroup({ format: "UID|PASS", note: null, items: [] })?.empty, true);
  assert.equal(checkStockGroup({ format: null, note: null, items: [] }), null);
});

test("buyers read a line under its batch's column names, masked until shown", () => {
  assert.deepEqual(labelledFields("1000|pw|JBSW", "UID | PASS | 2FA", false), [
    { label: "UID", value: "1000" }, { label: "PASS", value: "pw" }, { label: "2FA", value: "JBSW" },
  ]);
  assert.deepEqual(labelledFields("1000|pw|JBSW", "UID|PASS|2FA", true)?.map((f) => f.value), ["1000", "••••••••", "••••••••"]);
  assert.equal(labelledFields("1000|pw", "UID|PASS|2FA", false), null);
});

test("a header opens every run of lines from one batch", () => {
  const ids = [null, null, 7, 7, 9, 7];
  assert.deepEqual(ids.map((_, index) => startsBatchBlock(ids, index)), [true, false, true, false, true, true]);
});

import { formatLineIndexes, groupRowsByBatch } from "../features/seller-inventory/logic.ts";

test("the text box tints the first non-blank line and a # line right under it", () => {
  assert.deepEqual(formatLineIndexes("\nUID|PASS\n# notes\na|1"), { format: 1, note: 2 });
  assert.deepEqual(formatLineIndexes("UID|PASS\na|1"), { format: 0, note: -1 });
  assert.deepEqual(formatLineIndexes(""), { format: -1, note: -1 });
});

test("stock rows are grouped in runs of one batch", () => {
  const groups = groupRowsByBatch([{ batch_id: 2 }, { batch_id: 2 }, { batch_id: null }, { batch_id: 1 }]);
  assert.deepEqual(groups.map((g) => [g.key, g.rows.map((r) => r.index)]), [["2", [0, 1]], ["none", [2]], ["1", [3]]]);
});
