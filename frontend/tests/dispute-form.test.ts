import assert from "node:assert/strict";
import test from "node:test";

import {
  canSubmitDisputeForm,
  claimableProxyLineNos,
  claimableResourceIds,
  defaultDisputeIssue,
  disputeEvidenceType,
  disputeFormMode,
  disputeIssueIds,
  disputeScopeNoticeKey,
  disputeSubmitResourceIds,
  initialSelectedClaimIds,
  orderProxyLines,
  proxyLineClaimState,
} from "../lib/dispute-form.ts";

test("account-backed orders require a claim selection; services do not", () => {
  assert.equal(disputeFormMode({ claimableCount: 3 }), "accounts");
  assert.equal(disputeFormMode({ claimableCount: 0 }), "service");
  assert.equal(disputeFormMode({ claimableCount: 0, appendToExisting: true }), "accounts");
  for (const fulfillmentKind of ["proxy", "task", "sla", "api"] as const) {
    assert.equal(
      disputeFormMode({ claimableCount: 3, appendToExisting: true, fulfillmentKind }),
      "service",
    );
  }
});

test("only assigned, unclaimed inventory rows are claimable", () => {
  assert.deepEqual(
    claimableResourceIds(
      [
        { id: 1, status: "assigned" },
        { id: 2, status: "error" },
        { id: 3, status: "assigned" },
        { id: 4, status: "assigned" },
      ],
      [3],
    ),
    [1, 4],
  );
});

test("keeps a valid preselection and auto-picks a single remaining account", () => {
  assert.deepEqual(
    initialSelectedClaimIds({ preferredIds: [9, 2, 2], claimableIds: [1, 2, 4] }),
    [2],
  );
  assert.deepEqual(
    initialSelectedClaimIds({ preferredIds: [9], claimableIds: [4] }),
    [4],
  );
  assert.deepEqual(
    initialSelectedClaimIds({ preferredIds: [], claimableIds: [7, 8] }),
    [],
  );
});

test("issue chips follow the asset instead of always showing account failures", () => {
  assert.deepEqual(disputeIssueIds("accounts"), [
    "wrong_credentials",
    "checkpoint_locked",
    "wrong_description",
    "other",
  ]);
  assert.deepEqual(disputeIssueIds("service", "proxy"), [
    "connection_failed",
    "wrong_description",
    "other",
  ]);
  assert.deepEqual(disputeIssueIds("service", "task"), ["wrong_description", "other"]);
  assert.equal(defaultDisputeIssue("accounts"), "wrong_credentials");
  assert.equal(defaultDisputeIssue("service", "proxy"), "connection_failed");
  assert.equal(defaultDisputeIssue("service", "sla"), "wrong_description");
});

test("scope copy and submit payload stay aligned with the form mode", () => {
  assert.equal(disputeScopeNoticeKey("accounts"), "disputeAccountsNeedSelect");
  assert.equal(disputeScopeNoticeKey("service", "proxy"), "disputeServiceNoticeProxy");
  assert.equal(disputeScopeNoticeKey("service", "task"), "disputeServiceNoticeTask");
  assert.equal(disputeScopeNoticeKey("service"), "disputeWholeOrderNotice");
  assert.deepEqual(disputeSubmitResourceIds("accounts", [11, 12]), [11, 12]);
  assert.equal(disputeSubmitResourceIds("service", []), undefined);
  assert.equal(disputeEvidenceType({
    mode: "accounts",
    selectedIssue: "wrong_credentials",
  }), "account");
  assert.equal(disputeEvidenceType({
    mode: "service",
    fulfillmentKind: "proxy",
    selectedIssue: "wrong_description",
  }), "proxy");
});

test("submit stays blocked until account claims are chosen", () => {
  assert.equal(canSubmitDisputeForm({
    mode: "accounts",
    selectedIds: [],
    hasIssueDescription: true,
  }), false);
  assert.equal(canSubmitDisputeForm({
    mode: "accounts",
    selectedIds: [1],
    hasIssueDescription: true,
  }), true);
  assert.equal(canSubmitDisputeForm({
    mode: "service",
    selectedIds: [],
    hasIssueDescription: true,
  }), true);
  assert.equal(canSubmitDisputeForm({
    mode: "service",
    selectedIds: [],
    hasIssueDescription: true,
    loading: true,
  }), false);
  assert.equal(canSubmitDisputeForm({
    mode: "service",
    selectedIds: [],
    hasIssueDescription: true,
    scopeError: true,
  }), false);
});

test("a multi-proxy order is disputed per line; a one-proxy order only when adding claims", () => {
  assert.equal(disputeFormMode({ claimableCount: 0, fulfillmentKind: "proxy", proxyLineCount: 3 }), "proxies");
  assert.equal(disputeFormMode({ claimableCount: 0, fulfillmentKind: "proxy", proxyLineCount: 1 }), "service");
  assert.equal(disputeFormMode({ claimableCount: 0, fulfillmentKind: "proxy", proxyLineCount: 1, appendToExisting: true }), "proxies");
  assert.equal(disputeFormMode({ claimableCount: 0, fulfillmentKind: "proxy", proxyLineCount: 0, appendToExisting: true }), "service");
  // Proxy lines never turn a stock order into a proxy case.
  assert.equal(disputeFormMode({ claimableCount: 2, fulfillmentKind: "instant", proxyLineCount: 4 }), "accounts");
});

test("proxy lines: live and untouched are claimable; claimed, refunded and dead are not", () => {
  const claimed = new Set([2]);
  const refunded = new Set([3]);
  assert.equal(proxyLineClaimState({ line_no: 1, status: "allocated" }, claimed, refunded), "claimable");
  assert.equal(proxyLineClaimState({ line_no: 4, status: "offline" }, claimed, refunded), "claimable");
  assert.equal(proxyLineClaimState({ line_no: 2, status: "allocated" }, claimed, refunded), "claimed");
  // A refunded line is also claimed and released — the refund is what the buyer sees.
  assert.equal(proxyLineClaimState({ line_no: 3, status: "released" }, new Set([3]), refunded), "refunded");
  assert.equal(proxyLineClaimState({ line_no: 5, status: "expired" }, claimed, refunded), "inactive");
  assert.deepEqual(
    claimableProxyLineNos(
      [
        { line_no: 1, status: "allocated" },
        { line_no: 2, status: "allocated" },
        { line_no: 3, status: "released" },
        { line_no: 4, status: "offline" },
      ],
      [2],
      [{ line_no: 3 }],
    ),
    [1, 4],
  );
});

test("orderProxyLines keeps the exact order, once per line, by line number", () => {
  const rows = [
    { order_code: "ORD-AAA", line_no: 2 },
    { order_code: "ORD-AAAB", line_no: 1 },
    { order_code: "ORD-AAA", line_no: 1 },
    { order_code: "ORD-AAA", line_no: 2 },
  ];
  assert.deepEqual(orderProxyLines(rows, "ORD-AAA"), [
    { order_code: "ORD-AAA", line_no: 1 },
    { order_code: "ORD-AAA", line_no: 2 },
  ]);
});

test("proxies mode needs a picked line, sends no stock ids and reads as a proxy case", () => {
  assert.equal(disputeScopeNoticeKey("proxies", "proxy"), "disputeProxiesNeedSelect");
  assert.deepEqual(disputeIssueIds("proxies", "proxy"), ["connection_failed", "wrong_description", "other"]);
  assert.equal(defaultDisputeIssue("proxies", "proxy"), "connection_failed");
  assert.equal(disputeEvidenceType({ mode: "proxies", fulfillmentKind: "proxy", selectedIssue: "other" }), "proxy");
  assert.equal(disputeSubmitResourceIds("proxies", [9]), undefined);
  const base = { mode: "proxies" as const, selectedIds: [], hasIssueDescription: true };
  assert.equal(canSubmitDisputeForm({ ...base, selectedProxyLines: [] }), false);
  assert.equal(canSubmitDisputeForm({ ...base, selectedProxyLines: [2] }), true);
  assert.equal(canSubmitDisputeForm({ ...base, selectedProxyLines: [2], scopeError: true }), false);
});
