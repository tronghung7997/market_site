import assert from "node:assert/strict";
import test from "node:test";

import { countSummary, formatDay, groupByKind, nextVersion, parseChangeLines } from "../features/admin-changelog/model.ts";

test("groupByKind keeps Mới → Cải tiến → Sửa lỗi order and drops empty kinds", () => {
  const groups = groupByKind([
    { kind: "fixed", text: "a", audience: [] },
    { kind: "improved", text: "b", audience: [] },
    { kind: "improved", text: "c", audience: [] },
  ]);
  assert.deepEqual(groups.map((g) => [g.kind, g.items.map((i) => i.text)]), [["improved", ["b", "c"]], ["fixed", ["a"]]]);
  assert.deepEqual(groupByKind([]), []);
});

test("formatDay, countSummary and nextVersion", () => {
  assert.equal(formatDay("2026-10-01"), "01/10/2026");
  assert.equal(countSummary([{ kind: "new" }, { kind: "new" }, { kind: "fixed" }]), "2 mới · 1 sửa lỗi");
  assert.equal(nextVersion("v1.42"), "v1.43");
  assert.equal(nextVersion("3.7.8"), "3.7.9");
  assert.equal(nextVersion(undefined), "v1.0");
});

test("parseChangeLines splits pasted blocks, follows kind headings, strips bullets", () => {
  const pasted = [
    "- Cải tiến:",
    "• Tích hợp nguồn dữ liệu 3rd-party cho Facebook, TikTok.",
    "",
    "• Xây dựng cơ chế fallback tự động.",
    "Sửa lỗi: Đơn gateway không còn bị tính phí",
    "1. Timeout nguồn phụ",
  ].join("\n");
  assert.deepEqual(parseChangeLines(pasted, "new"), [
    { kind: "improved", text: "Tích hợp nguồn dữ liệu 3rd-party cho Facebook, TikTok." },
    { kind: "improved", text: "Xây dựng cơ chế fallback tự động." },
    { kind: "fixed", text: "Đơn gateway không còn bị tính phí" },
    { kind: "fixed", text: "Timeout nguồn phụ" },
  ]);
  assert.deepEqual(parseChangeLines("a\r\nb", "new"), [{ kind: "new", text: "a" }, { kind: "new", text: "b" }]);
  // A plain sentence that merely contains "mới" is not a heading.
  assert.deepEqual(parseChangeLines("Thêm trang mới cho seller", "improved"), [{ kind: "improved", text: "Thêm trang mới cho seller" }]);
});
