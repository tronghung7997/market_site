"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  RefreshCw,
  DollarSign,
  Image as ImageIcon,
  Key,
  Lock,
  FileQuestion,
  WifiOff,
  HelpCircle,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { Button, Input, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const QUICK_ISSUES = [
  { id: "wrong_credentials", icon: Key },
  { id: "checkpoint_locked", icon: Lock },
  { id: "wrong_description", icon: FileQuestion },
  { id: "connection_failed", icon: WifiOff },
  { id: "other", icon: HelpCircle },
] as const;

type QuickIssueId = (typeof QUICK_ISSUES)[number]["id"];

export default function DisputeModal({
  orderId,
  variantName,
  initialReason,
  initialEvidenceType,
  initialEvidence,
  resourceIds = [],
  appendToExisting,
  onClose,
  onSuccess,
}: {
  orderId: number;
  variantName?: string | null;
  initialReason?: string;
  initialEvidenceType?: string;
  initialEvidence?: Record<string, string>;
  resourceIds?: number[];
  appendToExisting?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const apiErrorMessage = useApiErrorMessage();

  // Resource IDs selected
  const [selectedIds, setSelectedIds] = useState<number[]>(resourceIds ?? []);

  // 1. Quick Issue Selector
  const [selectedIssue, setSelectedIssue] = useState<QuickIssueId>("wrong_credentials");
  const [customIssue, setCustomIssue] = useState<string>("");

  // 2. Desired Remedy: Replace vs Refund
  const [desiredRemedy, setDesiredRemedy] = useState<"replace" | "refund">("replace");

  // 3. Detail Note (clean out auto-generated generic strings so placeholder shows)
  const isGenericInitialReason =
    !initialReason ||
    initialReason.startsWith("Có lỗi với") ||
    initialReason.startsWith("Issue with") ||
    (variantName && initialReason.startsWith(`[${variantName}]`));

  const [detailNote, setDetailNote] = useState<string>(
    isGenericInitialReason ? "" : initialReason
  );

  // 4. Proof screenshot / link
  const [proofUrl, setProofUrl] = useState<string>(initialEvidence?.proof_url ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const removeResourceId = (idToRemove: number) => {
    setSelectedIds((prev) => prev.filter((id) => id !== idToRemove));
  };

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    try {
      const issueLabel =
        selectedIssue === "other" && customIssue.trim()
          ? customIssue.trim()
          : t(`disputeIssues.${selectedIssue}`);
      const remedyLabel =
        desiredRemedy === "replace"
          ? t("disputeDesiredReplace")
          : t("disputeDesiredRefund");
      const noteTrimmed = detailNote.trim();

      const fullReason = noteTrimmed
        ? `[${issueLabel}] [${remedyLabel}] ${noteTrimmed}`
        : `[${issueLabel}] [${remedyLabel}]`;

      const evidence: Record<string, string> = {
        issue: issueLabel,
        desired_remedy: remedyLabel,
      };
      if (selectedIssue === "other" && customIssue.trim()) {
        evidence.custom_issue = customIssue.trim();
      }
      if (initialEvidence?.username) {
        evidence.username = initialEvidence.username;
      }
      if (proofUrl.trim()) {
        evidence.proof_url = proofUrl.trim();
      }
      if (noteTrimmed) {
        evidence.error = noteTrimmed;
      }

      const effectiveEvidenceType =
        initialEvidenceType ||
        (selectedIssue === "connection_failed" ? "proxy" : "account");

      if (appendToExisting) {
        await api.appendDisputeClaims(orderId, fullReason, selectedIds);
      } else {
        await api.openDisputeBatched(
          orderId,
          fullReason,
          effectiveEvidenceType,
          Object.keys(evidence).length > 0 ? evidence : undefined,
          selectedIds.length > 0 ? selectedIds : undefined,
        );
      }
      onSuccess();
    } catch (e: unknown) {
      setError(apiErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  const hasIssueDescription =
    selectedIssue !== "other" ||
    customIssue.trim().length > 0 ||
    detailNote.trim().length > 0;

  const canSubmit =
    !submitting &&
    (!appendToExisting || selectedIds.length > 0) &&
    hasIssueDescription;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[480px] border-line bg-surface p-6 gap-4 max-h-[92vh] overflow-y-auto rounded-2xl shadow-card-lg">
        {/* Header */}
        <div className="border-b border-line pb-3">
          <DialogTitle className="text-[16px] font-bold text-fg flex items-center gap-2">
            <AlertTriangle size={18} className="text-warn shrink-0" />
            <span>{appendToExisting ? t("addClaimTitle", { count: selectedIds.length }) : t("disputeFormTitle")}</span>
          </DialogTitle>
          <div className="flex items-center gap-2 text-[12px] text-muted mt-1">
            <span className="font-mono text-iris font-semibold">#{orderId}</span>
            {variantName && (
              <>
                <span>•</span>
                <span className="truncate">{variantName}</span>
              </>
            )}
          </div>
        </div>

        {/* 1. Account Selection Review (if items are selected) */}
        {selectedIds.length > 0 ? (
          <div className="rounded-xl border border-warn/25 bg-warn-soft/20 p-3 space-y-2">
            <div className="flex items-center justify-between text-[11.5px] font-semibold text-fg">
              <span>{t("disputeSelectedSummary", { count: selectedIds.length })}</span>
            </div>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
              {selectedIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-fg shadow-2xs"
                >
                  <span>#{id}</span>
                  {selectedIds.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeResourceId(id)}
                      title={t("disputeRemoveAccount", { id })}
                      className="text-faint hover:text-bad ml-0.5 cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        ) : (
          !appendToExisting && (
            <p className="rounded-lg border border-line bg-raised/50 px-3 py-2 text-[11.5px] text-muted">
              {t("disputeWholeOrderNotice")}
            </p>
          )
        )}

        {/* 2. Quick Issue Selection */}
        <div className="space-y-2">
          <label className="text-[12px] font-semibold text-fg block">
            {t("disputeIssueTitle")}
          </label>
          <div className="flex flex-wrap gap-2">
            {QUICK_ISSUES.map((item) => {
              const Icon = item.icon;
              const isSelected = selectedIssue === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedIssue(item.id)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-medium transition-all cursor-pointer ${
                    isSelected
                      ? "border-iris bg-iris-soft/30 font-semibold text-fg shadow-2xs ring-1 ring-iris"
                      : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg"
                  }`}
                >
                  <div
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      isSelected
                        ? "border-iris bg-iris text-white"
                        : "border-muted"
                    }`}
                  >
                    {isSelected ? <Check size={10} strokeWidth={3} /> : <Icon size={10} />}
                  </div>
                  <span className="whitespace-nowrap">{t(`disputeIssues.${item.id}`)}</span>
                </button>
              );
            })}
          </div>

          {/* Ô nhập cụ thể khi chọn 'Vấn đề khác' */}
          {selectedIssue === "other" && (
            <div className="pt-1.5 space-y-1">
              <label className="text-[11.5px] font-semibold text-fg block">
                {t("disputeCustomIssueLabel")}
              </label>
              <Input
                autoFocus
                placeholder={t("disputeCustomIssuePh")}
                value={customIssue}
                onChange={(e) => setCustomIssue(e.target.value)}
                className="text-[12px] h-9"
              />
            </div>
          )}
        </div>

        {/* 3. Desired Resolution: Replace vs Refund */}
        <div className="space-y-2">
          <label className="text-[12px] font-semibold text-fg block">
            {t("disputeDesiredTitle")}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDesiredRemedy("replace")}
              className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all cursor-pointer ${
                desiredRemedy === "replace"
                  ? "border-iris bg-iris-soft/30 font-semibold text-fg shadow-2xs ring-1 ring-iris"
                  : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg"
              }`}
            >
              <RefreshCw
                size={16}
                className={desiredRemedy === "replace" ? "text-iris" : "text-muted"}
              />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-fg leading-tight truncate">
                  {t("disputeDesiredReplace")}
                </p>
                <p className="text-[10.5px] text-muted mt-0.5 truncate">
                  {t("disputeDesiredReplaceHint")}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setDesiredRemedy("refund")}
              className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all cursor-pointer ${
                desiredRemedy === "refund"
                  ? "border-warn bg-warn-soft/30 font-semibold text-fg shadow-2xs ring-1 ring-warn"
                  : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg"
              }`}
            >
              <DollarSign
                size={16}
                className={desiredRemedy === "refund" ? "text-warn" : "text-muted"}
              />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-fg leading-tight truncate">
                  {t("disputeDesiredRefund")}
                </p>
                <p className="text-[10.5px] text-muted mt-0.5 truncate">
                  {t("disputeDesiredRefundHint")}
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* 4. Additional Detail Note */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-semibold text-fg block">
            {t("disputeDetailNoteLabel")}
          </label>
          <Textarea
            rows={2}
            placeholder={t("disputeDetailNotePh")}
            value={detailNote}
            onChange={(e) => setDetailNote(e.target.value)}
            className="text-[12px]"
          />
        </div>

        {/* 5. Screenshot / Proof Link */}
        <div className="space-y-1">
          <label className="text-[11.5px] text-muted flex items-center gap-1.5">
            <ImageIcon size={13} className="text-faint" />
            <span>{t("disputeProofLabel")}</span>
          </label>
          <Input
            placeholder={t("disputeProofPh")}
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
            className="text-[12px] h-8.5"
          />
        </div>

        {error && <p className="text-[12px] text-bad font-medium">{error}</p>}

        {/* Footer Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {tc("cancel")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? t("submitting") : t("disputeSubmitBtn")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
