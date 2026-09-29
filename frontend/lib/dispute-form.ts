import type { FulfillmentKind } from "./fulfillment";

export const DISPUTE_ISSUE_IDS = [
  "wrong_credentials",
  "checkpoint_locked",
  "wrong_description",
  "connection_failed",
  "other",
] as const;

export type DisputeIssueId = (typeof DISPUTE_ISSUE_IDS)[number];

/** accounts: pick stock lines · proxies: pick proxy lines (#NN) · service: whole order. */
export type DisputeFormMode = "accounts" | "proxies" | "service";

export type DisputeClaimableResource = {
  id: number;
  data?: string | null;
  status: string;
};

export function isDisputeIssueId(value: string): value is DisputeIssueId {
  return (DISPUTE_ISSUE_IDS as readonly string[]).includes(value);
}

/**
 * Per-item refund/replace is only possible when the order still has assigned
 * inventory rows. A proxy order with several proxies is disputed line by line
 * (the seller refunds exactly those); a one-proxy order stays a whole-order
 * case when it is opened, but claims on an open case always name lines.
 */
export function disputeFormMode(input: {
  claimableCount: number;
  appendToExisting?: boolean;
  fulfillmentKind?: FulfillmentKind | string | null;
  /** Every proxy line the order holds (any status). */
  proxyLineCount?: number;
}): DisputeFormMode {
  if (input.fulfillmentKind === "proxy") {
    const lines = input.proxyLineCount ?? 0;
    return lines > 1 || (lines > 0 && input.appendToExisting) ? "proxies" : "service";
  }
  if (["task", "sla", "api"].includes(input.fulfillmentKind ?? "")) {
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

export type DisputeProxyLine = {
  line_no: number;
  host: string;
  port: number;
  status: string;
};

/** Why a proxy line can or cannot be put on a claim. */
export type ProxyLineClaimState = "claimable" | "claimed" | "refunded" | "inactive";

/** Mirrors the backend: only a live line (allocated/offline) can be claimed. */
const CLAIMABLE_PROXY_STATUSES = new Set(["allocated", "offline"]);

export function proxyLineClaimState(
  line: Pick<DisputeProxyLine, "line_no" | "status">,
  claimed: ReadonlySet<number>,
  refunded: ReadonlySet<number>,
): ProxyLineClaimState {
  if (refunded.has(line.line_no)) return "refunded";
  if (claimed.has(line.line_no)) return "claimed";
  return CLAIMABLE_PROXY_STATUSES.has(line.status) ? "claimable" : "inactive";
}

export function claimableProxyLineNos(
  lines: Pick<DisputeProxyLine, "line_no" | "status">[],
  claimedLineNos: number[] = [],
  proxyActions: { line_no: number }[] = [],
): number[] {
  const claimed = new Set(claimedLineNos);
  const refunded = new Set(proxyActions.map((action) => action.line_no));
  return lines
    .filter((line) => proxyLineClaimState(line, claimed, refunded) === "claimable")
    .map((line) => line.line_no);
}

/** The lines of one order out of a `/me/proxies?q=` search (which also matches
 *  titles, notes and tags), once each, in `#NN` order. */
export function orderProxyLines<T extends { order_code: string; line_no: number }>(items: T[], orderCode: string): T[] {
  const seen = new Set<number>();
  return items
    .filter((item) => {
      if (item.order_code !== orderCode || seen.has(item.line_no)) return false;
      seen.add(item.line_no);
      return true;
    })
    .sort((a, b) => a.line_no - b.line_no);
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
  if (mode === "proxies" || fulfillmentKind === "proxy") {
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
  if (mode === "proxies" || fulfillmentKind === "proxy") return "connection_failed";
  return "wrong_description";
}

export type DisputeScopeNoticeKey =
  | "disputeAccountsNeedSelect"
  | "disputeProxiesNeedSelect"
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
  if (mode === "proxies") return "disputeProxiesNeedSelect";
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
  if (input.mode === "proxies" || input.fulfillmentKind === "proxy" || input.selectedIssue === "connection_failed") return "proxy";
  return "other";
}

export function disputeSubmitResourceIds(
  mode: DisputeFormMode,
  selectedIds: number[],
): number[] | undefined {
  if (mode === "accounts") return selectedIds;
  if (mode === "proxies") return undefined;
  return selectedIds.length > 0 ? selectedIds : undefined;
}

export function canSubmitDisputeForm(input: {
  mode: DisputeFormMode;
  selectedIds: number[];
  /** Proxy lines (`line_no`) picked in "proxies" mode. */
  selectedProxyLines?: number[];
  hasIssueDescription: boolean;
  submitting?: boolean;
  loading?: boolean;
  scopeError?: boolean;
}): boolean {
  if (input.submitting || input.loading || input.scopeError || !input.hasIssueDescription) return false;
  if (input.mode === "accounts") return input.selectedIds.length > 0;
  if (input.mode === "proxies") return (input.selectedProxyLines?.length ?? 0) > 0;
  return true;
}
