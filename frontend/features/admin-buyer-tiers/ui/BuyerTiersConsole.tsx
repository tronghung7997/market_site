"use client";

/** Admin › Hạng người mua: criterion (total deposit or total spent), the
 *  public-API flood guard per IP, the three levels with editable names,
 *  thresholds, cashback % and per-key public-API limits. Saving is audit-logged and goes through two-step approval when it
 *  is on (section buyer_tier_config); tiers move at the 03:00 tier job (or
 *  when an admin runs it from Xét hạng). Admin copy is Vietnamese-only. */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { BuyerTierConfig, BuyerTierCriterion } from "@/lib/types";
import { Button, Input, Spinner } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";
import { useToast } from "@/components/toast";
import { PendingChangeNotice, reasonOk, useConfigApproval } from "@/features/admin-config-approval";
import { BUYER_TIERS, IP_LIMIT, buyerChangedCount, fromBuyerForm, toBuyerForm, type BuyerTierForm, type LevelForm } from "../form";

const CRITERION_OPTIONS: { value: BuyerTierCriterion; label: string; hint: string }[] = [
  { value: "total_spent", label: "Tổng tiền đã tiêu", hint: "Đơn thật đã hoàn tất, trừ phần đã hoàn tiền. Khó lách hơn." },
  { value: "total_deposit", label: "Tổng tiền đã nạp", hint: "Tiền nạp thật qua cổng thanh toán (không tính cộng tay của admin)." },
];

export function BuyerTiersConsole() {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const client = useQueryClient();
  const config = useQuery({ queryKey: ["admin-buyer-tier-config"], queryFn: () => api.adminBuyerTierConfig() });
  const [form, setForm] = React.useState<BuyerTierForm | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  React.useEffect(() => { if (config.data) setForm(toBuyerForm(config.data)); }, [config.data]);
  const approval = useConfigApproval("buyer_tier_config");
  const save = useMutation({
    mutationFn: (value: BuyerTierConfig) => api.updateAdminBuyerTierConfig(value, approval.reasonToSend),
    onSuccess: (value) => {
      const { config: now } = approval.settle(value, "Đã lưu hạng người mua");
      client.setQueryData(["admin-buyer-tier-config"], now);
      setForm(toBuyerForm(now));
      setShowErrors(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Không lưu được")),
  });

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h1 className="text-[18px] font-semibold text-fg">Hạng người mua</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          Ba hạng L1 → L3 theo tổng tiền người mua. Hạng cập nhật lúc 03:00 mỗi ngày hoặc khi chạy tay ở{" "}
          <Link href="/admin/seller-tiers" className="font-medium text-iris-hi hover:underline">Xét hạng</Link>. Hoàn tiền cộng thẳng vào ví khả dụng khi đơn hết thời gian giữ tiền mà không có hoàn tiền.
        </p>
      </div>
      {config.isPending || (!form && !config.isError) ? (
        <div className="grid place-items-center rounded-card border border-line bg-card py-12"><Spinner /></div>
      ) : config.isError || !config.data || !form ? (
        <div className="rounded-card border border-line bg-card px-5 py-10 text-center text-[13px] text-bad">
          {apiErrorMessage(config.error, "Không tải được cấu hình")}
          <Button size="sm" variant="secondary" className="ml-2" onClick={() => void config.refetch()}>Thử lại</Button>
        </div>
      ) : (
        <>
        <PendingChangeNotice request={approval.pending} />
        <Editor
          approval={approval}
          form={form}
          saved={config.data}
          showErrors={showErrors}
          saving={save.isPending}
          onChange={setForm}
          onReset={() => { setForm(toBuyerForm(config.data)); setShowErrors(false); }}
          onSave={() => {
            const { config: next } = fromBuyerForm(form);
            if (!next) { setShowErrors(true); return; }
            save.mutate(next);
          }}
        />
        </>
      )}
    </div>
  );
}

function Editor({ approval, form, saved, showErrors, saving, onChange, onReset, onSave }: {
  approval: ReturnType<typeof useConfigApproval>;
  form: BuyerTierForm; saved: BuyerTierConfig; showErrors: boolean; saving: boolean;
  onChange: (next: BuyerTierForm) => void; onReset: () => void; onSave: () => void;
}) {
  const ta = useTranslations("adminConfigApproval");
  const askReason = approval.required && !approval.pending;
  const { config: next, errors } = fromBuyerForm(form);
  const shown = showErrors ? errors : {};
  const changes = buyerChangedCount(form, saved);
  const setLevel = (tier: (typeof BUYER_TIERS)[number], key: keyof LevelForm, value: string) =>
    onChange({ ...form, levels: { ...form.levels, [tier]: { ...form.levels[tier], [key]: value } } });

  return (
    <section className="rounded-card border border-line bg-card shadow-card">
      <div className="grid gap-4 border-b border-line px-5 py-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div>
          <h2 className="text-[13.5px] font-semibold text-fg">Điều kiện xét hạng</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">Con số so với ngưỡng của từng hạng. Đổi tiêu chí thì lần xét kế tiếp xếp lại mọi người mua.</p>
        </div>
        <div role="radiogroup" aria-label="Điều kiện xét hạng" className="grid gap-2 sm:grid-cols-2">
          {CRITERION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={form.criterion === option.value}
              onClick={() => onChange({ ...form, criterion: option.value })}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                form.criterion === option.value ? "border-iris bg-iris-soft/60" : "border-line bg-surface hover:border-line-2",
              )}
            >
              <span className="block text-[13px] font-semibold text-fg">{option.label}</span>
              <span className="mt-1 block text-[11.5px] leading-snug text-muted">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-b border-line px-5 py-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div>
          <h2 className="text-[13.5px] font-semibold text-fg">Chống flood API theo IP</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Số request tối đa mỗi phút từ một địa chỉ IP vào API công khai (/v1), áp dụng cho mọi hạng và kiểm tra trước cả API key. Vượt mức trả 429 kèm Retry-After.
          </p>
        </div>
        <div className="max-w-[280px]">
          <LabeledInput
            label="Request mỗi IP / phút"
            value={form.ip_requests_per_minute}
            error={shown["ip_requests_per_minute"]}
            onChange={(v) => onChange({ ...form, ip_requests_per_minute: v.replace(/\D/g, "") })}
            numeric
          />
          <p className="mt-1 text-[11.5px] text-faint">
            Từ {IP_LIMIT.min.toLocaleString("vi-VN")} đến {IP_LIMIT.max.toLocaleString("vi-VN")} · mặc định {IP_LIMIT.default.toLocaleString("vi-VN")}
          </p>
        </div>
      </div>

      <div className="px-5 py-5">
        <h2 className="text-[13.5px] font-semibold text-fg">Các hạng</h2>
        <p className="mt-1 text-[12px] text-muted">
          Để trống giới hạn API = không giới hạn theo key (vẫn áp giới hạn {(Number(saved.ip_requests_per_minute) || IP_LIMIT.default).toLocaleString("vi-VN")} request/phút mỗi IP ở trên).
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {BUYER_TIERS.map((tier) => {
            const f = form.levels[tier];
            const err = (key: string) => shown[`${tier}.${key}`];
            return (
              <div key={tier} className="space-y-3 rounded-lg border border-line bg-surface p-3.5">
                <p className="font-mono text-[12px] font-semibold uppercase text-muted">{tier}</p>
                <div className="grid grid-cols-2 gap-2">
                  <LabeledInput label="Tên (vi)" value={f.name_vi} error={err("name_vi")} onChange={(v) => setLevel(tier, "name_vi", v)} />
                  <LabeledInput label="Tên (en)" value={f.name_en} error={err("name_en")} onChange={(v) => setLevel(tier, "name_en", v)} />
                </div>
                <label className="block">
                  <span className="text-[12px] font-medium text-muted">Ngưỡng ({form.criterion === "total_spent" ? "tổng tiêu" : "tổng nạp"})</span>
                  <span className="mt-1 block">
                    {tier === "l1" ? (
                      <span className="block rounded-lg border border-line bg-raised/40 px-3 py-2 font-mono text-[13px] text-muted">{vnd(0)} (mặc định)</span>
                    ) : (
                      <MoneyInput value={f.min_amount} onValueChange={(v) => setLevel(tier, "min_amount", v)} invalid={!!err("min_amount")} />
                    )}
                  </span>
                  {err("min_amount") && <span className="mt-1 block text-[11.5px] text-bad">{err("min_amount")}</span>}
                </label>
                <LabeledInput label="Hoàn tiền mỗi đơn" unit="%" value={f.cashback_percent} error={err("cashback_percent")} onChange={(v) => setLevel(tier, "cashback_percent", v)} numeric />
                <div className="grid grid-cols-2 gap-2">
                  <LabeledInput label="API request/phút" value={f.api_requests_per_minute} placeholder="Không giới hạn" error={err("api_requests_per_minute")} onChange={(v) => setLevel(tier, "api_requests_per_minute", v)} numeric />
                  <LabeledInput label="Đặt đơn API/phút" value={f.api_orders_per_minute} placeholder="Không giới hạn" error={err("api_orders_per_minute")} onChange={(v) => setLevel(tier, "api_orders_per_minute", v)} numeric />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {changes > 0 && (
        <div className="sticky bottom-3 z-10 mx-3 mb-3 flex flex-wrap items-center gap-3 rounded-card border border-warn/40 bg-card px-4 py-3 shadow-card">
          <span className="text-[13px] font-medium text-fg">{changes} thay đổi chưa lưu</span>
          {!next && <span className="text-[12px] text-bad">Còn {Object.keys(errors).length} ô chưa hợp lệ</span>}
          {approval.required && approval.pending && <span className="text-[12px] text-bad">{ta("blocked")}</span>}
          {askReason && (
            <label className="flex w-full flex-col gap-1 sm:w-auto sm:min-w-[280px] sm:flex-1">
              <span className="text-[12px] font-medium text-fg">{ta("reasonInput")}</span>
              <Input
                value={approval.reason}
                maxLength={1000}
                onChange={(e) => approval.setReason(e.target.value)}
                placeholder={ta("reasonPlaceholder")}
                aria-invalid={!reasonOk(approval.reason)}
                className="h-9 text-[13px]"
              />
              <span className="text-[11.5px] text-muted">{ta("reasonHint")}</span>
            </label>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" disabled={saving} onClick={onReset}>Hoàn tác</Button>
            <Button
              size="sm"
              loading={saving}
              disabled={approval.required && (approval.pending !== null || !reasonOk(approval.reason))}
              onClick={onSave}
            >
              {askReason ? ta("submit") : "Lưu thay đổi"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function LabeledInput({ label, value, onChange, error, placeholder, unit, numeric }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string; unit?: string; numeric?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <span className="relative mt-1 block">
        <Input
          value={value}
          inputMode={numeric ? "decimal" : undefined}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(numeric ? e.target.value.replace(/[^\d.,]/g, "") : e.target.value)}
          className={cn("h-9 text-[12.5px]", numeric && "text-right font-mono tabular-nums placeholder:font-sans", unit && "pr-8", error && "border-bad")}
        />
        {unit && <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{unit}</span>}
      </span>
      {error && <span className="mt-1 block text-[11.5px] text-bad">{error}</span>}
    </label>
  );
}
