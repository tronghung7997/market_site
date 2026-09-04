"use client";

import { useEffect, useMemo, useState } from "react";
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
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { fulfillmentFromOrder } from "@/lib/fulfillment";
import { resourcePreview } from "@/lib/dispute-case";
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
  type DisputeIssueId,
} from "@/lib/dispute-form";
import type { Order, Resource } from "@/lib/types";
import { Button, Input, Spinner, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const ISSUE_ICONS: Record<DisputeIssueId, typeof Key> = {
  wrong_credentials: Key,
  checkpoint_locked: Lock,
  wrong_description: FileQuestion,
  connection_failed: WifiOff,
  other: HelpCircle,
};

export default function DisputeModal({
  orderId,
  order: orderProp,
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
  order?: Order | null;
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

  const [orderRecord, setOrderRecord] = useState<Order | null>(orderProp ?? null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [claimedIds, setClaimedIds] = useState<number[]>([]);
  const [loadingScope, setLoadingScope] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>(resourceIds ?? []);
  const [selectionReady, setSelectionReady] = useState(false);
  const [accountQuery, setAccountQuery] = useState("");

  const [selectedIssue, setSelectedIssue] = useState<DisputeIssueId>("wrong_credentials");
  const [customIssue, setCustomIssue] = useState<string>("");
  const [desiredRemedy, setDesiredRemedy] = useState<"replace" | "refund">("replace");

  const isGenericInitialReason =
    !initialReason ||
    initialReason.startsWith("Có lỗi với") ||
    initialReason.startsWith("Issue with") ||
    (variantName && initialReason.startsWith(`[${variantName}]`));

  const [detailNote, setDetailNote] = useState<string>(
    isGenericInitialReason ? "" : initialReason
  );
  const [proofUrl, setProofUrl] = useState<string>(initialEvidence?.proof_url ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingScope(true);
    const needsExistingCase = Boolean(appendToExisting || orderProp?.has_dispute);
    Promise.all([
      api.orderResources(orderId).catch(() => [] as Resource[]),
      needsExistingCase ? api.orderDispute(orderId).catch(() => null) : Promise.resolve(null),
      orderProp ? Promise.resolve(orderProp) : api.getOrder(orderId).catch(() => null),
    ]).then(([rows, dispute, fetched]) => {
      if (!active) return;
      setResources(rows);
      setClaimedIds(dispute?.claimed_resource_ids ?? []);
      if (fetched) setOrderRecord(fetched);
      setLoadingScope(false);
    });
    return () => { active = false; };
  }, [appendToExisting, orderId, orderProp]);

  const claimableIds = useMemo(
    () => claimableResourceIds(resources, claimedIds),
    [claimedIds, resources],
  );
  const claimableRows = useMemo(() => {
    const allowed = new Set(claimableIds);
    return resources.filter((row) => allowed.has(row.id));
  }, [claimableIds, resources]);

  const mode = disputeFormMode({
    claimableCount: claimableIds.length,
    appendToExisting,
  });
  const fulfillmentKind = orderRecord ? fulfillmentFromOrder(orderRecord).kind : undefined;
  const issueIds = disputeIssueIds(mode, fulfillmentKind);

  useEffect(() => {
    if (loadingScope || selectionReady) return;
    setSelectedIds(initialSelectedClaimIds({
      preferredIds: resourceIds ?? [],
      claimableIds,
    }));
    setSelectionReady(true);
  }, [claimableIds, loadingScope, resourceIds, selectionReady]);

  useEffect(() => {
    if (!issueIds.includes(selectedIssue)) {
      setSelectedIssue(defaultDisputeIssue(mode, fulfillmentKind));
    }
  }, [fulfillmentKind, issueIds, mode, selectedIssue]);

  const filteredClaimable = useMemo(() => {
    const q = accountQuery.trim().toLowerCase().replace(/^#/, "");
    if (!q) return claimableRows;
    return claimableRows.filter((row) => {
      if (String(row.id).includes(q)) return true;
      const preview = resourcePreview(row.data)?.toLowerCase() ?? "";
      return preview.includes(q) || row.data.toLowerCase().includes(q);
    });
  }, [accountQuery, claimableRows]);

  const toggleResource = (id: number) => {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((row) => row !== id) : [...current, id]
    ));
  };

  const selectVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of filteredClaimable) next.add(row.id);
      return [...next];
    });
  };

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    try {
      const issueLabel =
        selectedIssue === "other" && customIssue.trim()
          ? customIssue.trim()
          : t(`disputeIssues.${selectedIssue}`);
      const remedyLabel = mode === "accounts"
        ? (desiredRemedy === "replace" ? t("disputeDesiredReplace") : t("disputeDesiredRefund"))
        : (desiredRemedy === "replace" ? t("disputeDesiredReplaceService") : t("disputeDesiredRefundService"));
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

      const submitIds = disputeSubmitResourceIds(mode, selectedIds);
      const evidenceType = disputeEvidenceType({
        mode,
        fulfillmentKind,
        selectedIssue,
        initialEvidenceType,
      });

      if (appendToExisting) {
        await api.appendDisputeClaims(orderId, fullReason, submitIds ?? selectedIds);
      } else {
        await api.openDisputeBatched(
          orderId,
          fullReason,
          evidenceType,
          Object.keys(evidence).length > 0 ? evidence : undefined,
          submitIds ?? [],
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

  const canSubmit = canSubmitDisputeForm({
    mode,
    selectedIds,
    hasIssueDescription,
    submitting,
    loading: loadingScope,
  });

  const pickerLimit = 50;
  const visibleClaimable = filteredClaimable.slice(0, pickerLimit);

  const replaceTitle = mode === "accounts" ? t("disputeDesiredReplace") : t("disputeDesiredReplaceService");
  const replaceHint = mode === "accounts" ? t("disputeDesiredReplaceHint") : t("disputeDesiredReplaceServiceHint");
  const refundTitle = mode === "accounts" ? t("disputeDesiredRefund") : t("disputeDesiredRefundService");
  const refundHint = mode === "accounts" ? t("disputeDesiredRefundHint") : t("disputeDesiredRefundServiceHint");

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent
        overlayClassName="z-[80]"
        className="z-[80] max-w-2xl border-line bg-surface p-6 gap-4 max-h-[92vh] overflow-y-auto rounded-2xl shadow-card-lg"
      >
        {submitting && (
          <div className="absolute inset-0 z-20 grid place-items-center rounded-2xl bg-surface/80">
            <div className="flex items-center gap-2 text-muted">
              <Spinner />
              <span className="text-[13px]">{t("submitting")}</span>
            </div>
          </div>
        )}
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

        {loadingScope ? (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-raised/40 px-3 py-2.5 text-[12px] text-muted">
            <Spinner />
            <span>{t("disputeLoadingScope")}</span>
          </div>
        ) : mode === "accounts" ? (
          <div className="rounded-xl border border-warn/25 bg-warn-soft/20 p-3 space-y-2.5">
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-fg">
                {t("disputeSelectedSummary", { count: selectedIds.length })}
              </p>
              <p className="text-[11.5px] text-muted">{t("disputeAccountsNeedSelect")}</p>
            </div>
            {claimableRows.length === 0 ? (
              <p className="text-[12px] text-muted">{t("disputeNoClaimableAccounts")}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[180px] flex-1">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                    <Input
                      value={accountQuery}
                      onChange={(e) => setAccountQuery(e.target.value)}
                      placeholder={t("disputeAccountSearchPh")}
                      className="h-8 pl-8 text-[12px]"
                    />
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={selectVisible}>
                    {t("disputeSelectVisible", { count: filteredClaimable.length })}
                  </Button>
                  {selectedIds.length > 0 && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                      {t("disputeClearSelection")}
                    </Button>
                  )}
                </div>
                {filteredClaimable.length > pickerLimit && (
                  <p className="text-[11px] text-muted">
                    {t("disputeAccountPickerCap", { shown: pickerLimit, total: filteredClaimable.length })}
                  </p>
                )}
                <div className="max-h-44 overflow-y-auto rounded-lg border border-line bg-surface divide-y divide-line">
                  {filteredClaimable.length === 0 ? (
                    <p className="px-3 py-2.5 text-[12px] text-muted">{t("disputeAccountSearchEmpty")}</p>
                  ) : visibleClaimable.map((row) => {
                    const checked = selectedIds.includes(row.id);
                    const preview = resourcePreview(row.data) ?? row.data;
                    return (
                      <label
                        key={row.id}
                        className="flex items-center gap-2.5 px-3 py-2 text-[12px] cursor-pointer hover:bg-raised/50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleResource(row.id)}
                          className="h-4 w-4 shrink-0 accent-iris"
                          aria-label={t("selectAccount", { id: row.id })}
                        />
                        <span className="font-mono text-[10.5px] font-bold text-iris bg-iris-soft px-1.5 py-0.5 rounded shrink-0">
                          #{row.id}
                        </span>
                        <span className="font-mono text-fg truncate">{preview}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-line bg-raised/50 px-3 py-2 text-[11.5px] text-muted">
            {t(disputeScopeNoticeKey(mode, fulfillmentKind))}
          </p>
        )}

        {!loadingScope && <div className="space-y-2">
          <label className="text-[12px] font-semibold text-fg block">
            {t("disputeIssueTitle")}
          </label>
          <div className="flex flex-wrap gap-2">
            {issueIds.map((item) => {
              const Icon = ISSUE_ICONS[item];
              const isSelected = selectedIssue === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSelectedIssue(item)}
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
                  <span className="whitespace-nowrap">{t(`disputeIssues.${item}`)}</span>
                </button>
              );
            })}
          </div>

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
        </div>}

        {!loadingScope && <div className="space-y-2">
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
                  {replaceTitle}
                </p>
                <p className="text-[10.5px] text-muted mt-0.5 truncate">
                  {replaceHint}
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
                  {refundTitle}
                </p>
                <p className="text-[10.5px] text-muted mt-0.5 truncate">
                  {refundHint}
                </p>
              </div>
            </button>
          </div>
        </div>}

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
        {!loadingScope && mode === "accounts" && selectedIds.length === 0 && claimableRows.length > 0 && (
          <p className="text-[12px] text-warn font-medium">{t("disputeSubmitNeedAccounts")}</p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-line">
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
