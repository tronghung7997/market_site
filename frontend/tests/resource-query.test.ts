import assert from "node:assert/strict";
import test from "node:test";

import { resourceFilterParams, statusTabFilter } from "../lib/resource-query.ts";

test("resourceFilterParams writes the shared stock-line query names", () => {
  const q = resourceFilterParams({
    statuses: ["available", "returned"], archived: "only", search: "  ORD-ZNR6 ", createdFrom: "2026-01-01T00:00:00.000Z",
    assignedTo: "2026-02-01T00:00:00.000Z", hasOrder: false, batch: "none",
  });
  assert.equal(
    q.toString(),
    "statuses=available%2Creturned&archived_only=true&search=ORD-ZNR6&created_from=2026-01-01T00%3A00%3A00.000Z"
      + "&assigned_to=2026-02-01T00%3A00%3A00.000Z&has_order=false&batch=none",
  );
});

test("resourceFilterParams leaves out empty filters and keeps existing params", () => {
  const q = resourceFilterParams({ statuses: [], archived: "exclude", search: "  ", hasOrder: null }, new URLSearchParams({ format: "txt" }));
  assert.equal(q.toString(), "format=txt");
  assert.equal(resourceFilterParams({ archived: "include", hasOrder: true }).toString(), "include_archived=true&has_order=true");
});

test("statusTabFilter maps the stock table tabs", () => {
  assert.deepEqual(statusTabFilter("all"), {});
  assert.deepEqual(statusTabFilter(undefined), {});
  assert.deepEqual(statusTabFilter("archived"), { archived: "only" });
  assert.deepEqual(statusTabFilter("returned"), { statuses: ["returned"] });
});
