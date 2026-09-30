"use client";

/** "Tạo hàng loạt mã dùng 1 lần": N random single-use codes that carry an
 *  existing campaign's offer and limits. CSV download right after. */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { downloadFromBff } from "@/lib/download";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useToast } from "@/components/toast";
import type { AdminPromotion } from "@/lib/types";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
import { ConfirmModal } from "@/components/admin";
import { Download } from "@/components/Icons";
import { PROMOTIONS_KEY } from "../model";
import { digits, sampleCode, validateBulkCodes, type BulkCodesErrors, type BulkCodesForm } from "../form";

export function BulkCodesDialog({ open, onClose, promotion }: {
  open: boolean;
  onClose: () => void;
  /** Fixed campaign (from its page); omitted = pick one (from the list). */
  promotion?: AdminPromotion;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const [form, setForm] = React.useState<BulkCodesForm>({ promotionId: promotion ? String(promotion.id) : "", prefix: "", count: "100", length: "8" });
  const [errors, setErrors] = React.useState<BulkCodesErrors>({});
  const [created, setCreated] = React.useState<{ id: number; code: string; count: number } | null>(null);

  const choices = useQuery({
    queryKey: [...PROMOTIONS_KEY, "list", "bulk-choices"],
    queryFn: () => api.adminPromotions({ sort: "updated", per_page: 100 }),
    enabled: open && !promotion,
  });
  const options = promotion ? [promotion] : (choices.data?.items ?? []);
  const selected = options.find((p) => String(p.id) === form.promotionId);

  const set = (patch: Partial<BulkCodesForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => { const next = { ...e }; for (const k of Object.keys(patch)) delete next[k as keyof BulkCodesForm]; return next; });
  };

  const create = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof api.adminCreatePromotionCodes>[1] }) => api.adminCreatePromotionCodes(id, body),
    onSuccess: (res, { id }) => {
      void queryClient.invalidateQueries({ queryKey: PROMOTIONS_KEY });
      setCreated({ id, code: selected?.code ?? String(id), count: res.created });
    },
  });

  const close = () => {
    onClose();
    // Reset after the close animation starts so the dialog does not flash back to the form.
    setTimeout(() => { setCreated(null); create.reset(); setErrors({}); }, 150);
  };

  const submit = () => {
    const { body, promotionId, errors: found } = validateBulkCodes(form);
    if (!body || promotionId == null) { setErrors(found); return; }
    create.mutate({ id: promotionId, body });
  };

  const download = async () => {
    if (!created) return;
    try {
      await downloadFromBff(api.adminPromotionCodesCsvUrl(created.id, { status: "unused" }), { fallbackName: `${created.code}-ma.csv` });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Không tải được file CSV."));
    }
  };

  const preview = sampleCode(form.prefix, Math.min(12, Math.max(6, Number(form.length) || 8)), () => 0.37);
  const count = Number(form.count) || 0;

  if (created) {
    return (
      <ConfirmModal
        isOpen={open}
        onClose={close}
        onConfirm={close}
        title={`Đã tạo ${created.count.toLocaleString("vi-VN")} mã`}
        description={`Mỗi mã dùng được 1 lần, cùng ưu đãi và giới hạn của ${created.code}. Xem và lọc mã ở tab “Mã” của chiến dịch.`}
        confirmText="Xong"
        cancelText="Đóng"
      >
        <Button variant="secondary" onClick={() => void download()}><Download size={14} /> Tải CSV mã chưa dùng</Button>
      </ConfirmModal>
    );
  }

  return (
    <ConfirmModal
      isOpen={open}
      onClose={close}
      onConfirm={submit}
      title="Tạo hàng loạt mã dùng 1 lần"
      description="Mỗi mã chỉ dùng được một lần và mang ưu đãi, điều kiện, thời gian của chiến dịch được chọn."
      confirmText={count > 0 ? `Tạo ${count.toLocaleString("vi-VN")} mã` : "Tạo mã"}
      isLoading={create.isPending}
    >
      <div className="space-y-3">
        <Field label="Dùng ưu đãi của" error={errors.promotionId}>
          {promotion ? (
            <Input value={`${promotion.code} · ${promotion.name}`} disabled />
          ) : (
            <Select value={form.promotionId} onChange={(e) => set({ promotionId: e.target.value })} aria-invalid={errors.promotionId ? true : undefined} disabled={choices.isPending}>
              <option value="">{choices.isPending ? "Đang tải…" : "Chọn chiến dịch"}</option>
              {options.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </Select>
          )}
        </Field>
        {choices.isError && <Banner tone="bad">{apiErrorMessage(choices.error, "Không tải được danh sách chiến dịch.")}</Banner>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tiền tố" error={errors.prefix} hint="Tuỳ chọn, VD: KOL-">
            <Input value={form.prefix} maxLength={12} onChange={(e) => set({ prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })} className="font-mono uppercase" aria-invalid={errors.prefix ? true : undefined} />
          </Field>
          <Field label="Số lượng" error={errors.count} hint="Tối đa 5.000">
            <Input inputMode="numeric" value={form.count} onChange={(e) => set({ count: digits(e.target.value).slice(0, 4) })} className="text-right font-mono tabular" aria-invalid={errors.count ? true : undefined} />
          </Field>
        </div>
        <Field label="Độ dài phần ngẫu nhiên" error={errors.length}>
          <Select value={form.length} onChange={(e) => set({ length: e.target.value })}>
            {[6, 7, 8, 9, 10, 11, 12].map((n) => <option key={n} value={n}>{n} ký tự</option>)}
          </Select>
        </Field>
        <p className="text-[12px] text-muted">
          Ví dụ: <span className="font-mono text-fg">{preview}</span> · mỗi mã 1 lượt · tải CSV sau khi tạo.
          {selected && selected.state !== "running" && <> Chiến dịch đang <b>không chạy</b>: mã chỉ dùng được khi chiến dịch chạy.</>}
        </p>
        {create.isError && <Banner tone="bad">{apiErrorMessage(create.error, "Không tạo được mã.")}</Banner>}
      </div>
    </ConfirmModal>
  );
}
