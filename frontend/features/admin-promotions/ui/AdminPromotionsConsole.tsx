"use client";

/** /admin/promotions — every promo campaign on one screen: what it gives,
 *  who can use it, how much of it is used, and a one-click pause. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatLedgerMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { Promotion } from "@/lib/types";
import { Banner, Button, Card, Skeleton, Tag } from "@/components/ui";
import { Pause, Plus, RefreshCw, Tag as TagIcon } from "@/components/Icons";
import {
  PROMOTIONS_KEY, STATE_FILTERS, STATE_META, conditionChips, describeOffer, describeWindow, matchesFilter, usageRatio,
  type StateFilter,
} from "../model";
import { PromotionEditor } from "./PromotionEditor";

const money = (n: number) => formatLedgerMoney(n, "vi");

function UsageBar({ ratio }: { ratio: number | null }) {
  if (ratio == null) return null;
  return (
    <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-raised" aria-hidden>
      <span
        className={cn("block h-full rounded-full", ratio >= 1 ? "bg-warn" : "bg-iris")}
        style={{ width: `${Math.max(2, ratio * 100)}%` }}
      />
    </span>
  );
}

function Usage({ p }: { p: Promotion }) {
  return (
    <div className="min-w-0 space-y-1.5 text-[12px]">
      <div>
        <span className="font-mono tabular text-fg">{p.uses.toLocaleString("vi-VN")}</span>
        <span className="text-faint">{p.usage_limit != null ? ` / ${p.usage_limit.toLocaleString("vi-VN")} lượt` : " lượt"}</span>
        <UsageBar ratio={usageRatio(p.uses, p.usage_limit)} />
      </div>
      <div>
        <span className="font-mono tabular text-fg">{money(p.discount_given)}</span>
        <span className="text-faint">{p.budget_amount != null ? ` / ${money(p.budget_amount)}` : " đã giảm"}</span>
        <UsageBar ratio={usageRatio(p.discount_given, p.budget_amount)} />
      </div>
    </div>
  );
}

export function AdminPromotionsConsole() {
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StateFilter>("all");
  const [editing, setEditing] = useState<Promotion | "new" | null>(null);
  const promotions = useQuery({ queryKey: PROMOTIONS_KEY, queryFn: api.adminPromotions });
  const categories = useQuery({ queryKey: ["admin", "categories"], queryFn: api.adminCategories });

  const categoryName = useMemo(() => {
    const byId = new Map((categories.data?.items ?? []).map((c) => [c.id, c.name]));
    return (id: number) => byId.get(id);
  }, [categories.data]);

  const toggle = useMutation({
    mutationFn: (p: Promotion) => api.adminUpdatePromotion(p.id, { is_active: !p.is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROMOTIONS_KEY }),
  });

  const rows = promotions.data ?? [];
  const visible = rows.filter((p) => matchesFilter(p, filter));
  const running = rows.filter((p) => p.state === "running").length;
  const totalUses = rows.reduce((s, p) => s + p.uses, 0);
  const totalGiven = rows.reduce((s, p) => s + p.discount_given, 0);

  return (
    <div className="animate-rise space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-[18px] font-semibold tracking-tight text-fg">Khuyến mãi</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            Mỗi chiến dịch là một mã khách nhập khi thanh toán. Sàn chịu phần giảm giá: khách trả ít hơn,
            người bán vẫn nhận đủ giá gốc (trừ phí sàn) khi đơn được giải ngân.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}><Plus size={14} /> Tạo chiến dịch</Button>
      </div>

      <Card className="grid grid-cols-3 divide-x divide-line p-0">
        {[
          { label: "Đang chạy", value: running.toLocaleString("vi-VN") },
          { label: "Lượt đã dùng", value: totalUses.toLocaleString("vi-VN") },
          { label: "Tổng tiền sàn đã giảm", value: money(totalGiven) },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3">
            <p className="text-[11.5px] text-muted">{s.label}</p>
            {promotions.isPending
              ? <Skeleton className="mt-1.5 h-5 w-16" />
              : <p className="mt-0.5 font-mono text-[17px] font-semibold tabular text-fg">{s.value}</p>}
          </div>
        ))}
      </Card>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc theo trạng thái">
        {STATE_FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "primary" : "secondary"}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {toggle.isError && <Banner tone="bad">{apiErrorMessage(toggle.error, "Không đổi được trạng thái chiến dịch.")}</Banner>}

      {promotions.isError ? (
        <Banner
          tone="bad"
          title="Không tải được danh sách khuyến mãi"
          action={<Button size="sm" variant="secondary" onClick={() => promotions.refetch()}><RefreshCw size={13} /> Thử lại</Button>}
        >
          {apiErrorMessage(promotions.error)}
        </Banner>
      ) : promotions.isPending ? (
        <Card className="space-y-3 p-4">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </Card>
      ) : visible.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <TagIcon size={22} className="text-faint" />
          <p className="text-[13.5px] font-medium text-fg">
            {rows.length === 0 ? "Chưa có chiến dịch nào" : "Không có chiến dịch ở trạng thái này"}
          </p>
          <p className="max-w-sm text-[12.5px] text-muted">
            {rows.length === 0
              ? "Tạo mã đầu tiên, ví dụ giảm 10% cho đơn đầu tiên của khách mới."
              : "Chọn bộ lọc khác để xem các chiến dịch còn lại."}
          </p>
          {rows.length === 0 && <Button className="mt-2" onClick={() => setEditing("new")}><Plus size={14} /> Tạo chiến dịch</Button>}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_150px_120px] gap-4 border-b border-line bg-raised px-4 py-2 text-[11.5px] font-medium text-muted lg:grid">
            <span>Mã · chiến dịch</span><span>Ưu đãi · điều kiện</span><span>Thời gian</span><span>Đã dùng</span><span className="text-right">Trạng thái</span>
          </div>
          <ul className="divide-y divide-line">
            {visible.map((p) => {
              const meta = STATE_META[p.state];
              return (
                <li key={p.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_150px_120px] lg:items-center lg:gap-4">
                  <button type="button" onClick={() => setEditing(p)} className="min-w-0 text-left group">
                    <span className="block font-mono text-[13.5px] font-semibold text-fg group-hover:text-iris-hi">{p.code}</span>
                    <span className="block truncate text-[12px] text-muted">{p.name}</span>
                  </button>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-fg">{describeOffer(p, money)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {conditionChips(p, money, categoryName).map((c) => <Tag key={c}>{c}</Tag>)}
                    </div>
                  </div>
                  <p className="text-[12px] text-muted">{describeWindow(p)}</p>
                  <Usage p={p} />
                  <div className="flex items-center justify-between gap-2 lg:flex-col lg:items-end">
                    <Tag tone={meta.tone}>{meta.label}</Tag>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={toggle.isPending && toggle.variables?.id === p.id}
                        onClick={() => toggle.mutate(p)}
                        aria-label={p.is_active ? `Tạm dừng ${p.code}` : `Chạy lại ${p.code}`}
                      >
                        {p.is_active ? <><Pause size={13} /> Dừng</> : <><RefreshCw size={13} /> Chạy lại</>}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Sửa</Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <PromotionEditor
        target={editing}
        categories={categories.data?.items ?? []}
        categoryName={categoryName}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
