import type { FulfillmentKind } from "./fulfillment";

export const DISPUTE_ISSUE_IDS = [
  "wrong_credentials",
  "checkpoint_locked",
  "wrong_description",
  "connection_failed",
  "other",
] as const;

export type DisputeIssueId = (typeof DISPUTE_ISSUE_IDS)[number];

export type DisputeFormMode = "accounts" | "service";

export type DisputeClaimableResource = {
  id: number;
  data?: string | null;
  status: string;
};

export function isDisputeIssueId(value: string): value is DisputeIssueId {
  return (DISPUTE_ISSUE_IDS as readonly string[]).includes(value);
}

/** Per-item refund/replace is only possible when the order still has assigned inventory rows. */
export function disputeFormMode(input: {
  claimableCount: number;
  appendToExisting?: boolean;
  fulfillmentKind?: FulfillmentKind | string | null;
}): DisputeFormMode {
  if (["proxy", "task", "sla", "api"].includes(input.fulfillmentKind ?? "")) {
    return "service";
  }
  if (input.appendToExisting || input.claimableCount > 0) return "accounts";
  return "service";
}

export function claimableResourceIds(
  resources: DisputeClaimableResource[],
  claimedIds: number[] = [],
): number[] {
  const claimed = new Set(claimedIds);
  return resources
    .filter((row) => row.status === "assigned" && !claimed.has(row.id))
    .map((row) => row.id);
}

/** Keep a pre-selected row; auto-pick the only remaining account so a 1-item order is not a blank form. */
export function initialSelectedClaimIds(input: {
  preferredIds: number[];
  claimableIds: number[];
}): number[] {
  const claimable = new Set(input.claimableIds);
  const preferred = [...new Set(input.preferredIds)].filter((id) => claimable.has(id));
  if (preferred.length > 0) return preferred;
  if (input.claimableIds.length === 1) return [...input.claimableIds];
  return [];
}

export function disputeIssueIds(
  mode: DisputeFormMode,
  fulfillmentKind?: FulfillmentKind | string | null,
): DisputeIssueId[] {
  if (mode === "accounts") {
    return ["wrong_credentials", "checkpoint_locked", "wrong_description", "other"];
  }
  if (fulfillmentKind === "proxy") {
    return ["connection_failed", "wrong_description", "other"];
  }
  if (fulfillmentKind === "task" || fulfillmentKind === "sla") {
    return ["wrong_description", "other"];
  }
  return ["wrong_description", "connection_failed", "other"];
}

export function defaultDisputeIssue(
  mode: DisputeFormMode,
  fulfillmentKind?: FulfillmentKind | string | null,
): DisputeIssueId {
  if (mode === "accounts") return "wrong_credentials";
  if (fulfillmentKind === "proxy") return "connection_failed";
  return "wrong_description";
}

export type DisputeScopeNoticeKey =
  | "disputeAccountsNeedSelect"
  | "disputeServiceNoticeProxy"
  | "disputeServiceNoticeTask"
  | "disputeServiceNoticeSla"
  | "disputeServiceNoticeApi"
  | "disputeWholeOrderNotice";

export function disputeScopeNoticeKey(
  mode: DisputeFormMode,
  fulfillmentKind?: FulfillmentKind | string | null,
): DisputeScopeNoticeKey {
  if (mode === "accounts") return "disputeAccountsNeedSelect";
  if (fulfillmentKind === "proxy") return "disputeServiceNoticeProxy";
  if (fulfillmentKind === "task") return "disputeServiceNoticeTask";
  if (fulfillmentKind === "sla") return "disputeServiceNoticeSla";
  if (fulfillmentKind === "api") return "disputeServiceNoticeApi";
  return "disputeWholeOrderNotice";
}

export function disputeEvidenceType(input: {
  mode: DisputeFormMode;
  fulfillmentKind?: FulfillmentKind | string | null;
  selectedIssue: DisputeIssueId;
  initialEvidenceType?: string | null;
}): string | undefined {
  if (input.initialEvidenceType) return input.initialEvidenceType;
  if (input.mode === "accounts") return "account";
  if (input.fulfillmentKind === "proxy" || input.selectedIssue === "connection_failed") return "proxy";
  return "other";
}

export function disputeSubmitResourceIds(
  mode: DisputeFormMode,
  selectedIds: number[],
): number[] | undefined {
  if (mode === "accounts") return selectedIds;
  return selectedIds.length > 0 ? selectedIds : undefined;
}

export function canSubmitDisputeForm(input: {
  mode: DisputeFormMode;
  selectedIds: number[];
  hasIssueDescription: boolean;
  submitting?: boolean;
  loading?: boolean;
  scopeError?: boolean;
}): boolean {
  if (input.submitting || input.loading || input.scopeError || !input.hasIssueDescription) return false;
  if (input.mode === "accounts") return input.selectedIds.length > 0;
  return true;
}
