"use client";

/** Tier review: which sellers meet the next tier's criteria (or slipped below
 *  their own), approved by hand, and the trust-score / criteria settings.
 *  No job moves tiers; every change here is an admin decision. */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { vnd } from "@/lib/utils/format";
import type { SellerTierName, SellerTierReviewRow, SellerTrustConfig, TrustCriterionKey } from "@/lib/types";
import { Button, Card, Input, Spinner, Tag } from "@/components/ui";
import { ConfirmModal } from "@/components/admin";
import { TIER_LABEL } from "@/features/admin-analytics/model";
import { CRITERIA, CRITERION_SHORT, TIER_ORDER } from "@/features/admin-seller-tiers";

export default function AdminSellerTiersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[18px] font-semibold text-slate-900">Xét hạng người bán</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          Hệ thống chỉ tính điểm và điều kiện; lên hay hạ hạng đều do admin duyệt ở đây. Hạng Doanh nghiệp chỉ admin mời.
        </p>
      </div>
      <ReviewQueue />
      <TrustConfigEditor />
    </div>
  );
}

/** What the tier history records for a change approved from this queue. */
function queueReason(row: SellerTierReviewRow, to: SellerTierName): string {
  if (TIER_ORDER.indexOf(to) > TIER_ORDER.indexOf(row.tier)) return `Đủ điều kiện lên ${TIER_LABEL[to]} (duyệt từ hàng chờ xét hạng)`;
  return `Dưới mức giữ hạng: ${row.at_risk.map((c) => CRITERION_SHORT[c.key]).join(", ")} (duyệt từ hàng chờ xét hạng)`;
}

function ReviewQueue() {
  const apiErrorMessage = useApiErrorMessage();
  const client = useQueryClient();
  const queue = useQuery({ queryKey: ["admin-seller-tier-review"], queryFn: () => api.adminSellerTierReview() });
  const [pending, setPending] = React.useState<{ row: SellerTierReviewRow; to: SellerTierName } | null>(null);
  const move = useMutation({
    mutationFn: ({ row, to }: { row: SellerTierReviewRow; to: SellerTierName }) =>
      api.adminUpdateSellerTier(row.account_id, to, queueReason(row, to)),
    onSuccess: () => { setPending(null); client.invalidateQueries({ queryKey: ["admin-seller-tier-review"] }); },
  });
  const rows = queue.data ?? [];
  const shown = rows.filter((r) => r.eligible || r.at_risk.length > 0);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <h2 className="text-[14px] font-semibold text-slate-800">Cần xem xét</h2>
        <span className="text-[12px] text-slate-500">{shown.length} / {rows.length} người bán</span>
      </div>
      {move.isError && <p className="px-5 pt-3 text-[13px] text-red-600">{apiErrorMessage(move.error, "Không đổi được hạng")}</p>}
      {queue.isPending ? (
        <div className="grid place-items-center py-12"><Spinner /></div>
      ) : queue.isError ? (
        <p className="p-5 text-[13px] text-red-600">{apiErrorMessage(queue.error, "Không tải được danh sách")}</p>
      ) : shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px] text-slate-500">Chưa có người bán nào đủ điều kiện lên hạng hay dưới mức giữ hạng.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-5 py-2.5 font-medium">Người bán</th>
                <th className="px-5 py-2.5 font-medium">Hạng</th>
                <th className="px-5 py-2.5 text-right font-medium">Điểm</th>
                <th className="px-5 py-2.5 font-medium">Tình trạng</th>
                <th className="w-48 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const down = TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(row.tier) - 1)];
                return (
                  <tr key={row.account_id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-700">{row.name}</div>
                      <div className="text-[12px] text-slate-400">{row.orders_lifetime} đơn · {vnd(row.gmv_lifetime)}</div>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{TIER_LABEL[row.tier]}</td>
                    <td className="px-5 py-3 text-right font-mono">{row.score ?? "—"}</td>
                    <td className="px-5 py-3">
                      {row.eligible && <Tag tone="good" className="whitespace-nowrap">Đủ điều kiện lên {TIER_LABEL[row.next_tier ?? ""]}</Tag>}
                      {row.at_risk.length > 0 && (
                        <div className="mt-1">
                          <Tag tone="warn" className="whitespace-nowrap">Dưới mức giữ hạng</Tag>
                          <span className="ml-1.5 text-[12px] text-slate-500">{row.at_risk.map((c) => `${CRITERION_SHORT[c.key]} ${c.value ?? "—"}/${c.target}`).join(" · ")}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {row.eligible && row.next_tier && (
                          <Button size="sm" onClick={() => setPending({ row, to: row.next_tier! })}>Lên {TIER_LABEL[row.next_tier]}</Button>
                        )}
                        {row.at_risk.length > 0 && row.tier !== "new" && (
                          <Button size="sm" variant="secondary" onClick={() => setPending({ row, to: down })}>Hạ {TIER_LABEL[down]}</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmModal
        isOpen={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => pending && move.mutate(pending)}
        title="Đổi hạng người bán"
        description={pending ? `${pending.row.name}: ${TIER_LABEL[pending.row.tier]} → ${TIER_LABEL[pending.to]}. Người bán nhận thông báo; quyền lợi đổi ngay.` : ""}
        confirmText="Xác nhận"
        isLoading={move.isPending}
      />
    </Card>
  );
}

function TrustConfigEditor() {
  const apiErrorMessage = useApiErrorMessage();
  const client = useQueryClient();
  const config = useQuery({ queryKey: ["admin-seller-trust-config"], queryFn: () => api.adminSellerTrustConfig() });
  const [draft, setDraft] = React.useState<SellerTrustConfig | null>(null);
  React.useEffect(() => { if (config.data) setDraft(structuredClone(config.data)); }, [config.data]);
  const save = useMutation({
    mutationFn: (value: SellerTrustConfig) => api.updateAdminSellerTrustConfig(value),
    onSuccess: (value) => {
      client.setQueryData(["admin-seller-trust-config"], value);
      client.invalidateQueries({ queryKey: ["admin-seller-tier-review"] });
    },
  });
  if (!draft) return config.isError ? <p className="text-[13px] text-red-600">{apiErrorMessage(config.error, "Không tải được cấu hình")}</p> : null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(config.data);
  const points = draft.score.dispute.points + draft.score.one_star.points + draft.score.gmv.points;
  const num = (value: string) => (value === "" ? null : Number(value));
  const set = (fn: (d: SellerTrustConfig) => void) => setDraft((current) => {
    if (!current) return current;
    const next = structuredClone(current);
    fn(next);
    return next;
  });

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-[14px] font-semibold text-slate-800">Công thức điểm & điều kiện</h2>
        <p className="mt-0.5 text-[12px] text-slate-500">Mỗi lần lưu ghi nhật ký cũ → mới. Chỉ tính đơn thật, bỏ đơn demo.</p>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <label className="block text-[12.5px] text-slate-600">
          Cửa sổ tính tỉ lệ và điểm (ngày)
          <Input type="number" min={7} max={365} value={draft.window_days} onChange={(e) => set((d) => { d.window_days = Number(e.target.value); })} className="mt-1" />
        </label>
        <label className="block text-[12.5px] text-slate-600">
          Số đơn hoàn tất tối thiểu để có điểm
          <Input type="number" min={0} value={draft.min_orders_for_score} onChange={(e) => set((d) => { d.min_orders_for_score = Number(e.target.value); })} className="mt-1" />
        </label>
      </div>

      <div className="border-t border-slate-200 px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-slate-700">Điểm uy tín</h3>
          <span className={points === 100 ? "text-[12px] text-slate-500" : "text-[12px] text-red-600"}>Tổng {points} / 100</span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {(["dispute", "one_star"] as const).map((part) => (
            <div key={part} className="rounded-lg border border-slate-200 p-3 text-[12.5px] text-slate-600">
              <p className="font-medium text-slate-700">{part === "dispute" ? "Khiếu nại" : "Đánh giá 1 sao"}</p>
              <label className="mt-2 block">Điểm tối đa
                <Input type="number" min={0} max={100} value={draft.score[part].points} onChange={(e) => set((d) => { d.score[part].points = Number(e.target.value); })} className="mt-1" />
              </label>
              <label className="mt-2 block">Về 0 điểm khi tỉ lệ từ (%)
                <Input type="number" min={0.1} max={100} step={0.1} value={draft.score[part].zero_at_pct} onChange={(e) => set((d) => { d.score[part].zero_at_pct = Number(e.target.value); })} className="mt-1" />
              </label>
            </div>
          ))}
          <div className="rounded-lg border border-slate-200 p-3 text-[12.5px] text-slate-600">
            <p className="font-medium text-slate-700">Doanh số trong cửa sổ</p>
            <label className="mt-2 block">Điểm tối đa
              <Input type="number" min={0} max={100} value={draft.score.gmv.points} onChange={(e) => set((d) => { d.score.gmv.points = Number(e.target.value); })} className="mt-1" />
            </label>
            <label className="mt-2 block">Đủ điểm khi đạt (₫, thang log)
              <Input type="number" min={1} value={draft.score.gmv.full_at} onChange={(e) => set((d) => { d.score.gmv.full_at = Number(e.target.value); })} className="mt-1" />
            </label>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 px-5 py-4">
        <h3 className="text-[13px] font-semibold text-slate-700">Điều kiện theo hạng</h3>
        <p className="mt-0.5 text-[12px] text-slate-500">Để trống = không xét điều kiện đó. Dòng “giữ hạng” còn dùng để báo người bán dưới mức của hạng đang giữ.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2 pr-3 font-medium">Điều kiện</th>
                {(["verified", "trusted", "enterprise"] as const).map((tier) => <th key={tier} className="px-2 py-2 font-medium">{TIER_LABEL[tier]}</th>)}
              </tr>
            </thead>
            <tbody>
              {CRITERIA.map((c) => (
                <tr key={c.key} className="border-t border-slate-100">
                  <td className="py-2 pr-3 text-slate-600">
                    {c.label} {c.op} <span className="text-slate-400">({c.unit})</span>
                    {c.keep && <span className="ml-1 rounded bg-slate-100 px-1 text-[11px] text-slate-500">giữ hạng</span>}
                  </td>
                  {(["verified", "trusted", "enterprise"] as const).map((tier) => (
                    <td key={tier} className="px-2 py-1.5">
                      <Input
                        type="number" min={0} step={c.unit === "%" ? 0.1 : 1}
                        value={draft.criteria[tier][c.key] ?? ""}
                        onChange={(e) => set((d) => { d.criteria[tier][c.key] = num(e.target.value); })}
                        className="h-8 w-32"
                        aria-label={`${c.label} ${c.op} — ${TIER_LABEL[tier]}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
        {save.isError && <span className="mr-auto text-[12.5px] text-red-600">{apiErrorMessage(save.error, "Không lưu được")}</span>}
        {save.isSuccess && !dirty && <span className="mr-auto text-[12.5px] text-green-700">Đã lưu</span>}
        <Button size="sm" variant="ghost" disabled={!dirty || save.isPending} onClick={() => config.data && setDraft(structuredClone(config.data))}>Hoàn tác</Button>
        <Button size="sm" disabled={!dirty || points !== 100} loading={save.isPending} onClick={() => save.mutate(draft)}>Lưu thay đổi</Button>
      </div>
    </Card>
  );
}
