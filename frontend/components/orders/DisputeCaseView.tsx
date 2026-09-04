"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import {
  displayTimelineEvents,
  disputeTimelineCopyKey,
  formatDisputeAccountChip,
  isKnownDisputeTimelineEvent,
  isPlaceholderResolutionNote,
  resourceWarrantyGeneration,
  summarizeDisputeCase,
  visibleResourceIds,
} from "@/lib/dispute-case";
import { evidenceFieldLabel, evidenceTypeLabel } from "@/lib/dispute-evidence";
import type { Dispute, DisputeTimelineEvent } from "@/lib/types";
import { Tag } from "@/components/ui";

const ACTOR_DOT: Record<string, string> = {
  buyer: "bg-iris",
  seller: "bg-warn",
  admin: "bg-good",
  system: "bg-line-2",
};

export function DisputeCaseView({
  dispute,
  statusLabel,
  statusTone = "warn",
  resourceLabels = {},
  formatRefund,
  onResourceClick,
  viewerRole = "buyer",
}: {
  dispute: Dispute;
  statusLabel: string;
  statusTone?: "good" | "bad" | "warn" | "iris" | "neutral";
  resourceLabels?: Record<number, string>;
  formatRefund: (amount: number) => string;
  onResourceClick?: (resourceId: number) => void;
  viewerRole?: "buyer" | "seller";
}) {
  const t = useTranslations("orders");
  const locale = useLocale();
  const summary = summarizeDisputeCase(dispute);
  const events = displayTimelineEvents(dispute.timeline ?? []);
  const hasTimeline = events.length > 0;

  return (
    <div className="space-y-3 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={statusTone}>{statusLabel}</Tag>
        {summary.pending > 0 && dispute.status === "open" && (
          <span className="text-[11.5px] text-warn">{t("disputePendingCount", { count: summary.pending })}</span>
        )}
      </div>

      {dispute.status === "open" && dispute.resolution_deadline_at && (
        <p className="rounded-lg border border-iris/25 bg-iris-soft/35 px-3 py-2 text-[12px] text-fg">
          {t("disputeResolutionDeadline", { date: formatDateTime(dispute.resolution_deadline_at, locale) })}
        </p>
      )}

      {dispute.status === "open" && !dispute.resolution_deadline_at && dispute.abandon_after_at && (
        <p className="rounded-lg border border-warn/25 bg-warn-soft/35 px-3 py-2 text-[12px] text-fg">
          {t(viewerRole === "seller" ? "disputeAbandonDeadlineSeller" : "disputeAbandonDeadline", { date: formatDateTime(dispute.abandon_after_at, locale) })}
        </p>
      )}

      {dispute.status === "open" && !dispute.resolution_deadline_at && !dispute.abandon_after_at && dispute.escrow_expires_at && (
        <p className="rounded-lg border border-warn/25 bg-warn-soft/35 px-3 py-2 text-[12px] text-fg">
          {t("disputeEscrowPaused", { date: formatDateTime(dispute.escrow_expires_at, locale) })}
        </p>
      )}

      {(summary.claimed > 0 || summary.refundedAmount > 0) && (
        <div
          className={cn(
            "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line",
            dispute.status === "open" ? "sm:grid-cols-4" : "sm:grid-cols-3",
          )}
          aria-label={t("disputeSummaryAria")}
        >
          <SummaryCell label={t("disputeSummaryClaimed")} value={String(summary.claimed)} />
          {dispute.status === "open" && (
            <SummaryCell
              label={t("disputeSummaryPending")}
              value={String(summary.pending)}
              emphasis={summary.pending > 0 ? "warn" : undefined}
            />
          )}
          <SummaryCell label={t("disputeSummaryReplaced")} value={String(summary.replaced)} />
          <SummaryCell
            label={t("disputeSummaryRefunded")}
            value={summary.refundedAmount > 0 ? formatRefund(summary.refundedAmount) : String(summary.refunded)}
            mono={summary.refundedAmount > 0}
          />
        </div>
      )}

      {dispute.status === "open" && summary.claimed > 0 && summary.pending > 0 && (
        <p className="rounded-lg border border-warn/25 bg-warn-soft/40 px-3 py-2 text-[12px] text-muted">
          {t("disputePendingHint", { count: summary.pending })}
        </p>
      )}

      {hasTimeline ? (
        <ol className="mt-1 space-y-0">
          {events.map((event, index) => (
            <TimelineBeat
              key={event.id}
              event={event}
              last={index === events.length - 1}
              showEvidence={event.event_type === "case_opened"}
              dispute={dispute}
              resourceLabels={resourceLabels}
              formatRefund={formatRefund}
              locale={locale}
              viewerRole={viewerRole}
              onResourceClick={onResourceClick}
            />
          ))}
        </ol>
      ) : (
        <p className="text-muted">{dispute.reason}</p>
      )}
    </div>
  );
}

function SummaryCell({
  label,
  value,
  emphasis,
  mono,
}: {
  label: string;
  value: string;
  emphasis?: "warn";
  mono?: boolean;
}) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className={cn(
        "mt-1 text-[13px] font-semibold tabular",
        mono && "font-mono",
        emphasis === "warn" ? "text-warn" : "text-fg",
      )}>
        {value}
      </p>
    </div>
  );
}

function TimelineBeat({
  event,
  last,
  showEvidence,
  dispute,
  resourceLabels,
  formatRefund,
  locale,
  viewerRole,
  onResourceClick,
}: {
  event: DisputeTimelineEvent;
  last: boolean;
  showEvidence: boolean;
  dispute: Dispute;
  resourceLabels: Record<number, string>;
  formatRefund: (amount: number) => string;
  locale: string;
  viewerRole: "buyer" | "seller";
  onResourceClick?: (resourceId: number) => void;
}) {
  const t = useTranslations("orders");
  const td = useTranslations("status.dispute");
  const { shown, hidden } = visibleResourceIds(event.resource_ids);
  const title = isKnownDisputeTimelineEvent(event.event_type)
    ? event.event_type === "case_resolved" && td.has(dispute.status as "open")
      ? td(dispute.status as "open")
      : t(disputeTimelineCopyKey(event.event_type, viewerRole))
    : event.event_type;
  const resolutionNote = isPlaceholderResolutionNote(event.body) ? null : event.body;
  const evidenceEntries = showEvidence && dispute.evidence
    ? Object.entries(dispute.evidence).filter(([, value]) => value)
    : [];

  return (
    <li className="relative flex gap-3 pb-4 last:pb-1">
      {!last && <span className="absolute left-[5px] top-3 h-full w-px bg-line" aria-hidden />}
      <span
        className={cn(
          "relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ring-surface",
          ACTOR_DOT[event.actor_role] ?? ACTOR_DOT.system,
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[12px] font-semibold text-fg">{title}</span>
          <time className="font-mono text-[10.5px] text-faint" dateTime={event.created_at}>
            {formatDateTime(event.created_at, locale)}
          </time>
        </div>
        {event.event_type === "claim_batch"
          && shown.some((id) => resourceWarrantyGeneration(id, dispute.resource_actions) === 1) && (
          <p className="mt-1 text-[11px] font-medium text-iris">{t("claimedWarrantyAccount")}</p>
        )}
        {resolutionNote && <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">{resolutionNote}</p>}
        {shown.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {shown.map((id, resourceIndex) => {
              const originalIndex = event.resource_ids.indexOf(id);
              const replacement = event.replacement_resource_ids?.[originalIndex >= 0 ? originalIndex : resourceIndex];
              const label = resourceLabels[id];
              const replacementLabel = replacement ? resourceLabels[replacement] : null;
              const warrantyGeneration = resourceWarrantyGeneration(
                replacement ?? id,
                dispute.resource_actions,
              );
              const text = formatDisputeAccountChip({
                resourceId: id,
                resourceLabel: label,
                replacementId: replacement,
                replacementLabel,
                warranty: warrantyGeneration === 1,
                warrantyMark: t("warrantyReplacementMark"),
              });
              const className = cn(
                "rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-fg",
                onResourceClick && "cursor-pointer hover:border-iris/40 hover:text-iris",
              );
              if (onResourceClick) {
                return (
                  <button key={`${event.id}-${id}`} type="button" onClick={() => onResourceClick(id)} className={className}>
                    {text}
                  </button>
                );
              }
              return <span key={`${event.id}-${id}`} className={className}>{text}</span>;
            })}
            {hidden > 0 && (
              <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10.5px] text-faint">
                {t("disputeMoreAccounts", { count: hidden })}
              </span>
            )}
          </div>
        )}
        {!!event.refund_amount && (
          <p className="mt-1 font-mono text-[11px] font-semibold tabular text-good">
            {t(viewerRole === "seller" ? "refundAmountMinorSeller" : "refundAmountMinor", {
              amount: formatRefund(event.refund_amount),
            })}
          </p>
        )}
        {evidenceEntries.length > 0 && (
          <div className="mt-2 space-y-0.5 rounded-lg border border-line bg-raised/60 px-2.5 py-2 text-[11.5px]">
            <p className="text-faint">{t("evidence", { type: evidenceTypeLabel(dispute.evidence_type) })}</p>
            {evidenceEntries.map(([key, value]) => (
              <p key={key} className="text-muted">
                <span className="text-faint">{evidenceFieldLabel(dispute.evidence_type, key)}: </span>
                {value}
              </p>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
