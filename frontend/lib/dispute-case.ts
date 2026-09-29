import type { Dispute, DisputeMessageCode, DisputeTimelineEvent } from "./types";

const PREVIEW_MAX = 24;

/** First credential token from stock data (`user|pass`, `user:pass`). */
export function resourcePreview(data: string | null | undefined, max = PREVIEW_MAX): string | null {
  if (!data) return null;
  const trimmed = data.trim();
  if (!trimmed) return null;
  const token = trimmed.split(/[|:\s]/)[0] ?? trimmed;
  if (!token) return null;
  if (token.length <= max) return token;
  return `${token.slice(0, Math.max(1, max - 1))}…`;
}

export function resourceLabelMap(
  rows: Array<{ id: number; data?: string | null; data_preview?: string | null }>,
): Record<number, string> {
  const labels: Record<number, string> = {};
  for (const row of rows) {
    // A long line arrives as its head only; the first token is in it either way.
    const preview = resourcePreview(row.data ?? row.data_preview);
    if (preview) labels[row.id] = preview;
  }
  return labels;
}

export type DisputeCaseSummary = {
  claimed: number;
  pending: number;
  refunded: number;
  replaced: number;
  refundedAmount: number;
};

type DisputeClaimFields = "claimed_resource_ids" | "resource_actions" | "claimed_proxy_lines" | "proxy_actions";

/** Claimed items of a case — stock lines and proxy lines alike — and what
 *  happened to them. Proxy lines are only ever refunded. */
export function summarizeDisputeCase(
  dispute: Pick<Dispute, DisputeClaimFields | "refunded_amount" | "dispute_refunded_amount">,
): DisputeCaseSummary {
  const claimedIds = [...new Set(dispute.claimed_resource_ids ?? [])];
  const actions = dispute.resource_actions ?? [];
  const handled = new Set(actions.map((action) => action.original_resource_id));
  const refunded = actions.filter((action) => action.action === "refund");
  const replaced = actions.filter((action) => action.action === "replace");
  const claimedLines = [...new Set(dispute.claimed_proxy_lines ?? [])];
  const proxyActions = dispute.proxy_actions ?? [];
  const handledLines = new Set(proxyActions.map((action) => action.line_no));
  const fromActions = [...refunded, ...proxyActions].reduce((sum, action) => sum + (action.refund_amount || 0), 0);
  return {
    claimed: claimedIds.length + claimedLines.length,
    pending: claimedIds.filter((id) => !handled.has(id)).length
      + claimedLines.filter((line) => !handledLines.has(line)).length,
    refunded: refunded.length + proxyActions.length,
    replaced: replaced.length,
    // Only what this case refunded — a short-delivery refund before it is not the case's.
    refundedAmount: dispute.dispute_refunded_amount ?? dispute.refunded_amount ?? fromActions,
  };
}

/** Any per-item remedy (stock or proxy) — the buyer can no longer withdraw. */
export function hasDisputeItemRemedy(dispute: Pick<Dispute, "resource_actions" | "proxy_actions">): boolean {
  return (dispute.resource_actions?.length ?? 0) > 0 || (dispute.proxy_actions?.length ?? 0) > 0;
}

export function isDisputeReadyToAccept(dispute: Pick<Dispute, "status" | DisputeClaimFields | "seller_note">): boolean {
  if (dispute.status !== "open") return false;
  const summary = summarizeDisputeCase(dispute);
  if (summary.claimed > 0) return summary.pending === 0 && (summary.refunded + summary.replaced) > 0;
  return !!dispute.seller_note;
}

/**
 * Opening with resource_ids emits both `case_opened` and a `claim_batch`
 * that repeats the same reason. Merge those into one beat so the thread
 * reads as “buyer opened, these accounts”.
 */
export const DISPUTE_TIMELINE_EVENT_KEYS = [
  "case_opened",
  "claim_batch",
  "buyer_message",
  "seller_message",
  "resource_replace",
  "resource_refund",
  "proxy_refund",
  "case_escalated",
  "buyer_accepted",
  "buyer_withdrew",
  "resolution_timeout",
  "resolution_abandoned",
  "seller_timeout_refund",
  "seller_full_refund",
  "admin_refund",
  "admin_partial_refund",
  "admin_reject",
  "admin_replace",
  "admin_extend_warranty",
  "case_resolved",
] as const;

export type DisputeTimelineEventKey = (typeof DISPUTE_TIMELINE_EVENT_KEYS)[number];

export function isKnownDisputeTimelineEvent(eventType: string): eventType is DisputeTimelineEventKey {
  return (DISPUTE_TIMELINE_EVENT_KEYS as readonly string[]).includes(eventType);
}

export function isPlaceholderResolutionNote(note: string | null | undefined): boolean {
  const text = (note ?? "").trim();
  return !text || text === "—" || text === "-" || text === "–" || text === "−";
}

const SELLER_TIMELINE_COPY = new Set([
  "seller_timeout_refund",
  "admin_refund",
  "admin_partial_refund",
  "admin_reject",
  "admin_replace",
  "admin_extend_warranty",
  "seller_full_refund",
]);

export function disputeTimelineCopyKey(
  eventType: string,
  viewerRole: "buyer" | "seller" = "buyer",
): string {
  if (viewerRole === "seller" && SELLER_TIMELINE_COPY.has(eventType)) {
    return `disputeEventsSeller.${eventType}`;
  }
  return `disputeEvents.${eventType}`;
}

export function displayTimelineEvents(events: DisputeTimelineEvent[]): DisputeTimelineEvent[] {
  if (events.length < 2) return events;
  const [first, second, ...rest] = events;
  if (
    first.event_type === "case_opened"
    && second.event_type === "claim_batch"
    && (first.body || "") === (second.body || "")
  ) {
    return [
      {
        ...first,
        resource_ids: second.resource_ids.length ? second.resource_ids : first.resource_ids,
        proxy_line_nos: second.proxy_line_nos?.length ? second.proxy_line_nos : first.proxy_line_nos,
      },
      ...rest,
    ];
  }
  return events;
}

/** Proxy lines (`#NN`) a timeline beat names: claimed ones, or refunded ones. */
export function timelineProxyLineNos(event: Pick<DisputeTimelineEvent, "proxy_line_nos" | "line_nos">): number[] {
  return [...new Set([...(event.proxy_line_nos ?? []), ...(event.line_nos ?? [])])].sort((a, b) => a - b);
}

/** Money a beat returned to the buyer (`proxy_refund` reports it as `amount`). */
export function timelineRefundAmount(event: Pick<DisputeTimelineEvent, "refund_amount" | "amount">): number {
  return event.refund_amount || event.amount || 0;
}

export type ProxyLineMark = { kind: "claimed" } | { kind: "refunded"; amount: number };

/** Claim/refund state of each proxy line (by `line_no`); a refund wins over the claim. */
export function proxyLineMarks(
  dispute: Pick<Dispute, "claimed_proxy_lines" | "proxy_actions"> | null | undefined,
): Record<number, ProxyLineMark> {
  const marks: Record<number, ProxyLineMark> = {};
  if (!dispute) return marks;
  for (const line of dispute.claimed_proxy_lines ?? []) marks[line] = { kind: "claimed" };
  for (const action of dispute.proxy_actions ?? []) {
    marks[action.line_no] = { kind: "refunded", amount: action.refund_amount || 0 };
  }
  return marks;
}

/** Every stock line a dispute refers to: claims, replace/refund actions and timeline chips. */
export function disputeResourceIds(
  dispute: Pick<Dispute, "claimed_resource_ids" | "resource_actions" | "timeline"> | null | undefined,
): number[] {
  if (!dispute) return [];
  const ids = new Set<number>(dispute.claimed_resource_ids ?? []);
  for (const action of dispute.resource_actions ?? []) {
    ids.add(action.original_resource_id);
    if (action.replacement_resource_id) ids.add(action.replacement_resource_id);
  }
  for (const event of dispute.timeline ?? []) {
    for (const id of event.resource_ids) ids.add(id);
    for (const id of event.replacement_resource_ids ?? []) if (id) ids.add(id);
  }
  return [...ids];
}

export type DeliveryResourceMark =
  | { kind: "refunded"; amount: number }
  | { kind: "replaced"; replacementId: number | null }
  | { kind: "replacement"; originalId: number }
  | { kind: "claimed" };

/** Latest dispute action wins over a bare claim so handover rows show the outcome. */
export function deliveryResourceMarks(
  dispute: Pick<Dispute, "claimed_resource_ids" | "resource_actions"> | null | undefined,
): Record<number, DeliveryResourceMark> {
  const marks: Record<number, DeliveryResourceMark> = {};
  if (!dispute) return marks;
  for (const id of dispute.claimed_resource_ids ?? []) {
    marks[id] = { kind: "claimed" };
  }
  for (const action of dispute.resource_actions ?? []) {
    if (action.action === "refund") {
      marks[action.original_resource_id] = { kind: "refunded", amount: action.refund_amount || 0 };
      continue;
    }
    if (action.action === "replace") {
      marks[action.original_resource_id] = {
        kind: "replaced",
        replacementId: action.replacement_resource_id,
      };
      if (action.replacement_resource_id) {
        marks[action.replacement_resource_id] = {
          kind: "replacement",
          originalId: action.original_resource_id,
        };
      }
    }
  }
  return marks;
}

export const MAX_WARRANTY_CLAIM_GENERATION = 1;

/** 0 = original delivery; 1 = first warranty replacement; 2+ is blocked. */
export function formatDisputeAccountChip(input: {
  resourceId: number;
  resourceLabel?: string | null;
  replacementId?: number | null;
  replacementLabel?: string | null;
  warranty?: boolean;
  warrantyMark?: string;
}): string {
  // Row ids never surface: the chip is the credential preview (or a bullet
  // while it is still loading), plus the warranty mark.
  const left = input.resourceLabel || "•••";
  const mark = input.warranty && input.warrantyMark ? ` ${input.warrantyMark}` : "";
  if (input.replacementId) {
    const right = input.replacementLabel || "•••";
    return `${left} → ${right}${mark}`;
  }
  return `${left}${mark}`;
}

export function resourceWarrantyGeneration(
  resourceId: number,
  actions: Array<{ original_resource_id: number; replacement_resource_id: number | null }> | null | undefined,
): number {
  const parent = new Map<number, number>();
  for (const action of actions ?? []) {
    if (action.replacement_resource_id) {
      parent.set(action.replacement_resource_id, action.original_resource_id);
    }
  }
  let generation = 0;
  let current = resourceId;
  const seen = new Set<number>();
  while (parent.has(current) && !seen.has(current)) {
    seen.add(current);
    generation += 1;
    current = parent.get(current)!;
  }
  return generation;
}

export function isDeliveryRowClaimable(input: {
  resourceStatus?: string;
  mark?: DeliveryResourceMark;
  generation: number;
}): boolean {
  if (input.resourceStatus !== "assigned") return false;
  if (input.generation > MAX_WARRANTY_CLAIM_GENERATION) return false;
  if (input.mark?.kind === "refunded" || input.mark?.kind === "replaced" || input.mark?.kind === "claimed") {
    return false;
  }
  return true;
}

export function parseHighlightedResourceIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const part of raw.split(",")) {
    const id = Number(part.trim());
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export const TIMELINE_CHIP_LIMIT = 8;

export function visibleResourceIds(ids: number[]): { shown: number[]; hidden: number } {
  if (ids.length <= TIMELINE_CHIP_LIMIT) return { shown: ids, hidden: 0 };
  return {
    shown: ids.slice(0, TIMELINE_CHIP_LIMIT - 1),
    hidden: ids.length - (TIMELINE_CHIP_LIMIT - 1),
  };
}

/** Proxy lines a seller can still refund on a case: claimed and not yet remedied. */
export function pendingProxyLineNos(items: Array<{ line_no: number; claimed: boolean; remedied: boolean }>): number[] {
  return items.filter((item) => item.claimed && !item.remedied).map((item) => item.line_no).sort((a, b) => a - b);
}

/** What refunding these lines returns to the buyer: Σ of each line's refund cap. */
export function proxyRefundTotal(
  items: Array<{ line_no: number; refund_amount_cap: number | null }>,
  lineNos: Iterable<number>,
): number {
  const caps = new Map(items.map((item) => [item.line_no, item.refund_amount_cap ?? 0]));
  let total = 0;
  for (const line of new Set(lineNos)) total += caps.get(line) ?? 0;
  return total;
}


const SYSTEM_MESSAGES: ReadonlySet<DisputeMessageCode> = new Set([
  "full_refund", "buyer_accepted", "buyer_withdrew", "resolution_abandoned", "resolution_timeout", "seller_timeout_refund",
]);

/** A system-written event as a message key under `orders.disputeMessages` plus
 *  its ICU values, or null for events people wrote (their `body` is shown).
 *  `viewer` lets the buyer read "you" where others read "the buyer". */
export function disputeSystemMessage(
  event: Pick<DisputeTimelineEvent, "message_code" | "message_params">,
  viewer: "buyer" | "seller" | "admin",
  formatMoney: (amount: number) => string,
): { key: string; values: Record<string, string> } | null {
  const code = event.message_code;
  if (!code || !SYSTEM_MESSAGES.has(code)) return null;
  const params = event.message_params ?? {};
  const amount = typeof params.amount === "number" && params.amount > 0 ? formatMoney(params.amount) : null;
  const refund = code === "full_refund" || code === "seller_timeout_refund";
  return {
    key: refund && !amount ? `${code}_noAmount` : code,
    values: {
      actor: params.actor === "admin" || params.actor === "seller" ? params.actor : "system",
      scope: params.scope === "proxy" || params.scope === "stock" ? params.scope : "order",
      viewer,
      ...(amount ? { amount } : {}),
    },
  };
}
