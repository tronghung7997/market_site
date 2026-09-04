import assert from "node:assert/strict";
import test from "node:test";

import {
  canSubmitDisputeForm,
  claimableResourceIds,
  defaultDisputeIssue,
  disputeEvidenceType,
  disputeFormMode,
  disputeIssueIds,
  disputeScopeNoticeKey,
  disputeSubmitResourceIds,
  initialSelectedClaimIds,
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
