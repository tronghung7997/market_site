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

export const TIMELINE_CHIP_LIMIT = 8;

export function visibleResourceIds(ids: number[]): { shown: number[]; hidden: number } {
  if (ids.length <= TIMELINE_CHIP_LIMIT) return { shown: ids, hidden: 0 };
  return {
    shown: ids.slice(0, TIMELINE_CHIP_LIMIT - 1),
    hidden: ids.length - (TIMELINE_CHIP_LIMIT - 1),
  };
}
