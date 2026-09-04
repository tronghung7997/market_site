import type { Dispute, DisputeTimelineEvent } from "./types";

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
  rows: Array<{ id: number; data?: string | null }>,
): Record<number, string> {
  const labels: Record<number, string> = {};
  for (const row of rows) {
    const preview = resourcePreview(row.data);
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

export function summarizeDisputeCase(dispute: Pick<Dispute, "claimed_resource_ids" | "resource_actions" | "refunded_amount">): DisputeCaseSummary {
  const claimedIds = [...new Set(dispute.claimed_resource_ids ?? [])];
  const actions = dispute.resource_actions ?? [];
  const handled = new Set(actions.map((action) => action.original_resource_id));
  const refunded = actions.filter((action) => action.action === "refund");
  const replaced = actions.filter((action) => action.action === "replace");
  const fromActions = refunded.reduce((sum, action) => sum + (action.refund_amount || 0), 0);
  return {
    claimed: claimedIds.length,
    pending: claimedIds.filter((id) => !handled.has(id)).length,
    refunded: refunded.length,
    replaced: replaced.length,
    refundedAmount: dispute.refunded_amount ?? fromActions,
  };
}

export function isDisputeReadyToAccept(dispute: Pick<Dispute, "status" | "claimed_resource_ids" | "resource_actions" | "seller_note">): boolean {
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
  "case_escalated",
  "buyer_accepted",
  "buyer_withdrew",
  "resolution_timeout",
  "resolution_abandoned",
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
      },
      ...rest,
    ];
  }
  return events;
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
  const left = `#${input.resourceId}${input.resourceLabel ? ` ${input.resourceLabel}` : ""}`;
  const mark = input.warranty && input.warrantyMark ? ` ${input.warrantyMark}` : "";
  if (input.replacementId) {
    const right = `#${input.replacementId}${input.replacementLabel ? ` ${input.replacementLabel}` : ""}`;
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
