"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";
import { EVIDENCE_TYPE_KEYS } from "@/lib/dispute-evidence";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export default function DisputeModal({
  orderId,
  variantName,
  initialReason,
  initialEvidenceType,
  initialEvidence,
  onClose,
  onSuccess,
}: {
  orderId: number;
  variantName?: string | null;
  initialReason?: string;
  initialEvidenceType?: string;
  initialEvidence?: Record<string, string>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [reason, setReason] = useState(
    initialReason ?? (variantName ? t("reasonPackagePrefix", { name: variantName }) : ""),
  );

  const localizeApiError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    const byDetail: Record<string, string> = {
      "Chỉ có thể khiếu nại đơn đã giao": "DISPUTE_ONLY_DELIVERED",
      "Thời gian ký quỹ đã hết hạn": "DISPUTE_ESCROW_EXPIRED",
      "Đơn hàng này đã có khiếu nại": "DISPUTE_ALREADY_OPEN",
      "Không tìm thấy đơn hàng": "ORDER_NOT_FOUND",
      "Đây không phải đơn hàng của bạn": "NOT_ORDER_OWNER",
    };
    const code = byDetail[message];
    if (code) return te(code);
    return message || te("UNKNOWN");
  };
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
      await api.openDispute(
        orderId,
        reason.trim(),
        evidenceType || undefined,
        Object.keys(evidence).length > 0 ? evidence : undefined,
      );
      onSuccess();
    } catch (e: unknown) {
      setError(localizeApiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[420px] border-line bg-surface p-6 gap-4 max-h-[90vh] overflow-y-auto">
        <DialogTitle className="text-[16px] font-semibold">{t("disputeTitle", { id: orderId })}</DialogTitle>
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
