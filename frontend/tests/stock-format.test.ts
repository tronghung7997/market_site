import assert from "node:assert/strict";
import test from "node:test";

import {
  checkStockGroup,
  cleanLoginNote,
  isFormatLine,
  isStockGroupBlocked,
  mismatchedLines,
  splitStockFormat,
  stripBatchHeader,
} from "../features/seller-inventory/logic.ts";
import { setStockSourceFormat, stockAppendLines, stockFormatGroups, stockSourceFromText, stockUploadBatches } from "../features/seller-inventory/stock-sources.ts";
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

test("an upload whose line 1 is an account is held until the seller types a format", () => {
  // A cookie account: e-mail, long numbers, over 500 characters. It used to be
  // sent as the format, refused by the server and echoed back in the error.
  const account = `igname\tigname|pw@1|ABCDEF|sessionid=${"9".repeat(12)};${"x".repeat(480)}|m@x.vn|`;
  assert.equal(isFormatLine(account), false);
  assert.equal(isFormatLine("UID|PASS|2FA|COOKIE|MAIL"), true);
  assert.equal(isFormatLine("U|".repeat(260)), false); // over the 500-character cap
  const held = splitStockFormat([account, "b|2"]);
  assert.deepEqual(held, { format: null, note: null, items: [account, "b|2"], needsFormat: true });
  assert.equal(checkStockGroup(held)?.missingFormat, true);
  assert.equal(isStockGroupBlocked(held), true);

  const file = stockSourceFromText(4, "file", "ig.txt", 900, `${account}\nb|2\n`);
  const [group] = stockFormatGroups([file], "", "t");
  assert.equal(group.sourceId, 4);
  assert.equal(group.format, null);
  assert.equal(group.items.length, 2); // the first account is stock, not lost

  const typed = stockFormatGroups(setStockSourceFormat([file], 4, " USER|PASS|2FA|COOKIE|MAIL "), "", "t")[0];
  assert.equal(typed.format, "USER|PASS|2FA|COOKIE|MAIL");
  assert.deepEqual(typed.items, group.items);
  assert.equal(isStockGroupBlocked(typed), false);
  // A typed format that is itself account data is refused too.
  assert.equal(isStockGroupBlocked(stockFormatGroups(setStockSourceFormat([file], 4, "m@x.vn|pw"), "", "t")[0]), true);
  // Typed text: the seller puts a format line on top of the box instead.
  assert.equal(isStockGroupBlocked(stockFormatGroups([], "a@x.vn|1\nb@x.vn|2", "t")[0]), true);
  assert.equal(isStockGroupBlocked(stockFormatGroups([], "MAIL|PASS\na@x.vn|1", "t")[0]), false);
});

test("with the format box off every line is an account, and a column-name line 1 is flagged", () => {
  const file = stockSourceFromText(5, "file", "lo.txt", 60, "UID|PASS|2FA|MAIL\n1000871|p1|K1|a@x.vn\n1000872|p2|K2|b@x.vn\n");
  const [fromFile, typed] = stockFormatGroups([file], "u9|p9", "t", false);
  // The detected header is not dropped: unticked, the seller is offered to use it.
  assert.deepEqual([fromFile.format, fromFile.unformatted, fromFile.headerHint, fromFile.items.length], [null, true, true, 3]);
  assert.deepEqual([typed.format, typed.headerHint, typed.items], [null, false, ["u9|p9"]]);
  assert.equal(isStockGroupBlocked(fromFile), false); // never held back while unticked
  assert.equal(checkStockGroup(fromFile), null);
  // The same file with the box ticked: line 1 is the format.
  const [ticked] = stockFormatGroups([file], "", "t", true);
  assert.deepEqual([ticked.format, ticked.items.length, ticked.unformatted], ["UID|PASS|2FA|MAIL", 2, undefined]);
  assert.deepEqual(stockUploadBatches([], "a|1\na|1\nb|2", "t", false)[0].items, ["a|1", "b|2"]);
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
