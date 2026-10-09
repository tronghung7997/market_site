"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
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
} from "lucide-react";
import { Search } from "@/components/Icons";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fetchAllOrderLines, fetchOrderProxyLines, lineDisplayText } from "@/lib/order-lines";
import { hasOpenDispute } from "@/lib/order-status";
import { lineLabel, resourceLineMap } from "@/lib/order-ref";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { timeLeftLabel } from "@/lib/time";
import { formatDateTime } from "@/lib/utils";
import { fulfillmentFromOrder } from "@/lib/fulfillment";
import { MAX_WARRANTY_CLAIM_GENERATION, resourcePreview, resourceWarrantyGeneration } from "@/lib/dispute-case";
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
  proxyLineClaimState,
  type DisputeIssueId,
} from "@/lib/dispute-form";
import type { DisputeProxyAction, DisputeResourceAction, Order, ProxyLine, Resource } from "@/lib/types";
import { Button, Input, Spinner, Tag, Textarea } from "@/components/ui";
import { ImageUploader, type UploaderImage } from "@/components/media/ImageUploader";
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
  proxyLineNos = [],
  appendToExisting: appendProp,
  onClose,
  onSuccess,
}: {
  /** Row id or order code (`ORD-…`); every order endpoint takes either. */
  orderId: number | string;
  order?: Order | null;
  variantName?: string | null;
  initialReason?: string;
  initialEvidenceType?: string;
  initialEvidence?: Record<string, string>;
  resourceIds?: number[];
  /** Proxy lines (`#NN`) to preselect on a proxy order. */
  proxyLineNos?: number[];
  /** Add claims to the open case. Omitted, it follows the order's dispute state. */
  appendToExisting?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();

  const [orderRecord, setOrderRecord] = useState<Order | null>(orderProp ?? null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [claimedIds, setClaimedIds] = useState<number[]>([]);
  const [resourceActions, setResourceActions] = useState<DisputeResourceAction[]>([]);
  const [loadingScope, setLoadingScope] = useState(true);
  const [scopeError, setScopeError] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>(resourceIds ?? []);
  const [proxyLines, setProxyLines] = useState<ProxyLine[]>([]);
  const [claimedProxyLines, setClaimedProxyLines] = useState<number[]>([]);
  const [proxyActions, setProxyActions] = useState<DisputeProxyAction[]>([]);
  const [selectedProxyLines, setSelectedProxyLines] = useState<number[]>(proxyLineNos);
  const [selectionReady, setSelectionReady] = useState(false);
  // Opened from outside the orders console (e.g. /proxies) the case state is
  // only known once the order has loaded.
  const appendToExisting = appendProp ?? (orderRecord ? hasOpenDispute(orderRecord) : false);
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
  const [evidenceImages, setEvidenceImages] = useState<UploaderImage[]>([]);
  const feeConfig = useQuery({ queryKey: ["public-fee-config"], queryFn: api.feeConfig, staleTime: 60_000 });
  // New cases only: extra claims on an open case carry no images of their own.
  const imagesRequired = !appendToExisting && Boolean(feeConfig.data?.dispute_evidence_image_required);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingScope(true);
    setScopeError("");
    (async () => {
      const fetched = orderProp ?? await api.getOrder(orderId);
      const isProxy = fulfillmentFromOrder(fetched).kind === "proxy";
      const needsExistingCase = Boolean(appendProp || fetched.has_dispute || hasOpenDispute(fetched));
      const [rows, proxies, dispute] = await Promise.all([
        // Any delivered line can be claimed, so the picker needs all of them (paged
        // fetch; long lines come as their head only, so this stays light).
        isProxy ? Promise.resolve([] as Resource[]) : fetchAllOrderLines(orderId),
        // A proxy order is claimed by line (#NN), read from the proxy console.
        isProxy && fetched.order_code ? fetchOrderProxyLines(fetched.order_code) : Promise.resolve([] as ProxyLine[]),
        needsExistingCase ? api.orderDispute(orderId) : Promise.resolve(null),
      ]);
      if (!active) return;
      setOrderRecord(fetched);
      setResources(rows);
      setProxyLines(proxies);
      setClaimedIds(dispute?.claimed_resource_ids ?? []);
      setResourceActions(dispute?.resource_actions ?? []);
      setClaimedProxyLines(dispute?.claimed_proxy_lines ?? []);
      setProxyActions(dispute?.proxy_actions ?? []);
      setLoadingScope(false);
    })().catch((cause: unknown) => {
      if (!active) return;
      setScopeError(apiErrorMessage(cause));
      setLoadingScope(false);
    });
    return () => { active = false; };
  }, [apiErrorMessage, appendProp, orderId, orderProp]);

  const claimableIds = useMemo(
    () => claimableResourceIds(resources, claimedIds).filter(
      (id) => resourceWarrantyGeneration(id, resourceActions) <= MAX_WARRANTY_CLAIM_GENERATION,
    ),
    [claimedIds, resourceActions, resources],
  );
  const claimableRows = useMemo(() => {
    const allowed = new Set(claimableIds);
    return resources.filter((row) => allowed.has(row.id));
  }, [claimableIds, resources]);

  const fulfillmentKind = orderRecord ? fulfillmentFromOrder(orderRecord).kind : undefined;
  const mode = disputeFormMode({
    claimableCount: claimableIds.length,
    appendToExisting,
    fulfillmentKind,
    proxyLineCount: proxyLines.length,
  });
  const issueIds = disputeIssueIds(mode, fulfillmentKind);

  const claimableProxy = useMemo(
    () => claimableProxyLineNos(proxyLines, claimedProxyLines, proxyActions),
    [claimedProxyLines, proxyActions, proxyLines],
  );
  const proxyStates = useMemo(() => {
    const claimed = new Set(claimedProxyLines);
    const refunded = new Set(proxyActions.map((action) => action.line_no));
    return new Map(proxyLines.map((line) => [line.line_no, proxyLineClaimState(line, claimed, refunded)]));
  }, [claimedProxyLines, proxyActions, proxyLines]);

  // Reached from outside the orders console, the order may no longer take a
  // dispute (escrow over) or more claims; say so instead of a form that fails.
  const blockedNotice = !orderProp && orderRecord?.capabilities
    ? appendToExisting
      ? (orderRecord.capabilities.can_append_claims ? null : t("disputeCannotAppend"))
      : (orderRecord.capabilities.can_dispute ? null : t("disputeNotAvailable"))
    : null;

  useEffect(() => {
    if (loadingScope || selectionReady) return;
    setSelectedIds(initialSelectedClaimIds({
      preferredIds: resourceIds ?? [],
      claimableIds,
    }));
    setSelectedProxyLines(initialSelectedClaimIds({
      preferredIds: proxyLineNos,
      claimableIds: claimableProxy,
    }));
    setSelectionReady(true);
  }, [claimableIds, claimableProxy, loadingScope, proxyLineNos, resourceIds, selectionReady]);

  useEffect(() => {
    if (!issueIds.includes(selectedIssue)) {
      setSelectedIssue(defaultDisputeIssue(mode, fulfillmentKind));
    }
  }, [fulfillmentKind, issueIds, mode, selectedIssue]);

  const lines = useMemo(() => resourceLineMap(resources), [resources]);

  const filteredClaimable = useMemo(() => {
    const q = accountQuery.trim().toLowerCase().replace(/^#/, "");
    if (!q) return claimableRows;
    return claimableRows.filter((row) => {
      if (/^\d+$/.test(q) && lines[row.id] === Number(q)) return true;
      // A long line is searched by its head, which holds its first fields.
      const text = lineDisplayText(row);
      const preview = resourcePreview(text)?.toLowerCase() ?? "";
      return preview.includes(q) || text.toLowerCase().includes(q);
    });
  }, [accountQuery, claimableRows]);

  const toggleResource = (id: number) => {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((row) => row !== id) : [...current, id]
    ));
  };

  const toggleProxyLine = (lineNo: number) => {
    setSelectedProxyLines((current) => (
      current.includes(lineNo) ? current.filter((row) => row !== lineNo) : [...current, lineNo].sort((a, b) => a - b)
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
      const remedyLabel = mode === "proxies"
        ? t("disputeDesiredRefundProxies")
        : mode === "accounts"
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

      const proxySubmit = mode === "proxies" ? selectedProxyLines : [];

      if (appendToExisting) {
        await api.appendDisputeClaims(orderId, fullReason, mode === "proxies" ? [] : submitIds ?? selectedIds, proxySubmit);
      } else {
        await api.openDisputeBatched(
          orderId,
          fullReason,
          evidenceType,
          Object.keys(evidence).length > 0 ? evidence : undefined,
          submitIds ?? [],
          evidenceImages.map((image) => image.id),
          proxySubmit,
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
    selectedProxyLines,
    hasIssueDescription,
    submitting,
    loading: loadingScope,
    scopeError: Boolean(scopeError || blockedNotice),
  }) && (!imagesRequired || evidenceImages.length > 0);

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
            <span>
              {!appendToExisting
                ? t("disputeFormTitle")
                : mode === "proxies"
                  ? t("addProxyClaimTitle", { count: selectedProxyLines.length })
                  : t("addClaimTitle", { count: selectedIds.length })}
            </span>
          </DialogTitle>
          <div className="flex items-center gap-2 text-[12px] text-muted mt-1">
            <span className="font-mono text-iris font-semibold">#{orderRecord?.order_code ?? "…"}</span>
            {variantName && (
              <>
                <span>•</span>
                <span className="min-w-0 truncate">{variantName}</span>
              </>
            )}
          </div>
          {!appendToExisting && (orderRecord?.dispute_open_until ?? orderRecord?.escrow_expires_at) && (
            <p className="mt-1.5 text-[11.5px] text-warn">
              {(() => {
                const until = (orderRecord.dispute_open_until ?? orderRecord.escrow_expires_at)!;
                const left = timeLeftLabel(until, locale);
                const date = formatDateTime(until, locale);
                return left ? t("disputeDeadlineLeft", { date, left }) : t("disputeDeadlinePassed", { date });
              })()}
            </p>
          )}
        </div>

        {loadingScope ? (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-raised/40 px-3 py-2.5 text-[12px] text-muted">
            <Spinner />
            <span>{t("disputeLoadingScope")}</span>
          </div>
        ) : scopeError || blockedNotice ? (
          <p role="alert" className="rounded-lg border border-bad/25 bg-bad-soft/30 px-3 py-2 text-[12px] text-bad">
            {scopeError || blockedNotice}
          </p>
        ) : mode === "proxies" ? (
          <div className="rounded-xl border border-warn/25 bg-warn-soft/20 p-3 space-y-2.5">
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-fg">
                {t("disputeSelectedProxies", { count: selectedProxyLines.length })}
              </p>
              <p className="text-[11.5px] text-muted">{t("disputeProxiesNeedSelect")}</p>
            </div>
            {claimableProxy.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedProxyLines([...claimableProxy])}>
                  {t("disputeSelectAllProxies", { count: claimableProxy.length })}
                </Button>
                {selectedProxyLines.length > 0 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedProxyLines([])}>
                    {t("disputeClearSelection")}
                  </Button>
                )}
              </div>
            )}
            {claimableProxy.length === 0 && (
              <p className="text-[12px] text-muted">{t("disputeNoClaimableProxies")}</p>
            )}
            <div
              role="group"
              aria-label={t("disputeProxyLinesAria")}
              className="max-h-56 overflow-y-auto rounded-lg border border-line bg-surface divide-y divide-line"
            >
              {proxyLines.map((line) => {
                const state = proxyStates.get(line.line_no) ?? "inactive";
                const claimable = state === "claimable";
                const checked = selectedProxyLines.includes(line.line_no);
                const statusKey = `disputeProxyStatus.${line.status}`;
                const statusLabel = t.has(statusKey) ? t(statusKey) : line.status;
                return (
                  <label
                    key={line.line_no}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 text-[12px]",
                      claimable ? "cursor-pointer hover:bg-raised/50" : "cursor-not-allowed bg-raised/30",
                      checked && "bg-iris-soft/20",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!claimable}
                      onChange={() => toggleProxyLine(line.line_no)}
                      className="h-4 w-4 shrink-0 accent-iris"
                      aria-label={t("selectProxyLine", { line: lineLabel(line.line_no) })}
                    />
                    <span className="font-mono text-[10.5px] font-bold text-iris bg-iris-soft px-1.5 py-0.5 rounded shrink-0">
                      {lineLabel(line.line_no)}
                    </span>
                    <span className={cn("font-mono min-w-0 flex-1 truncate", claimable ? "text-fg" : "text-muted")}>
                      {line.host ? `${line.host}:${line.port}` : "—"}
                    </span>
                    {state === "claimed" ? (
                      <Tag tone="warn">{t("disputeProxyClaimed")}</Tag>
                    ) : state === "refunded" ? (
                      <Tag tone="neutral">{t("disputeProxyRefunded")}</Tag>
                    ) : (
                      <span className={cn("shrink-0 text-[11px]", claimable ? "text-muted" : "text-faint")}>{statusLabel}</span>
                    )}
                  </label>
                );
              })}
            </div>
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
                    <label htmlFor="dispute-account-search" className="sr-only">
                      {t("disputeAccountSearchPh")}
                    </label>
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                    <Input
                      id="dispute-account-search"
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
                    const preview = resourcePreview(lineDisplayText(row)) ?? lineDisplayText(row);
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
                          aria-label={t("selectAccount", { id: lines[row.id] ?? "" })}
                        />
                        <span className="font-mono text-[10.5px] font-bold text-iris bg-iris-soft px-1.5 py-0.5 rounded shrink-0">
                          {lines[row.id] ? lineLabel(lines[row.id]) : "•"}
                        </span>
                        <span className="font-mono text-fg min-w-0 truncate">{preview}</span>
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
          {!appendToExisting && (
            <p className="rounded-lg border border-line bg-raised/50 px-3 py-2 text-[11.5px] leading-relaxed text-muted">
              <span className="font-medium text-fg">{t("disputeEvidenceFor")}</span> {t(`disputeEvidenceHints.${selectedIssue}`)}
            </p>
          )}
        </div>}

        {!loadingScope && mode !== "proxies" && <div className="space-y-2">
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

        {!appendToExisting && (
          <div className="space-y-1">
            <ImageUploader
              purpose="dispute_evidence"
              value={evidenceImages}
              onChange={setEvidenceImages}
              max={6}
              label={imagesRequired ? `${t("evidenceImagesLabel")} *` : t("evidenceImagesLabel")}
              hint={t("evidenceImagesHint")}
            />
            {imagesRequired && evidenceImages.length === 0 && (
              <p className="text-[12px] text-warn">{t("evidenceImagesRequired")}</p>
            )}
          </div>
        )}

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
        {!loadingScope && mode === "proxies" && selectedProxyLines.length === 0 && claimableProxy.length > 0 && (
          <p className="text-[12px] text-warn font-medium">{t("disputeSubmitNeedProxies")}</p>
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
