"use client";

/** Admin › Xét hạng: sellers who qualify for the next tier or slipped below
 *  their own, approved by hand, and the trust-score / criteria settings.
 *  No job moves tiers; every change here is an admin decision. */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { SellerTierName, SellerTierReviewRow, SellerTrustConfig, TrustCriterion } from "@/lib/types";
import { Button, Input, Spinner, Tag, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/MoneyInput";
import { useToast } from "@/components/toast";
import { ArrowDown, ArrowUp } from "@/components/Icons";
import { CRITERIA, CRITERION_SHORT, TIER_NAME, TIER_ORDER, TIER_REASON_MAX, formatCriterion } from "../model";
import { EDIT_TIERS, changedCount, fromForm, scorePoints, toForm, type TrustForm, type TrustFormErrors } from "../form";

export function SellerTiersConsole() {
  return (
    <div className="space-y-6 pb-20">
      <div>
        <h1 className="text-[18px] font-semibold text-fg">Xét hạng người bán</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          Hệ thống chỉ tính điểm và điều kiện; lên hay hạ hạng đều do admin duyệt ở đây. Hạng Doanh nghiệp chỉ admin mời.
        </p>
      </div>
      <ReviewQueue />
      <TrustConfigEditor />
    </div>
  );
}

/* ---------------------------------------------------------------- Hàng chờ */

type Move = { row: SellerTierReviewRow; to: SellerTierName };
type QueueFilter = "all" | "up" | "down";

function defaultReason(row: SellerTierReviewRow, to: SellerTierName): string {
  if (TIER_ORDER.indexOf(to) > TIER_ORDER.indexOf(row.tier)) return `Đủ điều kiện lên ${TIER_NAME[to]} (duyệt từ hàng chờ xét hạng)`;
  return `Dưới mức giữ hạng: ${row.at_risk.map((c) => CRITERION_SHORT[c.key]).join(", ")} (duyệt từ hàng chờ xét hạng)`;
}

/** "Khiếu nại 18,2% · cần ≤ 3%" — the figure and the bar it misses, in words. */
function criterionMiss(c: TrustCriterion): string {
  const def = CRITERIA.find((x) => x.key === c.key);
  return `${def?.label ?? c.key}: ${formatCriterion(c.key, c.value, vnd)} · cần ${def?.op ?? ""} ${formatCriterion(c.key, c.target, vnd)}`;
}

function ReviewQueue() {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const client = useQueryClient();
  const queue = useQuery({ queryKey: ["admin-seller-tier-review"], queryFn: () => api.adminSellerTierReview() });
  const [filter, setFilter] = React.useState<QueueFilter>("all");
  const [pending, setPending] = React.useState<Move | null>(null);
  const move = useMutation({
    mutationFn: ({ row, to, reason }: Move & { reason: string }) => api.adminUpdateSellerTier(row.account_id, to, reason),
    onSuccess: (_v, { row, to }) => {
      toast.success(`${row.name}: ${TIER_NAME[row.tier]} → ${TIER_NAME[to]}`);
      setPending(null);
      void client.invalidateQueries({ queryKey: ["admin-seller-tier-review"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Không đổi được hạng")),
  });

  const rows = queue.data ?? [];
  const up = rows.filter((r) => r.eligible && r.next_tier);
  const down = rows.filter((r) => r.at_risk.length > 0 && r.tier !== "new");
  const shown = filter === "up" ? up : filter === "down" ? down : rows.filter((r) => (r.eligible && r.next_tier) || (r.at_risk.length > 0 && r.tier !== "new"));
  const chips: [QueueFilter, string, number][] = [["all", "Cần xem xét", new Set([...up, ...down]).size], ["up", "Đủ điều kiện lên hạng", up.length], ["down", "Dưới mức giữ hạng", down.length]];

  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Lọc hàng chờ">
          {chips.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn("rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors", filter === key ? "border-iris bg-iris-soft text-iris-hi" : "border-line text-muted hover:text-fg")}
            >
              {label} <span className="ml-0.5 font-mono tabular-nums">{n}</span>
            </button>
          ))}
        </div>
        <span className="text-[12px] text-faint">{rows.length} người bán được chấm điểm</span>
      </header>

      {queue.isPending ? (
        <div className="grid place-items-center py-12"><Spinner /></div>
      ) : queue.isError ? (
        <div className="px-5 py-10 text-center text-[13px] text-bad">
          {apiErrorMessage(queue.error, "Không tải được danh sách")}
          <Button size="sm" variant="secondary" className="ml-2" onClick={() => void queue.refetch()}>Thử lại</Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="px-5 py-12 text-center text-[13px] text-muted">
          {filter === "up" ? "Chưa có người bán nào đủ điều kiện lên hạng." : filter === "down" ? "Không có người bán nào dưới mức giữ hạng." : "Không có người bán nào cần xem xét lúc này."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((row) => {
            const lower = TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(row.tier) - 1)];
            const canUp = row.eligible && row.next_tier;
            const canDown = row.at_risk.length > 0 && row.tier !== "new";
            return (
              <li key={row.account_id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto] md:items-center">
                <div className="min-w-0">
                  <Link href={`/admin/accounts/${row.account_id}?tab=seller`} className="block truncate text-[13.5px] font-semibold text-fg hover:text-iris-hi hover:underline">{row.name}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                    <Tag tone="neutral">{TIER_NAME[row.tier]}</Tag>
                    <span>Điểm <b className="font-mono tabular-nums text-fg">{row.score ?? "—"}</b></span>
                    <span className="text-faint">·</span>
                    <span className="font-mono tabular-nums">{row.orders_lifetime.toLocaleString("vi-VN")} đơn</span>
                    <span className="text-faint">·</span>
                    <span className="font-mono tabular-nums">{vnd(row.gmv_lifetime)}</span>
                  </div>
                </div>
                <div className="min-w-0 space-y-1.5">
                  {canUp && (
                    <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-good"><ArrowUp size={14} />Đạt đủ {row.met} điều kiện lên {TIER_NAME[row.next_tier!]}</p>
                  )}
                  {canDown && (
                    <div className="space-y-1">
                      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-warn"><ArrowDown size={14} />Dưới mức giữ hạng {TIER_NAME[row.tier]}</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {row.at_risk.map((c) => (
                          <li key={c.key} className="rounded-md border border-warn/30 bg-warn-soft/50 px-2 py-0.5 text-[12px] text-fg">{criterionMiss(c)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 md:justify-end">
                  {canDown && <Button size="sm" variant="secondary" onClick={() => setPending({ row, to: lower })}>Hạ xuống {TIER_NAME[lower]}</Button>}
                  {canUp && <Button size="sm" onClick={() => setPending({ row, to: row.next_tier! })}>Lên {TIER_NAME[row.next_tier!]}</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <MoveDialog move={pending} busy={move.isPending} onClose={() => setPending(null)} onConfirm={(reason) => pending && move.mutate({ ...pending, reason })} />
    </section>
  );
}

function MoveDialog({ move, busy, onClose, onConfirm }: { move: Move | null; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = React.useState("");
  React.useEffect(() => { if (move) setReason(defaultReason(move.row, move.to)); }, [move]);
  const upward = move ? TIER_ORDER.indexOf(move.to) > TIER_ORDER.indexOf(move.row.tier) : false;
  const valid = reason.trim().length > 0 && reason.length <= TIER_REASON_MAX;
  return (
    <Dialog open={move !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[16px] text-fg">{upward ? "Nâng hạng" : "Hạ hạng"} {move?.row.name}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">
            {move && <><b className="text-fg">{TIER_NAME[move.row.tier]}</b> → <b className="text-fg">{TIER_NAME[move.to]}</b>. </>}
            Quyền lợi đổi ngay; người bán nhận thông báo.
          </DialogDescription>
        </DialogHeader>
        <label className="block">
          <span className="text-[12.5px] font-medium text-muted">Lý do (lưu vào lịch sử hạng)</span>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={TIER_REASON_MAX} className="mt-1.5 min-h-[72px] text-[12.5px]" />
          <span className="mt-1 block text-right font-mono text-[11px] text-faint">{reason.length}/{TIER_REASON_MAX}</span>
        </label>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button>
          <Button variant={upward ? "primary" : "danger"} disabled={!valid} loading={busy} onClick={() => onConfirm(reason.trim())}>{upward ? "Nâng hạng" : "Hạ hạng"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Cấu hình */

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-[12.5px] font-medium text-fg">{label}</span>
      {hint && <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
      {error && <span className="mt-1 block text-[11.5px] text-bad">{error}</span>}
    </label>
  );
}

/** Number input with its unit pinned on the right, like MoneyInput's ₫. */
function UnitInput({ value, onChange, unit, invalid, placeholder, label, compact }: {
  value: string; onChange: (v: string) => void; unit: string; invalid?: boolean; placeholder?: string; label?: string; compact?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        className={cn("pr-12 text-right font-mono tabular-nums placeholder:font-sans placeholder:text-left", compact ? "h-9" : "h-10", invalid && "border-bad focus:border-bad")}
      />
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{unit}</span>
    </div>
  );
}

function SettingsRow({ title, hint, children, aside }: { title: string; hint: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid gap-4 border-t border-line px-5 py-5 first:border-t-0 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">{hint}</p>
        {aside}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const PART_TONE = { dispute: "bg-iris", one_star: "bg-warn", gmv: "bg-good" } as const;

function TrustConfigEditor() {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const client = useQueryClient();
  const config = useQuery({ queryKey: ["admin-seller-trust-config"], queryFn: () => api.adminSellerTrustConfig() });
  const [form, setForm] = React.useState<TrustForm | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  React.useEffect(() => { if (config.data) setForm(toForm(config.data)); }, [config.data]);
  const save = useMutation({
    mutationFn: (value: SellerTrustConfig) => api.updateAdminSellerTrustConfig(value),
    onSuccess: (value) => {
      client.setQueryData(["admin-seller-trust-config"], value);
      void client.invalidateQueries({ queryKey: ["admin-seller-tier-review"] });
      setShowErrors(false);
      toast.success("Đã lưu công thức điểm & điều kiện");
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Không lưu được")),
  });

  if (config.isPending) return <div className="grid place-items-center rounded-card border border-line bg-card py-12"><Spinner /></div>;
  if (config.isError || !config.data || !form) {
    return (
      <div className="rounded-card border border-line bg-card px-5 py-10 text-center text-[13px] text-bad">
        {apiErrorMessage(config.error, "Không tải được cấu hình")}
        <Button size="sm" variant="secondary" className="ml-2" onClick={() => void config.refetch()}>Thử lại</Button>
      </div>
    );
  }

  const saved = config.data;
  const { config: next, errors } = fromForm(form);
  const shownErrors: TrustFormErrors = showErrors ? errors : {};
  const changes = changedCount(form, saved);
  const points = scorePoints(form);
  const set = (patch: Partial<TrustForm>) => setForm((cur) => (cur ? { ...cur, ...patch } : cur));
  const setCriterion = (tier: (typeof EDIT_TIERS)[number], key: string, value: string) =>
    setForm((cur) => (cur ? { ...cur, criteria: { ...cur.criteria, [tier]: { ...cur.criteria[tier], [key]: value } } } : cur));
  const onSave = () => {
    if (!next) { setShowErrors(true); return; }
    save.mutate(next);
  };

  const parts = [
    { key: "dispute" as const, label: "Khiếu nại", points: form.dispute_points, limit: form.dispute_zero_at_pct },
    { key: "one_star" as const, label: "Đánh giá 1 sao", points: form.one_star_points, limit: form.one_star_zero_at_pct },
  ];

  return (
    <section className="rounded-card border border-line bg-card shadow-card">
      <header className="border-b border-line px-5 py-3">
        <h2 className="text-[14px] font-semibold text-fg">Công thức điểm & điều kiện</h2>
        <p className="mt-0.5 text-[12px] text-muted">Mỗi lần lưu ghi nhật ký cũ → mới. Chỉ tính đơn thật, bỏ đơn demo.</p>
      </header>

      <SettingsRow title="Kỳ tính điểm" hint="Tỉ lệ khiếu nại, tỉ lệ 1 sao và doanh số trong kỳ đều tính trên số ngày gần nhất này.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Độ dài kỳ" hint="7–365 ngày" error={shownErrors.window_days}>
            <UnitInput value={form.window_days} onChange={(v) => set({ window_days: v })} unit="ngày" invalid={!!shownErrors.window_days} />
          </Field>
          <Field label="Số đơn hoàn tất tối thiểu để có điểm" hint="Ít hơn thì hiện “Chưa đủ dữ liệu”" error={shownErrors.min_orders_for_score}>
            <UnitInput value={form.min_orders_for_score} onChange={(v) => set({ min_orders_for_score: v })} unit="đơn" invalid={!!shownErrors.min_orders_for_score} />
          </Field>
        </div>
      </SettingsRow>

      <SettingsRow
        title="Điểm uy tín"
        hint="Ba phần cộng lại thành 100 điểm. Khiếu nại và 1 sao trừ dần về 0; doanh số tăng dần theo thang log tới mức đủ điểm."
        aside={
          <div className="mt-3">
            <div className="flex h-2 overflow-hidden rounded-full bg-raised" aria-hidden>
              {(["dispute", "one_star", "gmv"] as const).map((k) => {
                const v = Number(form[`${k}_points` as keyof TrustForm]) || 0;
                return <span key={k} className={PART_TONE[k]} style={{ width: `${Math.min(100, v)}%` }} />;
              })}
            </div>
            <p className={cn("mt-1.5 text-[12px] font-medium", points === 100 ? "text-muted" : "text-bad")}>
              Tổng <span className="font-mono tabular-nums">{points}</span> / 100{points !== 100 && ` — ${points < 100 ? "thiếu" : "thừa"} ${Math.abs(100 - points)} điểm`}
            </p>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          {parts.map((p) => (
            <div key={p.key} className="space-y-3 rounded-lg border border-line bg-surface p-3.5">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-fg"><span className={cn("h-2.5 w-2.5 rounded-full", PART_TONE[p.key])} />{p.label}</p>
              <Field label="Điểm tối đa" error={shownErrors[`${p.key}_points`]}>
                <UnitInput value={p.points} onChange={(v) => set({ [`${p.key}_points`]: v } as Partial<TrustForm>)} unit="điểm" invalid={!!shownErrors[`${p.key}_points`]} />
              </Field>
              <Field label="Về 0 điểm khi tỉ lệ từ" hint="0,1–100%" error={shownErrors[`${p.key}_zero_at_pct`]}>
                <UnitInput value={p.limit} onChange={(v) => set({ [`${p.key}_zero_at_pct`]: v } as Partial<TrustForm>)} unit="%" invalid={!!shownErrors[`${p.key}_zero_at_pct`]} />
              </Field>
            </div>
          ))}
          <div className="space-y-3 rounded-lg border border-line bg-surface p-3.5">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-fg"><span className={cn("h-2.5 w-2.5 rounded-full", PART_TONE.gmv)} />Doanh số trong kỳ</p>
            <Field label="Điểm tối đa" error={shownErrors.gmv_points}>
              <UnitInput value={form.gmv_points} onChange={(v) => set({ gmv_points: v })} unit="điểm" invalid={!!shownErrors.gmv_points} />
            </Field>
            <Field label="Đủ điểm khi doanh số đạt" error={shownErrors.gmv_full_at}>
              <MoneyInput value={form.gmv_full_at} onValueChange={(v) => set({ gmv_full_at: v })} invalid={!!shownErrors.gmv_full_at} />
            </Field>
          </div>
        </div>
        {shownErrors.points && <p className="mt-2 text-[12px] text-bad">{shownErrors.points}</p>}
      </SettingsRow>

      <SettingsRow
        title="Điều kiện theo hạng"
        hint="Để trống = không xét điều kiện đó. Điều kiện có nhãn “giữ hạng” còn dùng để cảnh báo người bán tụt dưới mức của hạng đang giữ."
      >
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[680px] text-[12.5px]">
            <thead className="bg-raised/40 text-left text-[12px] text-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Điều kiện</th>
                {EDIT_TIERS.map((tier) => (
                  <th key={tier} className="w-[22%] px-3 py-2.5 font-medium">
                    {TIER_NAME[tier]}
                    {tier === "enterprise" && <span className="block text-[11px] font-normal text-faint">chỉ admin mời · dùng để giữ hạng</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {CRITERIA.map((c) => (
                <tr key={c.key} className="align-middle">
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-fg">{c.label}</span> <span className="font-mono text-muted">{c.op}</span>
                    {c.keep && <span className="ml-1.5 rounded bg-raised px-1.5 py-0.5 text-[10.5px] text-muted">giữ hạng</span>}
                  </td>
                  {EDIT_TIERS.map((tier) => {
                    const path = `criteria.${tier}.${c.key}`;
                    const label = `${c.label} ${c.op} — ${TIER_NAME[tier]}`;
                    return (
                      <td key={tier} className="px-3 py-2">
                        {c.unit === "₫" ? (
                          <MoneyInput value={form.criteria[tier][c.key]} onValueChange={(v) => setCriterion(tier, c.key, v)} placeholder="Không xét" invalid={!!shownErrors[path]} />
                        ) : (
                          <UnitInput value={form.criteria[tier][c.key]} onChange={(v) => setCriterion(tier, c.key, v)} unit={c.unit} placeholder="Không xét" label={label} invalid={!!shownErrors[path]} compact />
                        )}
                        {shownErrors[path] && <span className="mt-1 block text-[11px] text-bad">{shownErrors[path]}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsRow>

      {changes > 0 && (
        <div className="sticky bottom-3 z-10 mx-3 mb-3 flex flex-wrap items-center gap-3 rounded-card border border-warn/40 bg-card px-4 py-3 shadow-card">
          <span className="text-[13px] font-medium text-fg">{changes} thay đổi chưa lưu</span>
          {!next && <span className="text-[12px] text-bad">{errors.points ?? `Còn ${Object.keys(errors).length} ô chưa hợp lệ`}</span>}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => { setForm(toForm(saved)); setShowErrors(false); }}>Hoàn tác</Button>
            <Button size="sm" loading={save.isPending} onClick={onSave}>Lưu thay đổi</Button>
          </div>
        </div>
      )}
    </section>
  );
}
