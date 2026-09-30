"use client";

/** /admin/promotions/[id] and /admin/promotions/new — one campaign on its own
 *  page. Tabs: Cài đặt | Hiệu quả | Lượt dùng | Mã | Lịch sử (tab in the URL).
 *  The settings form keeps a saved baseline: a sticky bar counts unsaved
 *  changes and leaving the page asks first. Times are GMT+7. */

import * as React from "react";
import { useRouter as useNextRouter, useSearchParams } from "next/navigation";
import { ConfirmModal } from "@/components/admin";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { downloadFromBff } from "@/lib/download";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { formatLedgerMoney } from "@/lib/money";
import { Link, useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { AdminPromotion, CategoryAdminRow, PromotionCodeStatus, PromotionInput } from "@/lib/types";
import { Banner, Button, Card, Input, Pagination, Select, Skeleton, Tag, Textarea } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";
import { ChevronLeft, Copy, Download, Info, Layers, Pause, Plus, RefreshCw, Search, Sparkles, X } from "@/components/Icons";
import {
  PROMOTIONS_KEY, STATE_META, attentionLabel, customerSees, describeAudit, discountFor, exampleSubtotal, promotionKey, windowHint,
} from "../model";
import {
  changedFields, digits, draftFromPromotion, draftWarnings, emptyDraft, patchFrom, randomCode, rebaseDraft, serverFieldErrors,
  validateDraft, type DraftErrors, type PromotionDraft,
} from "../form";
import { endOfMonthVn, formatVn, plusDaysVn } from "../time";
import { RowMenu, usePromotionActions } from "./shared";
import { BulkCodesDialog } from "./BulkCodesDialog";

const money = (n: number) => formatLedgerMoney(n, "vi");
const num = (n: number) => n.toLocaleString("vi-VN");

const TABS = ["settings", "stats", "redemptions", "codes", "history"] as const;
type TabKey = (typeof TABS)[number];

function useTabUrl(): [TabKey, (t: TabKey) => void] {
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab") ?? "";
  const tab = (TABS as readonly string[]).includes(raw) ? (raw as TabKey) : "settings";
  const setTab = React.useCallback((t: TabKey) => {
    const next = new URLSearchParams(window.location.search);
    if (t === "settings") next.delete("tab"); else next.set("tab", t);
    const qs = next.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);
  return [tab, setTab];
}

/** Ask before leaving with unsaved edits: tab close/reload (browser prompt) and
 *  in-app links (app dialog). Browser back is not interceptable in the App
 *  Router without breaking it. Returns the dialog to render. */
function useLeaveGuard(dirty: boolean) {
  const nextRouter = useNextRouter();
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
  return (
    <ConfirmModal
      isOpen={pendingHref !== null}
      onClose={() => setPendingHref(null)}
      onConfirm={() => { const href = pendingHref; setPendingHref(null); if (href) nextRouter.push(href); }}
      title="Rời trang?"
      description="Có thay đổi chưa lưu. Rời trang sẽ bỏ các thay đổi này."
      confirmText="Rời trang"
      cancelText="Ở lại"
      variant="danger"
    />
  );
}

// ── Form bits ──────────────────────────────────────────────────────────────

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line px-5 py-5 first:border-t-0 md:grid-cols-[180px_minmax(0,1fr)]">
      <div>
        <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>
        {hint && <p className="mt-1 text-[12px] leading-relaxed text-muted">{hint}</p>}
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </section>
  );
}

function FieldBox({ label, error, warning, hint, children, htmlFor }: {
  label: string; error?: string; warning?: string; hint?: string; children: React.ReactNode; htmlFor?: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-fg">{label}</label>
      <div className="mt-1.5">{children}</div>
      {error ? <p className="mt-1 text-[11.5px] text-bad" role="alert">{error}</p>
        : warning ? <p className="mt-1 text-[11.5px] text-warn">{warning}</p>
          : hint ? <p className="mt-1 text-[11.5px] text-faint">{hint}</p> : null}
    </div>
  );
}

/** Whole-number input with its unit pinned on the right, like MoneyInput's ₫. */
function UnitInput({ id, value, onChange, unit, invalid, placeholder, maxLength }: {
  id?: string; value: string; onChange: (v: string) => void; unit: string; invalid?: boolean; placeholder?: string; maxLength?: number;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(digits(e.target.value))}
        className={cn("pr-12 text-right font-mono tabular placeholder:font-sans placeholder:text-left", invalid && "border-bad focus:border-bad")}
      />
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{unit}</span>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[13px] text-fg">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-iris" />
      <span>{children}</span>
    </label>
  );
}

function CategoryPicker({ value, onChange, categories }: { value: number[]; onChange: (ids: number[]) => void; categories: CategoryAdminRow[] }) {
  const [open, setOpen] = React.useState(false);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const roots = categories.filter((c) => c.parent_id == null);
  const childrenOf = (id: number) => categories.filter((c) => c.parent_id === id);
  const toggle = (id: number, on: boolean) => onChange(on ? [...value, id] : value.filter((c) => c !== id));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-md border border-line-2 bg-surface px-2 py-1 text-[12px] text-fg">
            {byId.get(id)?.name ?? `#${id}`}
            <button type="button" onClick={() => toggle(id, false)} aria-label={`Bỏ ${byId.get(id)?.name ?? id}`} className="text-faint hover:text-bad"><X size={12} /></button>
          </span>
        ))}
        <Button type="button" size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Plus size={13} /> Chọn danh mục
        </Button>
        {value.length === 0 && <span className="text-[12px] text-faint">Để trống = mọi danh mục</span>}
      </div>
      {open && (
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-line p-3">
          {roots.length === 0 && <p className="text-[12px] text-faint">Chưa tải được danh mục.</p>}
          {roots.map((root) => (
            <div key={root.id} className="space-y-1.5">
              <Check checked={value.includes(root.id)} onChange={(on) => toggle(root.id, on)}>{root.name}</Check>
              <div className="space-y-1.5 pl-6">
                {childrenOf(root.id).map((child) => (
                  <Check key={child.id} checked={value.includes(child.id)} onChange={(on) => toggle(child.id, on)}>{child.name}</Check>
                ))}
              </div>
            </div>
          ))}
          <p className="pt-1 text-[11.5px] text-faint">Chọn danh mục cha là gồm cả danh mục con.</p>
        </div>
      )}
    </div>
  );
}

// ── Settings tab ───────────────────────────────────────────────────────────

function SettingsForm({ promotion, draft, set, errors, warnings, categories, onQuickEnd }: {
  promotion: AdminPromotion | null;
  draft: PromotionDraft;
  set: <K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) => void;
  errors: DraftErrors;
  warnings: DraftErrors;
  categories: CategoryAdminRow[];
  onQuickEnd: (value: string) => void;
}) {
  const locked = (promotion?.uses ?? 0) > 0;
  return (
    <Card className="overflow-hidden p-0">
      <Group title="Mã và tên" hint="Mã khách nhập khi thanh toán. Tên chỉ admin thấy.">
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBox label="Mã khách nhập" htmlFor="promo-code" error={errors.code} hint={locked ? "Đã có đơn dùng nên không đổi được mã." : "Chữ in hoa, số, - hoặc _ (3–32 ký tự)."}>
            <div className="flex gap-2">
              <Input
                id="promo-code"
                value={draft.code}
                onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s/g, ""))}
                disabled={locked}
                maxLength={32}
                placeholder="VD: THANG10"
                aria-invalid={errors.code ? true : undefined}
                className="font-mono uppercase"
              />
              {!locked && (
                <Button type="button" variant="secondary" className="h-10 shrink-0" onClick={() => set("code", randomCode())} aria-label="Tạo mã ngẫu nhiên">
                  <Sparkles size={14} />
                </Button>
              )}
            </div>
          </FieldBox>
          <FieldBox label="Tên chiến dịch" htmlFor="promo-name" error={errors.name}>
            <Input id="promo-name" value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={120} placeholder="VD: Khai trương tháng 10" aria-invalid={errors.name ? true : undefined} />
          </FieldBox>
        </div>
      </Group>

      <Group title="Ưu đãi" hint="Khách được giảm bao nhiêu.">
        <div className="flex gap-1.5" role="radiogroup" aria-label="Kiểu giảm giá">
          {([["percent", "Theo %"], ["fixed", "Số tiền cố định"]] as const).map(([key, label]) => (
            <Button key={key} type="button" size="sm" role="radio" aria-checked={draft.discount_type === key}
              variant={draft.discount_type === key ? "primary" : "secondary"} onClick={() => set("discount_type", key)}>
              {label}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {draft.discount_type === "percent" ? (
            <>
              <FieldBox label="Mức giảm" htmlFor="promo-value" error={errors.discount_value}>
                <UnitInput id="promo-value" value={draft.discount_value} onChange={(v) => set("discount_value", v.slice(0, 3))} unit="%" invalid={!!errors.discount_value} />
              </FieldBox>
              <FieldBox label="Giảm tối đa" error={errors.max_discount_amount} hint="Để trống: không giới hạn.">
                <MoneyInput value={draft.max_discount_amount} onValueChange={(v) => set("max_discount_amount", digits(v))} placeholder="Không giới hạn" invalid={!!errors.max_discount_amount} />
              </FieldBox>
            </>
          ) : (
            <FieldBox label="Số tiền giảm" error={errors.discount_value}>
              <MoneyInput value={draft.discount_value} onValueChange={(v) => set("discount_value", digits(v))} invalid={!!errors.discount_value} />
            </FieldBox>
          )}
        </div>
      </Group>

      <Group title="Điều kiện" hint="Ai, đơn nào được dùng.">
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBox label="Đơn tối thiểu (trước giảm)" error={errors.min_order_amount}>
            <MoneyInput value={draft.min_order_amount} onValueChange={(v) => set("min_order_amount", digits(v))} placeholder="Không yêu cầu" invalid={!!errors.min_order_amount} />
          </FieldBox>
        </div>
        <FieldBox label="Danh mục áp dụng" error={errors.category_ids}>
          <CategoryPicker value={draft.category_ids} onChange={(ids) => set("category_ids", ids)} categories={categories} />
        </FieldBox>
        <Check checked={draft.new_buyers_only} onChange={(v) => set("new_buyers_only", v)}>
          Chỉ đơn đầu tiên của khách <span className="text-muted">(khách chưa từng mua thành công)</span>
        </Check>
      </Group>

      <Group title="Giới hạn" hint="Để trống = không giới hạn. Chiến dịch tự dừng ở giới hạn đầu tiên chạm tới; đơn huỷ trả lại lượt.">
        <div className="grid gap-3 sm:grid-cols-3">
          <FieldBox label="Mỗi khách" htmlFor="promo-per-buyer" error={errors.per_buyer_limit}>
            <UnitInput id="promo-per-buyer" value={draft.per_buyer_limit} onChange={(v) => set("per_buyer_limit", v)} unit="lần" placeholder="∞" invalid={!!errors.per_buyer_limit} maxLength={7} />
          </FieldBox>
          <FieldBox label="Tổng lượt" htmlFor="promo-usage" error={errors.usage_limit} hint={promotion?.code_count ? "Tính cả mã dùng 1 lần." : undefined}>
            <UnitInput id="promo-usage" value={draft.usage_limit} onChange={(v) => set("usage_limit", v)} unit="lượt" placeholder="∞" invalid={!!errors.usage_limit} maxLength={9} />
          </FieldBox>
          <FieldBox label="Ngân sách giảm" error={errors.budget_amount}>
            <MoneyInput value={draft.budget_amount} onValueChange={(v) => set("budget_amount", digits(v))} placeholder="∞" invalid={!!errors.budget_amount} />
          </FieldBox>
        </div>
      </Group>

      <Group title="Thời gian" hint="Giờ Việt Nam (GMT+7). Để trống bắt đầu: chạy ngay khi bật.">
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBox label="Bắt đầu" htmlFor="promo-start" error={errors.starts_at} warning={warnings.starts_at}>
            <Input id="promo-start" type="datetime-local" value={draft.starts_at} onChange={(e) => set("starts_at", e.target.value)} aria-invalid={errors.starts_at ? true : undefined} />
          </FieldBox>
          <FieldBox label="Kết thúc" htmlFor="promo-end" error={errors.ends_at} warning={warnings.ends_at}>
            <Input id="promo-end" type="datetime-local" value={draft.ends_at} onChange={(e) => set("ends_at", e.target.value)} aria-invalid={errors.ends_at ? true : undefined} />
          </FieldBox>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="secondary" onClick={() => onQuickEnd(plusDaysVn(draft.starts_at, 7))}>+7 ngày</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => onQuickEnd(endOfMonthVn())}>Hết tháng</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => onQuickEnd("")}>Không hết hạn</Button>
        </div>
        {!promotion && (
          <Check checked={draft.is_active} onChange={(v) => set("is_active", v)}>
            Bật ngay khi tạo <span className="text-muted">(bỏ chọn để tạo ở trạng thái tạm dừng)</span>
          </Check>
        )}
      </Group>

      <Group title="Ghi chú nội bộ" hint="Chỉ admin thấy.">
        <Textarea value={draft.note} onChange={(e) => set("note", e.target.value)} maxLength={2000} placeholder="VD: Hợp tác KOL, hết ngân sách thì dừng." className="min-h-[72px]" aria-label="Ghi chú nội bộ" />
      </Group>
    </Card>
  );
}

function CustomerPreview({ input, categoryName }: { input: PromotionInput | null; categoryName: (id: number) => string | undefined }) {
  if (!input) {
    return (
      <Card className="p-4">
        <p className="text-[12.5px] font-semibold text-fg">Khách sẽ thấy</p>
        <p className="mt-1 text-[12.5px] text-muted">Sửa các ô đang báo lỗi để xem trước.</p>
      </Card>
    );
  }
  const subtotal = exampleSubtotal(input);
  const off = discountFor(input, subtotal);
  return (
    <Card className="border-iris/30 bg-iris-soft/40 p-4">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg"><Info size={14} /> Khách sẽ thấy</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fg">{customerSees(input, money, categoryName)}</p>
      <p className="mt-2 text-[12px] text-muted">
        Ví dụ đơn <span className="font-mono tabular text-fg">{money(subtotal)}</span> → giảm <span className="font-mono tabular text-good">{money(off)}</span> → trả <span className="font-mono tabular text-fg">{money(subtotal - off)}</span>
      </p>
    </Card>
  );
}

// ── Stats tab ──────────────────────────────────────────────────────────────

function StatsPanel({ promotionId, compact }: { promotionId: number; compact?: boolean }) {
  const apiErrorMessage = useApiErrorMessage();
  const q = useQuery({ queryKey: [...promotionKey(promotionId), "stats", 30], queryFn: () => api.adminPromotionStats(promotionId, 30) });
  if (q.isPending) return <Card className="p-4"><Skeleton className="h-24 w-full" /></Card>;
  if (q.isError) {
    return (
      <Banner tone="bad" action={<Button size="sm" variant="secondary" onClick={() => q.refetch()}><RefreshCw size={13} /> Thử lại</Button>}>
        {apiErrorMessage(q.error, "Không tải được số liệu.")}
      </Banner>
    );
  }
  const s = q.data;
  const peak = Math.max(1, ...s.series.map((d) => d.uses));
  const tiles = [
    { label: "Lượt dùng", value: num(s.uses) },
    { label: "Đã giảm", value: money(s.discount) },
    { label: "Doanh số đơn có mã", value: money(s.gmv) },
    { label: "Khách mới", value: num(s.new_buyers) },
  ];
  return (
    <Card className="p-4">
      <p className="text-[12.5px] font-semibold text-fg">Hiệu quả 30 ngày</p>
      <dl className={cn("mt-2 grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
        {tiles.map((t) => (
          <div key={t.label}>
            <dt className="text-[11.5px] text-muted">{t.label}</dt>
            <dd className="font-mono text-[15px] font-semibold tabular text-fg">{t.value}</dd>
          </div>
        ))}
      </dl>
      <div className={cn("mt-4 flex items-end gap-px", compact ? "h-16" : "h-40")} role="img" aria-label="Lượt dùng theo ngày, 30 ngày gần nhất">
        {s.series.map((d) => (
          <div key={d.date} className="group relative flex h-full flex-1 items-end">
            <div className={cn("w-full rounded-t-sm", d.uses ? "bg-iris" : "bg-raised")} style={{ height: `${d.uses ? Math.max(4, (d.uses / peak) * 100) : 2}%` }} />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-fg shadow-card group-hover:block">
              {d.date.split("-").reverse().slice(0, 2).join("/")}: {num(d.uses)} lượt · −{money(d.discount)}
            </span>
          </div>
        ))}
      </div>
      {!compact && s.series.length > 0 && (
        <div className="mt-1 flex justify-between text-[11px] text-faint">
          <span>{s.series[0].date.split("-").reverse().join("/")}</span>
          <span>{s.series[s.series.length - 1].date.split("-").reverse().join("/")}</span>
        </div>
      )}
    </Card>
  );
}

// ── Redemptions tab ────────────────────────────────────────────────────────

function RedemptionsPanel({ promotion }: { promotion: AdminPromotion }) {
  const apiErrorMessage = useApiErrorMessage();
  const toast = useToast();
  const [search, setSearch] = React.useState("");
  const q = useDebounce(search.trim(), 300);
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [q]);
  const perPage = 25;
  const list = useQuery({
    queryKey: [...promotionKey(promotion.id), "redemptions", q, page],
    queryFn: () => api.adminPromotionRedemptions(promotion.id, { q: q || undefined, page, per_page: perPage }),
    placeholderData: keepPreviousData,
  });
  const download = async () => {
    try {
      await downloadFromBff(api.adminPromotionRedemptionsCsvUrl(promotion.id, { q: q || undefined }), { fallbackName: `${promotion.code}-luot-dung.csv` });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Không tải được file CSV."));
    }
  };
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mã đơn hoặc email khách" aria-label="Tìm lượt dùng" className="h-9 pl-8" />
        </div>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void download()} disabled={!list.data?.total}><Download size={13} /> Xuất CSV</Button>
      </div>
      {list.isError ? (
        <div className="p-4">
          <Banner tone="bad" action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw size={13} /> Thử lại</Button>}>
            {apiErrorMessage(list.error, "Không tải được lượt dùng.")}
          </Banner>
        </div>
      ) : list.isPending ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : list.data.items.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12.5px] text-muted">{q ? "Không có lượt dùng khớp từ khoá." : "Chưa có đơn nào dùng mã này."}</p>
      ) : (
        <>
          <div className="hidden grid-cols-[130px_minmax(0,1fr)_130px_110px_120px_130px] gap-3 bg-raised px-4 py-2 text-[11.5px] font-medium text-muted md:grid">
            <span>Đơn</span><span>Khách</span><span>Mã đã nhập</span><span className="text-right">Giảm</span><span className="text-right">Tổng đơn</span><span className="text-right">Thời gian</span>
          </div>
          <ul className={cn("divide-y divide-line", list.isPlaceholderData && "opacity-60")}>
            {list.data.items.map((r) => (
              <li key={r.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5 text-[12.5px] md:grid-cols-[130px_minmax(0,1fr)_130px_110px_120px_130px] md:items-center">
                <Link href={`/admin/orders/${r.order_id}`} className="font-mono font-medium text-iris-hi hover:underline">{r.order_code}</Link>
                <Link href={`/admin/accounts/${r.buyer_id}`} className="truncate text-muted hover:text-fg hover:underline">{r.buyer_email}</Link>
                <span className="font-mono text-faint">{r.code ?? promotion.code}</span>
                <span className="text-right font-mono tabular text-good">−{money(r.discount_amount)}</span>
                <span className="text-right font-mono tabular text-fg">{money(r.order_total)}</span>
                <span className="text-right text-faint">{formatVn(r.created_at)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12px] text-muted">
            <span>{num(list.data.total)} lượt</span>
            <Pagination page={page} totalPages={Math.max(1, Math.ceil(list.data.total / perPage))} onChange={setPage} />
          </div>
        </>
      )}
    </Card>
  );
}

// ── Codes tab ──────────────────────────────────────────────────────────────

function CodesPanel({ promotion, onCreate }: { promotion: AdminPromotion; onCreate: () => void }) {
  const apiErrorMessage = useApiErrorMessage();
  const toast = useToast();
  const [status, setStatus] = React.useState<PromotionCodeStatus>("all");
  const [page, setPage] = React.useState(1);
  const perPage = 50;
  const list = useQuery({
    queryKey: [...promotionKey(promotion.id), "codes", status, page],
    queryFn: () => api.adminPromotionCodes(promotion.id, { status, page, per_page: perPage }),
    placeholderData: keepPreviousData,
  });
  const download = async () => {
    try {
      await downloadFromBff(api.adminPromotionCodesCsvUrl(promotion.id, { status }), { fallbackName: `${promotion.code}-ma.csv` });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Không tải được file CSV."));
    }
  };
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <p className="text-[12.5px] text-muted">
          <span className="font-mono tabular text-fg">{num(promotion.codes_redeemed)}</span> / {num(promotion.code_count)} mã đã dùng · mỗi mã 1 lượt
        </p>
        <div className="flex gap-1.5" role="group" aria-label="Lọc mã">
          {([["all", "Tất cả"], ["unused", "Chưa dùng"], ["used", "Đã dùng"]] as const).map(([k, label]) => (
            <Button key={k} size="sm" variant={status === k ? "primary" : "secondary"} aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1); }}>{label}</Button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => void download()} disabled={!list.data?.total}><Download size={13} /> CSV</Button>
          <Button size="sm" onClick={onCreate}><Plus size={13} /> Tạo thêm mã</Button>
        </div>
      </div>
      {list.isError ? (
        <div className="p-4">
          <Banner tone="bad" action={<Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw size={13} /> Thử lại</Button>}>
            {apiErrorMessage(list.error, "Không tải được danh sách mã.")}
          </Banner>
        </div>
      ) : list.isPending ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : list.data.items.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12.5px] text-muted">{status === "all" ? "Chưa có mã dùng 1 lần nào." : "Không có mã ở trạng thái này."}</p>
      ) : (
        <>
          <ul className={cn("divide-y divide-line", list.isPlaceholderData && "opacity-60")}>
            {list.data.items.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[12.5px]">
                <span className="font-mono font-medium text-fg">{c.code}</span>
                {c.redeemed_at ? (
                  <span className="text-muted">
                    Đã dùng {formatVn(c.redeemed_at)}{c.order_code && <> · <span className="font-mono">{c.order_code}</span></>}
                  </span>
                ) : <Tag tone="good">Chưa dùng</Tag>}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12px] text-muted">
            <span>{num(list.data.total)} mã</span>
            <Pagination page={page} totalPages={Math.max(1, Math.ceil(list.data.total / perPage))} onChange={setPage} />
          </div>
        </>
      )}
    </Card>
  );
}

// ── History tab ────────────────────────────────────────────────────────────

function HistoryPanel({ promotionId }: { promotionId: number }) {
  const q = useQuery({ queryKey: [...promotionKey(promotionId), "history"], queryFn: () => api.adminAuditEntity("promotion", promotionId, 100) });
  return (
    <Card className="p-5">
      {q.isPending ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : q.isError ? (
        <p className="text-[13px] text-bad">
          Không tải được lịch sử. <button type="button" className="font-medium underline" onClick={() => q.refetch()}>Thử lại</button>
        </p>
      ) : q.data.length === 0 ? (
        <p className="text-[13px] text-muted">Chưa có thay đổi nào được ghi lại.</p>
      ) : (
        <ol className="relative space-y-4 border-l border-line pl-5">
          {q.data.map((e) => {
            const d = describeAudit(e);
            return (
              <li key={e.id} className="relative">
                <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-iris" />
                <p className="text-[13px] font-medium text-fg">{d.title}</p>
                {d.detail && <p className="mt-0.5 break-words text-[12.5px] text-muted">{d.detail}</p>}
                <p className="mt-0.5 text-[11.5px] text-faint">{e.actor_email ?? "Hệ thống"} · {formatVn(e.created_at)}</p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

function Editor({ promotion, categories, categoryName }: {
  promotion: AdminPromotion | null;
  categories: CategoryAdminRow[];
  categoryName: (id: number) => string | undefined;
}) {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const apiErrorMessage = useApiErrorMessage();
  const [tab, setTab] = useTabUrl();
  const [bulkOpen, setBulkOpen] = React.useState(false);

  const saved = React.useMemo(() => (promotion ? draftFromPromotion(promotion) : emptyDraft()), [promotion]);
  const [draft, setDraft] = React.useState<PromotionDraft>(saved);
  const [errors, setErrors] = React.useState<DraftErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  // Counted live so the bar clears as each field is fixed.
  const invalidCount = Object.values(errors).filter(Boolean).length;
  const baseline = React.useRef(saved);
  React.useEffect(() => {
    if (baseline.current === saved) return;
    const old = baseline.current;
    baseline.current = saved;
    setDraft((d) => rebaseDraft(d, old, saved));
  }, [saved]);

  const changes = changedFields(draft, saved);
  const dirty = changes.length > 0;
  const leaveDialog = useLeaveGuard(dirty);

  const set = React.useCallback(<K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }, []);

  const liveInput = validateDraft({ ...draft, code: draft.code || "MA", name: draft.name || "x" }).input;
  const warnings = draftWarnings(draft, promotion?.starts_at ?? null);

  const save = useMutation({
    mutationFn: (input: PromotionInput) =>
      promotion ? api.adminUpdatePromotion(promotion.id, patchFrom(input, changes)) : api.adminCreatePromotion(input),
    onSuccess: (res) => {
      setErrors({});
      setFormError(null);
      queryClient.setQueryData(promotionKey(res.id), res);
      void queryClient.invalidateQueries({ queryKey: PROMOTIONS_KEY });
      if (!promotion) {
        // The new page has nothing unsaved anymore; go to the campaign's own page.
        baseline.current = draftFromPromotion(res);
        setDraft(baseline.current);
        toast.success(`Đã tạo ${res.code}`);
        router.replace(`/admin/promotions/${res.id}`);
      } else {
        setDraft(draftFromPromotion(res));
        toast.success("Đã lưu thay đổi");
      }
    },
    onError: (e) => {
      const fields = serverFieldErrors(e);
      if (fields) setErrors(fields);
      else setFormError(apiErrorMessage(e, "Lưu không thành công."));
    },
  });

  const onSave = () => {
    const { input, errors: found } = validateDraft(draft);
    setFormError(null);
    if (!input) {
      setErrors(found);
      if (tab !== "settings") setTab("settings");
      return;
    }
    save.mutate(input);
  };

  const { act, dialogs, pending } = usePromotionActions({
    onDuplicated: (p) => router.push(`/admin/promotions/${p.id}`),
    onRemoved: () => router.replace("/admin/promotions"),
  });

  const meta = promotion ? STATE_META[promotion.state] : null;
  const warn = promotion ? attentionLabel(promotion.attention_reason, promotion.budget_eta_days) : null;
  const tabs: { key: TabKey; label: string; count?: number }[] = promotion
    ? [
      { key: "settings", label: "Cài đặt" },
      { key: "stats", label: "Hiệu quả" },
      { key: "redemptions", label: "Lượt dùng", count: promotion.uses },
      ...(promotion.code_count > 0 ? [{ key: "codes" as const, label: "Mã", count: promotion.code_count }] : []),
      { key: "history", label: "Lịch sử thay đổi" },
    ]
    : [{ key: "settings", label: "Cài đặt" }];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "settings";
  const canPause = promotion && promotion.archived_at == null && (promotion.state === "running" || promotion.state === "scheduled" || promotion.state === "paused");

  return (
    <div className="animate-rise space-y-4 pb-4">
      <div>
        <Link href="/admin/promotions" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ChevronLeft size={14} /> Khuyến mãi</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-[20px] font-semibold tracking-tight text-fg">{promotion ? promotion.code : "Chiến dịch mới"}</h1>
              {meta && <Tag tone={meta.tone}>{meta.label}</Tag>}
              {warn && <Tag tone="warn">{warn}</Tag>}
              {promotion && (
                <button type="button" onClick={() => act("copy", promotion)} aria-label={`Sao chép ${promotion.code}`} className="rounded p-1 text-faint hover:text-fg"><Copy size={14} /></button>
              )}
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {promotion
                ? <>{promotion.name}{promotion.uses > 0 && " · đã dùng nên không đổi được mã"}{windowHint(promotion) && ` · ${windowHint(promotion)}`}</>
                : "Điền ưu đãi, điều kiện và thời gian. Giờ theo giờ Việt Nam (GMT+7)."}
            </p>
          </div>
          {promotion && (
            <div className="flex flex-wrap items-center gap-2">
              {promotion.code_count === 0 && (
                <Button size="sm" variant="secondary" onClick={() => setBulkOpen(true)}><Layers size={13} /> Mã dùng 1 lần</Button>
              )}
              <Button size="sm" variant="secondary" loading={pending?.kind === "duplicate"} onClick={() => act("duplicate", promotion)}>Nhân bản</Button>
              {canPause && (
                <Button size="sm" variant="secondary" onClick={() => act(promotion.is_active ? "pause" : "resume", promotion)}>
                  {promotion.is_active ? <><Pause size={13} /> Tạm dừng…</> : <><RefreshCw size={13} /> Bật lại…</>}
                </Button>
              )}
              <RowMenu promotion={promotion} hide={["edit", "duplicate", "copy"]} onAction={(a) => act(a, promotion)} />
            </div>
          )}
        </div>
      </div>

      {promotion?.archived_at && (
        <Banner tone="iris" action={<Button size="sm" variant="secondary" onClick={() => act("unarchive", promotion)}>Bỏ lưu trữ</Button>}>
          Chiến dịch đã lưu trữ ngày {formatVn(promotion.archived_at)} và đang tắt.
        </Banner>
      )}

      {tabs.length > 1 && (
        <div role="tablist" aria-label="Chiến dịch" className="flex gap-1 overflow-x-auto border-b border-line">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                activeTab === t.key ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              {t.label}
              {t.count != null && <span className="font-mono text-[11.5px] tabular text-faint">{num(t.count)}</span>}
            </button>
          ))}
        </div>
      )}

      {activeTab === "settings" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <form onSubmit={(e) => { e.preventDefault(); onSave(); }} noValidate>
            <SettingsForm
              promotion={promotion}
              draft={draft}
              set={set}
              errors={errors}
              warnings={warnings}
              categories={categories}
              onQuickEnd={(v) => set("ends_at", v)}
            />
          </form>
          <aside className="space-y-4 lg:sticky lg:top-4">
            <CustomerPreview input={liveInput} categoryName={categoryName} />
            {promotion && <StatsPanel promotionId={promotion.id} compact />}
          </aside>
        </div>
      )}
      {promotion && activeTab === "stats" && <StatsPanel promotionId={promotion.id} />}
      {promotion && activeTab === "redemptions" && <RedemptionsPanel promotion={promotion} />}
      {promotion && activeTab === "codes" && <CodesPanel promotion={promotion} onCreate={() => setBulkOpen(true)} />}
      {promotion && activeTab === "history" && <HistoryPanel promotionId={promotion.id} />}

      {(dirty || !promotion) && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-card border border-warn/40 bg-card px-4 py-3 shadow-card">
          <span className="text-[13px] font-medium text-fg">
            {promotion ? <><span className="text-warn">●</span> {changes.length} thay đổi chưa lưu</> : "Chiến dịch chưa được tạo"}
          </span>
          {(formError || invalidCount > 0) && <span className="text-[12px] text-bad" role="alert">{formError ?? `Còn ${invalidCount} ô chưa hợp lệ.`}</span>}
          <div className="ml-auto flex gap-2">
            {promotion ? (
              <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => { setDraft(saved); setErrors({}); setFormError(null); }}>Huỷ thay đổi</Button>
            ) : (
              <Link href="/admin/promotions" className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-muted hover:bg-raised hover:text-fg">Huỷ</Link>
            )}
            <Button size="sm" loading={save.isPending} onClick={onSave}>{promotion ? "Lưu" : "Tạo chiến dịch"}</Button>
          </div>
        </div>
      )}

      {dialogs}
      {leaveDialog}
      {promotion && <BulkCodesDialog open={bulkOpen} onClose={() => setBulkOpen(false)} promotion={promotion} />}
    </div>
  );
}

export function PromotionPage({ id }: { id: number | "new" }) {
  const apiErrorMessage = useApiErrorMessage();
  const isNew = id === "new";
  const valid = isNew || (Number.isInteger(id) && id > 0);
  const promo = useQuery({
    queryKey: promotionKey(isNew ? 0 : id),
    queryFn: () => api.adminPromotion(id as number),
    enabled: !isNew && valid,
  });
  const categories = useQuery({ queryKey: ["admin", "categories"], queryFn: api.adminCategories });
  const categoryName = React.useMemo(() => {
    const byId = new Map((categories.data?.items ?? []).map((c) => [c.id, c.name]));
    return (cid: number) => byId.get(cid);
  }, [categories.data]);

  if (!valid) return <Banner tone="bad" title="Không tìm thấy chiến dịch">Đường dẫn không hợp lệ. <Link href="/admin/promotions" className="underline">Về danh sách</Link></Banner>;
  if (!isNew && promo.isError) {
    return (
      <Banner
        tone="bad"
        title="Không tải được chiến dịch"
        action={<Button size="sm" variant="secondary" onClick={() => promo.refetch()}><RefreshCw size={13} /> Thử lại</Button>}
      >
        {apiErrorMessage(promo.error)} <Link href="/admin/promotions" className="underline">Về danh sách</Link>
      </Banner>
    );
  }
  if (!isNew && promo.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-8 w-96" />
        <Card className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</Card>
      </div>
    );
  }
  return (
    <Editor
      key={isNew ? "new" : id}
      promotion={isNew ? null : promo.data!}
      categories={categories.data?.items ?? []}
      categoryName={categoryName}
    />
  );
}
