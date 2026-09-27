"use client";

/** Account › "Hạng & uy tín": the seller's score and criteria as computed now,
 *  the manual tier change (with a reason for the history), and past changes. */

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AccountAdminRow, SellerTierDetail, SellerTierName, SellerTierRule, TrustCriterion, TrustScorePart } from "@/lib/types";
import { Button, Input, Spinner, Tag } from "@/components/ui";
import { useToast } from "@/components/toast";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, RefreshCw, X } from "@/components/Icons";
import {
  CRITERIA, formatCriterion, missingShort, SCORE_PART_LABEL, TIER_NAME, TIER_ORDER, TIER_REASON_MAX, tierChangeReady,
} from "@/features/admin-seller-tiers";

type MetricRow = {
  key: string;
  label: string;
  detail?: string;
  value: string;
  target: string;
  met: boolean | null | undefined;
  part?: TrustScorePart;
  /** False when the value is words ("Chưa đủ dữ liệu"), not a figure. */
  numeric?: boolean;
};

function metricRows(detail: SellerTierDetail): MetricRow[] {
  const m = detail.metrics;
  const byKey = new Map<string, TrustCriterion>(detail.criteria.map((row) => [row.key, row]));
  const fallback: Record<string, number | null> = {
    min_gmv: m.gmv_lifetime, min_orders: m.orders_lifetime, min_days: m.days_selling,
    max_dispute_pct: m.orders_window ? (100 * m.disputes_window) / m.orders_window : 0,
    max_one_star_pct: m.reviews_window ? (100 * m.one_star_window) / m.reviews_window : 0,
    min_score: detail.score,
  };
  const detailOf: Record<string, string | undefined> = {
    max_dispute_pct: `${m.disputes_window} / ${m.orders_window} đơn`,
    max_one_star_pct: `${m.one_star_window} / ${m.reviews_window} đánh giá`,
  };
  const partOf: Record<string, TrustScorePart | undefined> = { max_dispute_pct: "dispute", max_one_star_pct: "one_star" };
  const rows: MetricRow[] = CRITERIA.filter((c) => c.key !== "min_score").map((c) => {
    const row = byKey.get(c.key);
    return {
      key: c.key,
      label: c.label,
      detail: detailOf[c.key],
      value: formatCriterion(c.key, row?.value ?? fallback[c.key], vnd),
      target: row ? `${c.op} ${formatCriterion(c.key, row.target, vnd)}` : "—",
      met: row?.met,
      part: partOf[c.key],
    };
  });
  rows.push({ key: "gmv_window", label: `Doanh số ${detail.window_days} ngày`, value: vnd(m.gmv_window), target: "—", met: undefined, part: "gmv" });
  const score = byKey.get("min_score");
  rows.push({
    key: "min_score",
    label: "Điểm uy tín",
    detail: detail.score == null ? `cần ${detail.min_orders_for_score} đơn hoàn tất trong kỳ` : undefined,
    value: detail.score == null ? "Chưa đủ dữ liệu" : String(detail.score),
    numeric: detail.score != null,
    target: score ? `≥ ${score.target}` : "—",
    met: score?.met,
  });
  return rows;
}

function levers(rule: SellerTierRule | undefined): string | null {
  if (!rule) return null;
  const parts = [
    rule.max_active_products == null ? "SP không giới hạn" : `Tối đa ${rule.max_active_products} SP`,
    rule.withdraw_limit_per_request == null ? "Rút không giới hạn" : `Rút ≤ ${vnd(rule.withdraw_limit_per_request)}/lần`,
  ];
  if (rule.fee_discount_pp > 0) parts.push(`Giảm phí ${rule.fee_discount_pp} điểm %`);
  return parts.join(" · ");
}

export function TierTab({ row, onUpdated }: { row: AccountAdminRow; onUpdated: (updated: AccountAdminRow) => void }) {
  const apiErrorMessage = useApiErrorMessage();
  const detail = useQuery({ queryKey: ["admin-seller-tier-detail", row.id], queryFn: () => api.adminSellerTierDetail(row.id) });

  if (detail.isPending) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (detail.isError) {
    return (
      <div className="rounded-card border border-line bg-card px-4 py-8 text-center">
        <p className="text-[13px] text-bad">{apiErrorMessage(detail.error, "Không tải được hạng của người bán")}</p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => detail.refetch()}>Thử lại</Button>
      </div>
    );
  }
  const data = detail.data;
  const lastChange = data.history[0];
  const missing = missingShort(data.criteria);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="text-[11.5px] text-muted">Hạng</div>
          <div className="mt-1 text-[16px] font-semibold text-fg">{TIER_NAME[data.tier]}</div>
          <div className="mt-0.5 text-[11.5px] text-faint">
            {lastChange ? `Đổi tay · ${formatDateTime(lastChange.created_at, "vi")}` : "Chưa đổi hạng lần nào"}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="text-[11.5px] text-muted">Điểm uy tín</div>
          {data.score == null ? (
            <>
              <div className="mt-1 text-[14px] font-semibold text-fg">Chưa đủ dữ liệu</div>
              <div className="mt-0.5 text-[11.5px] text-faint">{data.metrics.completed_window} / {data.min_orders_for_score} đơn hoàn tất trong {data.window_days} ngày</div>
            </>
          ) : (
            <div className="mt-1 font-mono text-[16px] font-semibold tabular-nums text-fg">
              {data.score}<span className="text-[12px] font-normal text-faint"> / 100</span>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-line bg-surface p-3">
          {data.next_tier ? (
            <>
              <div className="text-[11.5px] text-muted">Lên {TIER_NAME[data.next_tier]}</div>
              {data.next_tier_promotable ? (
                <>
                  <div className="mt-1 font-mono text-[16px] font-semibold tabular-nums text-fg">
                    {data.met}<span className="text-[12px] font-normal text-faint"> / {data.criteria.length} điều kiện</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-faint">{data.eligible ? "Đủ điều kiện" : `Thiếu: ${missing.join(", ")}`}</div>
                </>
              ) : (
                <div className="mt-1 text-[13px] text-fg">Chỉ admin mời</div>
              )}
            </>
          ) : (
            <>
              <div className="text-[11.5px] text-muted">Hạng tiếp theo</div>
              <div className="mt-1 text-[13px] text-fg">Đã ở hạng cao nhất</div>
            </>
          )}
        </div>
      </div>

      {data.at_risk.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-soft/60 px-3 py-2 text-[12.5px] text-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>Dưới mức giữ hạng {TIER_NAME[data.tier]}: {missingShort(data.at_risk).join(", ")}. Hạ hạng hay giữ nguyên là quyết định của admin.</span>
        </div>
      )}

      <MetricsTable data={data} computedAt={detail.dataUpdatedAt} refreshing={detail.isFetching} onRefresh={() => detail.refetch()} />
      <TierChange row={row} detail={data} onUpdated={(updated) => { onUpdated(updated); void detail.refetch(); }} />
      <History data={data} />
    </div>
  );
}

function MetricsTable({ data, computedAt, refreshing, onRefresh }: { data: SellerTierDetail; computedAt: number; refreshing: boolean; onRefresh: () => void }) {
  const rows = metricRows(data);
  const target = data.next_tier ? TIER_NAME[data.next_tier] : null;
  return (
    <section className="rounded-card border border-line bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-raised/40 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-fg">Chỉ số</h3>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={13} className={cn("mr-1.5", refreshing && "animate-spin")} />Tính lại
        </Button>
      </header>
      <div className="hidden grid-cols-[minmax(0,1fr)_128px_128px_64px] gap-3 border-b border-line px-4 py-2 text-[11.5px] font-medium text-muted sm:grid">
        <span>Chỉ số</span>
        <span className="text-right">Giá trị</span>
        <span className="text-right">{target ? `Cần (${target})` : "Cần"}</span>
        <span className="text-right">Điểm</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-line px-4 py-2.5 text-[12.5px] last:border-0 sm:grid-cols-[minmax(0,1fr)_128px_128px_64px] sm:items-center">
            <span className="min-w-0">
              <span className="block text-fg">{r.label}</span>
              {r.detail && <span className="block text-[11.5px] text-faint">{r.detail}</span>}
            </span>
            <span className={cn("text-right", r.numeric !== false && "font-mono tabular-nums", r.met === false ? "text-bad" : "text-fg")}>
              {r.met === true && <CheckCircle2 size={12} className="mr-1 inline text-good" aria-label="Đạt" />}
              {r.met === false && <X size={12} className="mr-1 inline" aria-label="Chưa đạt" />}
              {r.value}
            </span>
            <span className="text-[11.5px] text-muted sm:text-right sm:font-mono sm:text-[12.5px] sm:tabular-nums">
              <span className="sm:hidden">Cần: </span>{r.target}
            </span>
            <span className="text-right text-[11.5px] text-muted sm:font-mono sm:text-[12.5px] sm:tabular-nums">
              {r.part && data.score_parts ? (
                <><span className="sm:hidden">Điểm: </span>{data.score_parts[r.part]} / {data.score_points[r.part]}</>
              ) : r.part ? (
                <><span className="sm:hidden">Điểm: </span>—</>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-faint">
        Tính lúc {formatDateTime(new Date(computedAt).toISOString(), "vi")} · khiếu nại, 1 sao và doanh số kỳ tính trong {data.window_days} ngày
        {data.seeded_orders > 0 ? ` · bỏ ${data.seeded_orders} đơn demo` : ""}
        {data.score_parts && ` · điểm = ${(Object.keys(SCORE_PART_LABEL) as TrustScorePart[]).map((p) => `${SCORE_PART_LABEL[p].toLowerCase()} ${data.score_parts![p]}`).join(" + ")}`}
      </p>
    </section>
  );
}

function TierChange({ row, detail, onUpdated }: { row: AccountAdminRow; detail: SellerTierDetail; onUpdated: (updated: AccountAdminRow) => void }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const tiers = useQuery({ queryKey: ["public-seller-tiers"], queryFn: api.sellerTiers, staleTime: 60_000 });
  const [target, setTarget] = React.useState<SellerTierName>(detail.tier);
  const [reason, setReason] = React.useState("");
  React.useEffect(() => { setTarget(detail.tier); setReason(""); }, [row.id, detail.tier]);
  const save = useMutation({
    mutationFn: () => api.adminUpdateSellerTier(row.id, target, reason.trim()),
    onSuccess: (updated) => { toast.success(`Đã đổi hạng thành ${TIER_NAME[target]}`); onUpdated(updated); },
    onError: (error) => toast.error(apiErrorMessage(error, "Cập nhật hạng thất bại")),
  });
  const ready = tierChangeReady(detail.tier, target, reason);

  return (
    <section className="rounded-card border border-line bg-card">
      <header className="border-b border-line bg-raised/40 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-fg">Điều chỉnh hạng</h3>
        <p className="mt-0.5 text-[12px] text-muted">Quyền lợi đổi ngay và người bán nhận thông báo. Hệ thống không tự lên hay hạ hạng.</p>
      </header>
      <div className="space-y-3 p-4">
        <div role="radiogroup" aria-label="Hạng mới" className="grid gap-2 sm:grid-cols-4">
          {TIER_ORDER.map((tier) => {
            const current = detail.tier === tier;
            const chosen = target === tier;
            const direction = TIER_ORDER.indexOf(tier) - TIER_ORDER.indexOf(detail.tier);
            return (
              <button
                key={tier}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => setTarget(tier)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  chosen ? "border-iris bg-iris-soft/60" : "border-line bg-surface hover:border-line-2",
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                  {TIER_NAME[tier]}
                  {current && <Tag tone="good">Hiện tại</Tag>}
                  {!current && direction > 0 && <ArrowUp size={12} className="text-good" aria-label="Lên hạng" />}
                  {!current && direction < 0 && <ArrowDown size={12} className="text-warn" aria-label="Hạ hạng" />}
                </span>
                {tiers.data && <span className="mt-1 block text-[11.5px] leading-snug text-muted">{levers(tiers.data.tiers.find((r) => r.tier === tier))}</span>}
              </button>
            );
          })}
        </div>
        {target !== detail.tier && (
          <div className="space-y-2">
            <label className="block text-[12.5px] font-medium text-fg" htmlFor={`tier-reason-${row.id}`}>
              Lý do (bắt buộc, ghi vào lịch sử hạng và nhật ký)
            </label>
            <Input
              id={`tier-reason-${row.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={TIER_REASON_MAX}
              placeholder={TIER_ORDER.indexOf(target) > TIER_ORDER.indexOf(detail.tier) ? "vd: đủ 200 đơn, khiếu nại dưới 3%" : "vd: khiếu nại 6% trong 90 ngày"}
              className="h-9 text-[12.5px]"
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => { setTarget(detail.tier); setReason(""); }}>Hủy</Button>
              <Button size="sm" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Đang lưu…" : `Lưu hạng ${TIER_NAME[target]}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function History({ data }: { data: SellerTierDetail }) {
  return (
    <section className="rounded-card border border-line bg-card">
      <header className="border-b border-line bg-raised/40 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-fg">Lịch sử hạng</h3>
      </header>
      {data.history.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-muted">Chưa đổi hạng lần nào. Tài khoản bán hàng mới bắt đầu ở hạng Mới.</p>
      ) : (
        <ol>
          {data.history.map((event, index) => {
            const up = TIER_ORDER.indexOf(event.new_tier) > TIER_ORDER.indexOf(event.old_tier);
            return (
              <li key={`${event.created_at}-${index}`} className="flex gap-3 border-b border-line px-4 py-2.5 text-[12.5px] last:border-0">
                <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full", up ? "bg-good-soft text-good" : "bg-warn-soft text-warn")}>
                  {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-fg [overflow-wrap:anywhere]">
                    <span className="font-medium">{TIER_NAME[event.old_tier]} → {TIER_NAME[event.new_tier]}</span>
                    <span className="text-faint"> · {event.actor_email ?? "tài khoản đã xoá"}</span>
                  </span>
                  <span className="block text-muted">{event.reason ?? "Không ghi lý do"}</span>
                  <time dateTime={event.created_at} className="mt-0.5 block text-[11.5px] text-faint sm:hidden">{formatDateTime(event.created_at, "vi")}</time>
                </span>
                <time dateTime={event.created_at} className="hidden shrink-0 text-[11.5px] text-faint sm:block">{formatDateTime(event.created_at, "vi")}</time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
