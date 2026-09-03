import assert from "node:assert/strict";
import test from "node:test";

import {
  deliveryResourceMarks,
  displayTimelineEvents,
  isDisputeReadyToAccept,
  parseHighlightedResourceIds,
  resourceLabelMap,
  resourcePreview,
  summarizeDisputeCase,
  visibleResourceIds,
} from "../lib/dispute-case.ts";
import type { DisputeTimelineEvent } from "../lib/types.ts";

test("resourcePreview keeps the username token", () => {
  assert.equal(resourcePreview("alice|secret"), "alice");
  assert.equal(resourcePreview("bob:hunter2:mail@x.com"), "bob");
  assert.equal(resourcePreview("   "), null);
  assert.equal(resourcePreview("x".repeat(40))?.endsWith("…"), true);
});

test("summarizeDisputeCase counts pending vs remedied accounts", () => {
  const summary = summarizeDisputeCase({
    claimed_resource_ids: [1, 3, 1, 7],
    refunded_amount: 2000,
    resource_actions: [
      { original_resource_id: 1, replacement_resource_id: null, action: "refund", refund_amount: 1000, created_at: "t1" },
      { original_resource_id: 3, replacement_resource_id: 9, action: "replace", refund_amount: 0, created_at: "t2" },
    ],
  });
  assert.deepEqual(summary, {
    claimed: 3,
    pending: 1,
    refunded: 1,
    replaced: 1,
    refundedAmount: 2000,
  });
});

test("buyer can accept only after every claimed account is remedied", () => {
  const open = {
    status: "open",
    claimed_resource_ids: [1, 2],
    resource_actions: [
      { original_resource_id: 1, replacement_resource_id: null, action: "refund" as const, refund_amount: 500, created_at: "t1" },
    ],
    seller_note: "working on it",
  };
  assert.equal(isDisputeReadyToAccept(open), false);
  assert.equal(
    isDisputeReadyToAccept({
      ...open,
      resource_actions: [
        ...open.resource_actions,
        { original_resource_id: 2, replacement_resource_id: 8, action: "replace", refund_amount: 0, created_at: "t2" },
      ],
    }),
    true,
  );
});

test("merges the opening claim batch into case_opened when the reason matches", () => {
  const events: DisputeTimelineEvent[] = [
    { id: "o", event_type: "case_opened", actor_role: "buyer", body: "die", resource_ids: [], created_at: "t0" },
    { id: "c", event_type: "claim_batch", actor_role: "buyer", body: "die", resource_ids: [12, 88], created_at: "t0" },
    { id: "r", event_type: "resource_refund", actor_role: "seller", body: null, resource_ids: [12], created_at: "t1", refund_amount: 1000 },
  ];
  const visible = displayTimelineEvents(events);
  assert.equal(visible.length, 2);
  assert.deepEqual(visible[0].resource_ids, [12, 88]);
  assert.equal(visible[0].event_type, "case_opened");
  assert.equal(visible[1].event_type, "resource_refund");
});

test("visibleResourceIds collapses long account lists", () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const { shown, hidden } = visibleResourceIds(ids);
  assert.equal(shown.length + hidden, ids.length);
  assert.ok(hidden > 0);
});

test("resourceLabelMap skips empty payloads", () => {
  assert.deepEqual(
    resourceLabelMap([
      { id: 1, data: "user|pass" },
      { id: 2, data: "  " },
    ]),
    { 1: "user" },
  );
});

test("deliveryResourceMarks prefers refund/replace over a bare claim", () => {
  const marks = deliveryResourceMarks({
    claimed_resource_ids: [91, 92, 123],
    resource_actions: [
      { original_resource_id: 91, replacement_resource_id: null, action: "refund", refund_amount: 135, created_at: "t1" },
      { original_resource_id: 92, replacement_resource_id: 229, action: "replace", refund_amount: 0, created_at: "t2" },
      { original_resource_id: 123, replacement_resource_id: 230, action: "replace", refund_amount: 0, created_at: "t3" },
    ],
  });
  assert.deepEqual(marks[91], { kind: "refunded", amount: 135 });
  assert.deepEqual(marks[92], { kind: "replaced", replacementId: 229 });
  assert.deepEqual(marks[229], { kind: "replacement", originalId: 92 });
  assert.deepEqual(marks[123], { kind: "replaced", replacementId: 230 });
  assert.deepEqual(marks[230], { kind: "replacement", originalId: 123 });
});

test("parseHighlightedResourceIds keeps unique positive integers", () => {
  assert.deepEqual(parseHighlightedResourceIds("91, 229,91,x"), [91, 229]);
  assert.deepEqual(parseHighlightedResourceIds(""), []);
});
