"use client";

/** Modal mở khiếu nại — giờ đứng trên radix Dialog (components/ui/dialog):
 *  được focus-trap, đóng bằng ESC/click nền/nút ✕ miễn phí, thay cho modal
 *  div tự chế. Nội dung form giữ nguyên: lý do + loại bằng chứng động. */

import { useState } from "react";
import { api } from "@/lib/api";
import { EVIDENCE_TYPES } from "@/lib/dispute-evidence";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export default function DisputeModal({ orderId, onClose, onSuccess }: {
  orderId: number; onClose: () => void; onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [evidenceType, setEvidenceType] = useState("");
  const [evidenceValues, setEvidenceValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fields = evidenceType ? EVIDENCE_TYPES[evidenceType]?.fields ?? [] : [];

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
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[420px] border-line bg-surface p-6 gap-4 max-h-[90vh] overflow-y-auto">
        <DialogTitle className="text-[16px] font-semibold">Mở khiếu nại — Đơn #{orderId}</DialogTitle>
        <Textarea rows={4} placeholder="Mô tả lý do khiếu nại…" value={reason} onChange={(e) => setReason(e.target.value)} />

        <div className="space-y-1">
          <label className="text-[12px] text-faint">Loại bằng chứng (tuỳ chọn)</label>
          <Select
            value={evidenceType}
            onChange={(e) => { setEvidenceType(e.target.value); setEvidenceValues({}); }}
          >
            <option value="">Không có bằng chứng cụ thể</option>
            {Object.entries(EVIDENCE_TYPES).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </Select>
        </div>

        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <label className="text-[12px] text-faint">{f.label}</label>
            <Input
              placeholder={f.placeholder}
              value={evidenceValues[f.key] ?? ""}
              onChange={(e) => setEvidenceValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}

        {error && <p className="text-[12px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button variant="danger" onClick={handleSubmit} disabled={submitting || !reason.trim()}>
            {submitting ? "Đang gửi…" : "Gửi khiếu nại"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
