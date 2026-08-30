"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { EVIDENCE_TYPE_KEYS } from "@/lib/dispute-evidence";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export default function DisputeModal({
  orderId,
  variantName,
  initialReason,
  initialEvidenceType,
  initialEvidence,
  resourceIds,
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
  const [reason, setReason] = useState(
    initialReason ?? (variantName ? t("reasonPackagePrefix", { name: variantName }) : ""),
  );
  const [evidenceType, setEvidenceType] = useState(initialEvidenceType ?? "account");
  const [evidenceValues, setEvidenceValues] = useState<Record<string, string>>(initialEvidence ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fieldKeys = evidenceType ? (EVIDENCE_TYPE_KEYS[evidenceType] ?? []) : [];

  async function handleSubmit() {
    if (!reason.trim()) return;
    setSubmitting(true); setError("");
    try {
      const evidence = Object.fromEntries(
        Object.entries(evidenceValues).filter(([, v]) => v.trim() !== ""),
      );
      if (appendToExisting) {
        await api.appendDisputeClaims(orderId, reason.trim(), resourceIds ?? []);
      } else {
        await api.openDisputeBatched(
          orderId,
          reason.trim(),
          evidenceType || undefined,
          Object.keys(evidence).length > 0 ? evidence : undefined,
          resourceIds,
        );
      }
      onSuccess();
    } catch (e: unknown) {
      setError(apiErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[420px] border-line bg-surface p-6 gap-4 max-h-[90vh] overflow-y-auto">
        <DialogTitle className="text-[16px] font-semibold">
          {appendToExisting ? t("addClaimTitle", { count: resourceIds?.length ?? 0 }) : t("disputeTitle", { id: orderId })}
        </DialogTitle>
        {!!resourceIds?.length && (
          <p className="rounded-lg border border-bad/20 bg-bad-soft/25 px-3 py-2 text-[12px] text-muted">
            {t("selectedAccounts", { count: resourceIds.length })}
          </p>
        )}
        <Textarea rows={4} placeholder={t("disputeReasonPh")} value={reason} onChange={(e) => setReason(e.target.value)} />

        <div className="space-y-1">
          <label className="text-[12px] text-faint">{t("evidenceType")}</label>
          <Select
            value={evidenceType}
            onChange={(e) => { setEvidenceType(e.target.value); setEvidenceValues({}); }}
          >
            <option value="">{t("evidenceNone")}</option>
            {Object.keys(EVIDENCE_TYPE_KEYS).map((key) => (
              <option key={key} value={key}>{t(`evidenceTypes.${key}`)}</option>
            ))}
          </Select>
        </div>

        {fieldKeys.map((f) => (
          <div key={f} className="space-y-1">
            <label className="text-[12px] text-faint">{t(`evidenceFields.${f}`)}</label>
            <Input
              placeholder={t(`evidencePh.${f === "error" && evidenceType === "server" ? "server_error" : f === "error" && evidenceType === "payment" ? "payment_error" : f}` as "evidencePh.username")}
              value={evidenceValues[f] ?? ""}
              onChange={(e) => setEvidenceValues((prev) => ({ ...prev, [f]: e.target.value }))}
            />
          </div>
        ))}

        {error && <p className="text-[12px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{tc("cancel")}</Button>
          <Button variant="danger" onClick={handleSubmit} disabled={submitting || !reason.trim()}>
            {submitting ? t("submitting") : t("submitDispute")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
