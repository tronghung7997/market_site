"use client";

/** Create / edit one campaign. Grouped the way an admin thinks about it —
 *  the code, the offer, who may use it, how much, and when — with the whole
 *  campaign read back as one sentence before saving. */

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatLedgerMoney } from "@/lib/money";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { CategoryAdminRow, Promotion, PromotionInput } from "@/lib/types";
import { Banner, Button, Field, Input, Skeleton, Tag, Textarea } from "@/components/ui";
import { ConfirmModal, SlidePanel } from "@/components/admin";
import { Info, Sparkles, Trash } from "@/components/Icons";
import {
  PROMOTIONS_KEY, STATE_META, describeCampaign, digits, draftFromPromotion, emptyDraft, formatWhen, randomCode, validateDraft,
  type DraftErrors, type PromotionDraft,
} from "../model";

const money = (n: number) => formatLedgerMoney(n, "vi");

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function MoneyInput({ value, onChange, placeholder, invalid }: {
  value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        inputMode="numeric"
        value={value ? Number(value).toLocaleString("vi-VN") : ""}
        onChange={(e) => onChange(digits(e.target.value))}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className="pr-8 text-right font-mono tabular placeholder:font-sans"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">₫</span>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[13px] text-fg">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-iris" />
      <span>{children}</span>
    </label>
  );
}

function Redemptions({ promotionId }: { promotionId: number }) {
  const apiErrorMessage = useApiErrorMessage();
  const q = useQuery({ queryKey: [...PROMOTIONS_KEY, promotionId, "redemptions"], queryFn: () => api.adminPromotionRedemptions(promotionId) });
  if (q.isPending) return <Skeleton className="h-16 w-full" />;
  if (q.isError) return <Banner tone="bad">{apiErrorMessage(q.error, "Không tải được danh sách đơn.")}</Banner>;
  if (q.data.length === 0) return <p className="text-[12.5px] text-muted">Chưa có đơn nào dùng mã này.</p>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {q.data.map((r) => (
        <li key={r.order_id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
          <div className="min-w-0">
            <Link href={`/admin/orders/${r.order_id}`} className="font-mono font-medium text-iris-hi hover:underline">{r.order_code}</Link>
            <p className="truncate text-faint">{r.buyer_email} · {formatWhen(r.created_at)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono tabular text-good">−{money(r.discount_amount)}</p>
            <p className={cn("text-[11.5px]", r.order_status === "cancelled" ? "text-faint line-through" : "text-muted")}>
              khách trả {money(r.paid_amount)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EditorBody({ promotion, categories, categoryName, onClose }: {
  promotion: Promotion | null;
  categories: CategoryAdminRow[];
  categoryName: (id: number) => string | undefined;
  onClose: () => void;
}) {
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PromotionDraft>(() => (promotion ? draftFromPromotion(promotion) : emptyDraft()));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const used = (promotion?.uses ?? 0) > 0;
  const set = <K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const preview = validateDraft({ ...draft, code: draft.code || "MA", name: draft.name || "x" }).input;

  const save = useMutation({
    mutationFn: (input: PromotionInput) =>
      promotion ? api.adminUpdatePromotion(promotion.id, input) : api.adminCreatePromotion(input),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: PROMOTIONS_KEY }); onClose(); },
  });
  const remove = useMutation({
    mutationFn: () => api.adminDeletePromotion(promotion!.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: PROMOTIONS_KEY }); onClose(); },
  });

  // Top-level categories first, children indented under them.
  const roots = categories.filter((c) => c.parent_id == null);
  const childrenOf = (id: number) => categories.filter((c) => c.parent_id === id);
  const toggleCategory = (id: number, on: boolean) =>
    set("category_ids", on ? [...draft.category_ids, id] : draft.category_ids.filter((c) => c !== id));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const { input, errors: found } = validateDraft(draft);
        if (input) save.mutate(input); else setErrors(found);
      }}
      noValidate
    >
      {promotion && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Tag tone={STATE_META[promotion.state].tone}>{STATE_META[promotion.state].label}</Tag>
          <span>{promotion.uses.toLocaleString("vi-VN")} lượt · {money(promotion.discount_given)} đã giảm</span>
        </div>
      )}

      <Section title="Mã và tên">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mã khách nhập" error={errors.code} hint={used ? "Mã đã có đơn dùng nên không đổi được." : "Chữ in hoa, số, - hoặc _."}>
            <div className="flex gap-2">
              <Input
                value={draft.code}
                onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s/g, ""))}
                disabled={used}
                maxLength={32}
                placeholder="VD: SALE1010"
                aria-invalid={errors.code ? true : undefined}
                className="font-mono uppercase"
              />
              {!used && (
                <Button type="button" variant="secondary" className="h-10 shrink-0" onClick={() => set("code", randomCode())} aria-label="Tạo mã ngẫu nhiên">
                  <Sparkles size={14} />
                </Button>
              )}
            </div>
          </Field>
          <Field label="Tên chiến dịch" error={errors.name} hint="Chỉ admin thấy.">
            <Input value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={120} placeholder="VD: Sale 10.10" aria-invalid={errors.name ? true : undefined} />
          </Field>
        </div>
      </Section>

      <Section title="Ưu đãi">
        <div className="flex gap-1.5" role="radiogroup" aria-label="Kiểu giảm giá">
          {([["percent", "Giảm theo %"], ["fixed", "Giảm số tiền cố định"]] as const).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              size="sm"
              role="radio"
              aria-checked={draft.discount_type === key}
              variant={draft.discount_type === key ? "primary" : "secondary"}
              onClick={() => set("discount_type", key)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {draft.discount_type === "percent" ? (
            <>
              <Field label="Giảm (%)" error={errors.discount_value}>
                <div className="relative">
                  <Input
                    inputMode="numeric"
                    value={draft.discount_value}
                    onChange={(e) => set("discount_value", digits(e.target.value).slice(0, 3))}
                    aria-invalid={errors.discount_value ? true : undefined}
                    className="pr-8 text-right font-mono tabular placeholder:font-sans"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">%</span>
                </div>
              </Field>
              <Field label="Giảm tối đa" error={errors.max_discount_amount} hint="Để trống: không giới hạn.">
                <MoneyInput value={draft.max_discount_amount} onChange={(v) => set("max_discount_amount", v)} placeholder="Không giới hạn" invalid={!!errors.max_discount_amount} />
              </Field>
            </>
          ) : (
            <Field label="Số tiền giảm" error={errors.discount_value}>
              <MoneyInput value={draft.discount_value} onChange={(v) => set("discount_value", v)} invalid={!!errors.discount_value} />
            </Field>
          )}
        </div>
      </Section>

      <Section title="Ai được dùng" hint="Để trống mọi ô: mọi khách, mọi sản phẩm.">
        <Field label="Giá trị đơn tối thiểu (trước giảm)">
          <MoneyInput value={draft.min_order_amount} onChange={(v) => set("min_order_amount", v)} placeholder="Không yêu cầu" />
        </Field>
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-muted">Danh mục áp dụng</p>
          <p className="text-[12px] text-faint">Không chọn: mọi danh mục. Chọn danh mục cha là gồm cả danh mục con.</p>
          <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-line p-3">
            {roots.length === 0 && <p className="text-[12px] text-faint">Chưa tải được danh mục.</p>}
            {roots.map((root) => (
              <div key={root.id} className="space-y-1.5">
                <Check checked={draft.category_ids.includes(root.id)} onChange={(on) => toggleCategory(root.id, on)}>{root.name}</Check>
                <div className="space-y-1.5 pl-6">
                  {childrenOf(root.id).map((child) => (
                    <Check key={child.id} checked={draft.category_ids.includes(child.id)} onChange={(on) => toggleCategory(child.id, on)}>{child.name}</Check>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <Check checked={draft.new_buyers_only} onChange={(v) => set("new_buyers_only", v)}>
          Chỉ cho đơn đầu tiên của khách <span className="text-muted">(khách chưa từng mua thành công)</span>
        </Check>
      </Section>

      <Section title="Giới hạn" hint="Chiến dịch tự dừng khi chạm giới hạn đầu tiên. Đơn bị huỷ trả lại lượt.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Mỗi khách tối đa" error={errors.per_buyer_limit}>
            <Input inputMode="numeric" value={draft.per_buyer_limit} onChange={(e) => set("per_buyer_limit", digits(e.target.value))} placeholder="Không giới hạn" className="text-right font-mono tabular placeholder:font-sans" />
          </Field>
          <Field label="Tổng số lượt" error={errors.usage_limit}>
            <Input inputMode="numeric" value={draft.usage_limit} onChange={(e) => set("usage_limit", digits(e.target.value))} placeholder="Không giới hạn" className="text-right font-mono tabular placeholder:font-sans" />
          </Field>
          <Field label="Ngân sách giảm giá" error={errors.budget_amount}>
            <MoneyInput value={draft.budget_amount} onChange={(v) => set("budget_amount", v)} placeholder="Không giới hạn" invalid={!!errors.budget_amount} />
          </Field>
        </div>
      </Section>

      <Section title="Thời gian" hint="Giờ theo máy của bạn. Để trống: chạy ngay / không hết hạn.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bắt đầu">
            <Input type="datetime-local" value={draft.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
          </Field>
          <Field label="Kết thúc" error={errors.ends_at}>
            <Input type="datetime-local" value={draft.ends_at} onChange={(e) => set("ends_at", e.target.value)} aria-invalid={errors.ends_at ? true : undefined} />
          </Field>
        </div>
        <Check checked={draft.is_active} onChange={(v) => set("is_active", v)}>
          Bật chiến dịch <span className="text-muted">(tắt để tạm dừng, khách nhập mã sẽ báo không dùng được)</span>
        </Check>
      </Section>

      <Field label="Ghi chú nội bộ">
        <Textarea value={draft.note} onChange={(e) => set("note", e.target.value)} maxLength={2000} placeholder="VD: gửi qua group Facebook, KOL A" className="min-h-[64px]" />
      </Field>

      {preview && (
        <Banner tone="iris" icon={<Info size={15} />} title="Tóm tắt">
          {describeCampaign(preview, money, categoryName)} Sàn trả phần giảm giá cho người bán khi giải ngân.
        </Banner>
      )}

      {promotion && (
        <Section title="Đơn đã dùng mã">
          <Redemptions promotionId={promotion.id} />
        </Section>
      )}

      {save.isError && <Banner tone="bad">{apiErrorMessage(save.error, "Lưu không thành công.")}</Banner>}
      {remove.isError && <Banner tone="bad">{apiErrorMessage(remove.error, "Xoá không thành công.")}</Banner>}

      <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-2 border-t border-line bg-surface px-5 py-3">
        {promotion && !used && (
          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} className="text-bad">
            <Trash size={14} /> Xoá
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>Huỷ</Button>
          <Button type="submit" loading={save.isPending}>{promotion ? "Lưu thay đổi" : "Tạo chiến dịch"}</Button>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title={`Xoá chiến dịch ${promotion?.code ?? ""}?`}
        description="Chưa có đơn nào dùng mã này nên có thể xoá hẳn. Không hoàn tác được."
        confirmText="Xoá"
        variant="danger"
        isLoading={remove.isPending}
      />
    </form>
  );
}

export function PromotionEditor({ target, categories, categoryName, onClose }: {
  target: Promotion | "new" | null;
  categories: CategoryAdminRow[];
  categoryName: (id: number) => string | undefined;
  onClose: () => void;
}) {
  const promotion = target && target !== "new" ? target : null;
  return (
    <SlidePanel isOpen={target !== null} onClose={onClose} title={promotion ? `Chiến dịch ${promotion.code}` : "Tạo chiến dịch khuyến mãi"} width="xl">
      {target !== null && (
        <EditorBody
          key={promotion?.id ?? "new"}
          promotion={promotion}
          categories={categories}
          categoryName={categoryName}
          onClose={onClose}
        />
      )}
    </SlidePanel>
  );
}
