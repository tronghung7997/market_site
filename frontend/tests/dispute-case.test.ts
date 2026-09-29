import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { IntlMessageFormat } from "intl-messageformat";

import {
  deliveryResourceMarks,
  hasDisputeItemRemedy,
  pendingProxyLineNos,
  proxyLineMarks,
  proxyRefundTotal,
  timelineProxyLineNos,
  timelineRefundAmount,
  disputeResourceIds,
  disputeSystemMessage,
  displayTimelineEvents,
  formatDisputeAccountChip,
  isDeliveryRowClaimable,
  isKnownDisputeTimelineEvent,
  isPlaceholderResolutionNote,
  disputeTimelineCopyKey,
  isDisputeReadyToAccept,
  parseHighlightedResourceIds,
  resourceLabelMap,
  resourcePreview,
  resourceWarrantyGeneration,
  summarizeDisputeCase,
  visibleResourceIds,
} from "../lib/dispute-case.ts";
import type { DisputeTimelineEvent } from "../lib/types.ts";

test("disputeResourceIds names every line a case refers to, once", () => {
  assert.deepEqual(disputeResourceIds(null), []);
  const ids = disputeResourceIds({
    claimed_resource_ids: [11, 12],
    resource_actions: [
      { action: "replace", original_resource_id: 11, replacement_resource_id: 40, refund_amount: 0, created_at: "" },
      { action: "refund", original_resource_id: 12, replacement_resource_id: null, refund_amount: 500, created_at: "" },
    ],
    timeline: [
      { id: "e1", event_type: "claim", actor_role: "buyer", body: null, resource_ids: [13, 11], created_at: "" },
      { id: "e2", event_type: "replace", actor_role: "seller", body: null, resource_ids: [11], replacement_resource_ids: [40, null], created_at: "" },
    ],
  });
  assert.deepEqual([...ids].sort((a, b) => a - b), [11, 12, 13, 40]);
});

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

test("resolution notes skip placeholder dashes and known admin outcomes are mapped", () => {
  assert.equal(isPlaceholderResolutionNote("—"), true);
  assert.equal(isPlaceholderResolutionNote("  -  "), true);
  assert.equal(isPlaceholderResolutionNote("Partial refund for two accounts"), false);
  assert.equal(isKnownDisputeTimelineEvent("admin_partial_refund"), true);
  assert.equal(isKnownDisputeTimelineEvent("case_resolved"), true);
  assert.equal(isKnownDisputeTimelineEvent("unknown_event"), false);
  assert.equal(disputeTimelineCopyKey("admin_partial_refund", "buyer"), "disputeEvents.admin_partial_refund");
  assert.equal(disputeTimelineCopyKey("admin_partial_refund", "seller"), "disputeEventsSeller.admin_partial_refund");
  assert.equal(disputeTimelineCopyKey("case_opened", "seller"), "disputeEvents.case_opened");
});

test("warranty chips show credential previews, never row ids", () => {
  assert.equal(
    formatDisputeAccountChip({
      resourceId: 12,
      resourceLabel: "old_user",
      replacementId: 88,
      replacementLabel: "new_user",
      warranty: true,
      warrantyMark: "(warranty)",
    }),
    "old_user → new_user (warranty)",
  );
  assert.equal(
    formatDisputeAccountChip({
      resourceId: 88,
      resourceLabel: "new_user",
      warranty: true,
      warrantyMark: "(warranty)",
    }),
    "new_user (warranty)",
  );
  assert.equal(
    formatDisputeAccountChip({
      resourceId: 88,
      replacementId: 99,
      warranty: false,
    }),
    "••• → •••",
  );
});

test("warranty generation allows the first replacement and blocks the second", () => {
  const actions = [
    { original_resource_id: 1, replacement_resource_id: 11, action: "replace" as const, refund_amount: 0, created_at: "t1" },
    { original_resource_id: 11, replacement_resource_id: 21, action: "replace" as const, refund_amount: 0, created_at: "t2" },
  ];
  assert.equal(resourceWarrantyGeneration(1, actions), 0);
  assert.equal(resourceWarrantyGeneration(11, actions), 1);
  assert.equal(resourceWarrantyGeneration(21, actions), 2);
  assert.equal(isDeliveryRowClaimable({ resourceStatus: "assigned", mark: { kind: "replacement", originalId: 1 }, generation: 1 }), true);
  assert.equal(isDeliveryRowClaimable({ resourceStatus: "assigned", mark: { kind: "replacement", originalId: 11 }, generation: 2 }), false);
  assert.equal(isDeliveryRowClaimable({ resourceStatus: "assigned", mark: { kind: "claimed" }, generation: 0 }), false);
});

test("proxy claims count in the case summary and gate buyer acceptance", () => {
  const open = {
    status: "open",
    seller_note: null,
    claimed_resource_ids: [],
    resource_actions: [],
    claimed_proxy_lines: [1, 3, 3],
    proxy_actions: [{ line_no: 1, action: "refund" as const, refund_amount: 700, created_at: "t" }],
  };
  assert.deepEqual(summarizeDisputeCase(open), { claimed: 2, pending: 1, refunded: 1, replaced: 0, refundedAmount: 700 });
  assert.equal(isDisputeReadyToAccept(open), false);
  const done = { ...open, proxy_actions: [...open.proxy_actions, { line_no: 3, action: "refund" as const, refund_amount: 700, created_at: "t" }] };
  assert.equal(isDisputeReadyToAccept(done), true);
  // A mixed case waits on both kinds of claim.
  assert.equal(isDisputeReadyToAccept({ ...done, claimed_resource_ids: [5] }), false);
});

test("any stock or proxy remedy blocks withdrawing", () => {
  assert.equal(hasDisputeItemRemedy({ resource_actions: [], proxy_actions: [] }), false);
  assert.equal(hasDisputeItemRemedy({ proxy_actions: [{ line_no: 2, action: "refund", refund_amount: 1, created_at: "t" }] }), true);
});

test("proxyLineMarks lets a refund win over the claim", () => {
  assert.deepEqual(proxyLineMarks(null), {});
  assert.deepEqual(
    proxyLineMarks({
      claimed_proxy_lines: [1, 2],
      proxy_actions: [{ line_no: 2, action: "refund", refund_amount: 900, created_at: "t" }],
    }),
    { 1: { kind: "claimed" }, 2: { kind: "refunded", amount: 900 } },
  );
});

test("timeline beats expose proxy lines and the refunded amount", () => {
  assert.deepEqual(timelineProxyLineNos({ proxy_line_nos: [3, 1] }), [1, 3]);
  assert.deepEqual(timelineProxyLineNos({ line_nos: [2, 2] }), [2]);
  assert.deepEqual(timelineProxyLineNos({}), []);
  assert.equal(timelineRefundAmount({ amount: 1500 }), 1500);
  assert.equal(timelineRefundAmount({ refund_amount: 800, amount: 1500 }), 800);
  assert.equal(timelineRefundAmount({}), 0);
  const merged = displayTimelineEvents([
    { id: "o", event_type: "case_opened", actor_role: "buyer", body: "x", resource_ids: [], created_at: "t" },
    { id: "c", event_type: "claim_batch", actor_role: "buyer", body: "x", resource_ids: [], proxy_line_nos: [2, 4], created_at: "t" },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].proxy_line_nos, [2, 4]);
});

test("seller proxy remedy: pending lines and the refund they cost", () => {
  const items = [
    { line_no: 3, claimed: true, remedied: false, refund_amount_cap: 500 },
    { line_no: 1, claimed: true, remedied: false, refund_amount_cap: 700 },
    { line_no: 2, claimed: true, remedied: true, refund_amount_cap: 700 },
    { line_no: 4, claimed: false, remedied: false, refund_amount_cap: null },
  ];
  assert.deepEqual(pendingProxyLineNos(items), [1, 3]);
  assert.equal(proxyRefundTotal(items, [1, 3, 3]), 1200);
  assert.equal(proxyRefundTotal(items, [4, 9]), 0);
});

const disputeMessages = (locale: "vi" | "en"): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).orders.disputeMessages;

function renderSystemMessage(
  locale: "vi" | "en",
  event: Parameters<typeof disputeSystemMessage>[0],
  viewer: Parameters<typeof disputeSystemMessage>[1],
) {
  const message = disputeSystemMessage(event, viewer, (amount) => `${amount} ₫`);
  assert.ok(message);
  return String(new IntlMessageFormat(disputeMessages(locale)[message.key], locale).format(message.values));
}

test("system dispute messages read from the viewer's side and name the real actor", () => {
  const sellerRefund = {
    message_code: "full_refund" as const,
    message_params: { actor: "seller" as const, scope: "proxy" as const, amount: 50400 },
  };
  assert.equal(
    renderSystemMessage("vi", sellerRefund, "buyer"),
    "Người bán đã hoàn toàn bộ 50400 ₫ cho bạn. Mọi proxy của đơn đã bị thu hồi.",
  );
  assert.equal(
    renderSystemMessage("en", { ...sellerRefund, message_params: { actor: "admin" as const, scope: "stock" as const, amount: 9000 } }, "seller"),
    "The marketplace refunded the full 9000 ₫ to the buyer.",
  );
  assert.equal(
    renderSystemMessage("vi", sellerRefund, "seller"),
    "Bạn đã hoàn toàn bộ 50400 ₫ cho người mua. Mọi proxy của đơn đã bị thu hồi.",
  );
  assert.equal(
    renderSystemMessage("en", { message_code: "buyer_accepted", message_params: { actor: "buyer", scope: "proxy" } }, "seller"),
    "The buyer accepted the resolution of the disputed proxies. The rest of the payment goes to you.",
  );
  assert.equal(
    renderSystemMessage("vi", { message_code: "buyer_accepted", message_params: { actor: "buyer", scope: "proxy" } }, "admin"),
    "Người mua đã chấp nhận cách xử lý các proxy bị khiếu nại. Phần tiền còn lại được chuyển cho người bán.",
  );
});

test("refund messages without an amount fall back to the order wording", () => {
  const message = disputeSystemMessage(
    { message_code: "seller_timeout_refund", message_params: { actor: "system", scope: "order" } },
    "buyer",
    String,
  );
  assert.deepEqual(message, {
    key: "seller_timeout_refund_noAmount",
    values: { actor: "system", scope: "order", viewer: "buyer" },
  });
  assert.equal(disputeSystemMessage({ message_code: undefined }, "buyer", String), null);
});

test("every system message renders in both locales", () => {
  for (const locale of ["vi", "en"] as const) {
    for (const [key, source] of Object.entries(disputeMessages(locale))) {
      const text = new IntlMessageFormat(source, locale).format({ actor: "seller", scope: "proxy", viewer: "buyer", amount: "1 ₫" });
      assert.ok(String(text).length > 0, `${locale}.${key}`);
    }
  }
});

test("the case summary shows what this case refunded, not an earlier short-delivery refund", () => {
  const summary = summarizeDisputeCase({
    claimed_proxy_lines: [2],
    proxy_actions: [{ line_no: 2, action: "refund", refund_amount: 3600, created_at: "2026-09-29T12:20:00Z" }],
    refunded_amount: 7200,
    dispute_refunded_amount: 3600,
  });
  assert.equal(summary.refundedAmount, 3600);
});
