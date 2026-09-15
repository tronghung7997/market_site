import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMarkdownAction,
  buildPreviewProduct,
  categoryOptions,
  checklistJump,
  moveVariant,
  protectionOptions,
  receiveModeFor,
  sortOrderPatches,
} from "../features/seller-product-form/model.ts";

describe("seller product form · markdown toolbar", () => {
  it("wraps a selection in bold and keeps the selection on the text", () => {
    const next = applyMarkdownAction({ value: "hello world", start: 6, end: 11 }, "bold", "vi");
    assert.equal(next.value, "hello **world**");
    assert.equal(next.value.slice(next.start, next.end), "world");
  });

  it("inserts a placeholder when nothing is selected", () => {
    const next = applyMarkdownAction({ value: "", start: 0, end: 0 }, "link", "en");
    assert.equal(next.value, "[link text](https://)");
    assert.equal(next.value.slice(next.start, next.end), "link text");
  });

  it("prefixes every selected line for lists", () => {
    const next = applyMarkdownAction({ value: "a\nb\nc", start: 0, end: 5 }, "ol", "vi");
    assert.equal(next.value, "1. a\n2. b\n3. c");
  });

  it("inserts a table as its own block with blank lines around it", () => {
    const next = applyMarkdownAction({ value: "intro\nmore", start: 5, end: 5 }, "table", "en");
    assert.ok(next.value.startsWith("intro\n\n| Column 1"));
    assert.ok(next.value.endsWith("|\n\nmore"));
  });

  it("fences a selection as a code block", () => {
    const next = applyMarkdownAction({ value: "curl x", start: 0, end: 6 }, "codeblock", "en");
    assert.equal(next.value, "```\ncurl x\n```");
  });
});

describe("seller product form · categories & modes", () => {
  it("labels categories as parent › child", () => {
    const options = categoryOptions([
      { id: 1, name: "Social", children: [{ id: 2, name: "Facebook", children: [] }] },
      { id: 3, name: "Email", children: [] },
    ] as never);
    assert.deepEqual(options.map((o) => o.label), ["Social", "Social › Facebook", "Email"]);
    assert.equal(options[1].depth, 1);
  });

  it("keeps a non-preset protection value in the options", () => {
    assert.ok(protectionOptions(5).includes(5));
    assert.deepEqual(protectionOptions(3).slice(0, 3), [1, 3, 7]);
  });

  it("derives archetype and delivery from the receive mode", () => {
    assert.deepEqual(receiveModeFor("sla"), { archetype: "A", deliveryMode: "manual", workModel: "B2" });
    assert.deepEqual(receiveModeFor("task"), { archetype: "B", deliveryMode: "instant", workModel: "B3" });
  });
});

describe("seller product form · variants", () => {
  it("moves a variant and only patches changed positions", () => {
    const ids = moveVariant([10, 20, 30, 40], 3, 0);
    assert.deepEqual(ids, [40, 10, 20, 30]);
    const patches = sortOrderPatches(ids, { 10: 0, 20: 1, 30: 2, 40: 3 });
    assert.deepEqual(patches, [{ id: 40, sort_order: 0 }, { id: 10, sort_order: 1 }, { id: 20, sort_order: 2 }, { id: 30, sort_order: 3 }]);
    assert.deepEqual(sortOrderPatches([10, 20], { 10: 0, 20: 1 }), []);
  });
});

describe("seller product form · readiness & preview", () => {
  it("sends the info check to the name when the title is missing, else to the description", () => {
    const item = { key: "info", labelKey: "checkInfo", pass: false };
    assert.deepEqual(checklistJump(item, true), { section: "basics", field: "product-title" });
    assert.deepEqual(checklistJump(item, false), { section: "content", field: "product-description" });
    assert.equal(checklistJump({ key: "stock_sla", labelKey: "checkStockSla", pass: false }, false).section, "variants");
  });

  it("builds a storefront product from form state, dropping empty specs", () => {
    const product = buildPreviewProduct({
      id: 0, title: " Acc ", categoryId: 2, categoryName: "Facebook", serviceType: "account", coverId: "facebook", escrowDays: 3,
      highlightText: "", description: "**hi**", features: ["a", " "], specs: { region: "VN", empty: "" }, warrantyText: "", variants: [], status: "draft", locale: "vi",
    });
    assert.equal(product.title, "Acc");
    assert.equal(product.highlight_text, null);
    assert.deepEqual(product.specs, { region: "VN" });
    assert.deepEqual(product.features, ["a"]);
    assert.equal(product.pricing_strategy, "fixed");
  });
});
