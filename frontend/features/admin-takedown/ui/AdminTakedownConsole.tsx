"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { ActivityBar, Banner, Button, Card, Input, Pagination, Select, Skeleton } from "@/components/ui";
import { AlertCircle, AlertTriangle, ChevronRight, Search } from "@/components/Icons";
import {
  LIST_TABS, PAGE_SIZES, PLATFORMS,
  adminFiltersToSearch, applyAdminFilters, bucketOf, countByBucket, maskEmail, paginate, parseAdminFilters, stateSince,
  useAdminTakedownRequests, useServiceLabel, useShortTime, useTakedownServiceStatus, LinkCell, StatusTag,
  type AdminFilters, type AdminSort, type ListTab, type PlatformFilter, type TakedownAdminRequest,
} from "@/features/takedown";
import { adminStatusLabel, waitedLabel } from "../model";

/* Admin copy stays Vietnamese like the rest of the console. */
const TAB_LABEL: Record<ListTab, string> = {
  all: "Tất cả", review: "Chờ báo giá", quoted: "Chờ khách duyệt", processing: "Đang xử lý", warranty: "Bảo hành", finished: "Kết thúc",
};
const PLATFORM_LABEL: Record<PlatformFilter, string> = {
  all: "Mọi nền tảng", tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", other: "Khác",
};
const SORT_LABEL: Record<AdminSort, string> = { waiting: "Chờ lâu nhất", newest: "Mới gửi nhất", oldest: "Cũ nhất" };
const COLS = "grid-cols-[minmax(260px,1fr)_150px_150px_96px_190px_110px_72px_20px]";

/** Admin request list: status tabs, search, platform filter, sort and paging — all in the URL. */
export function AdminTakedownConsole() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = parseAdminFilters(params);
  const [q, setQ] = useState(filters.q);
  const query = useAdminTakedownRequests(true);
  const all = query.data ?? [];
  const counts = countByBucket(all);
  const view = paginate(applyAdminFilters(all, { ...filters, q }), filters.page, filters.perPage);
  const now = Date.now();
  const listSearch = adminFiltersToSearch({ ...filters, q });

  const go = (patch: Partial<AdminFilters>) => {
    router.replace(`${pathname}${adminFiltersToSearch({ ...filters, q, page: 1, ...patch })}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-[24px] font-semibold tracking-tight text-fg">Gỡ link vi phạm</h1>
        <p className="text-[13px] text-muted">Đối tác báo giá vốn → admin đặt giá bán → khách chấp nhận. Xử lý, bảo hành, Done/Failed do đối tác cập nhật qua webhook.</p>
      </div>
      <SetupBanner />

      <Card className="overflow-hidden p-0">
        <div role="tablist" aria-label="Lọc theo bước" className="grid grid-cols-3 sm:grid-cols-6">
          {LIST_TABS.map((tab, i) => {
            const count = tab === "all" ? all.length : counts[tab];
            const selected = filters.tab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => go({ tab })}
                className={cn(
                  "relative flex flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris",
                  i % 3 !== 0 && "border-l border-line", i >= 3 && "border-t border-line sm:border-t-0", i === 3 && "sm:border-l",
                  selected && "bg-raised/60 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-iris",
                )}
              >
                <span className="text-[12px] font-medium text-muted">{TAB_LABEL[tab]}</span>
                <span className={cn("font-mono text-[20px] font-semibold leading-none tabular", count ? "text-fg" : "text-faint")}>
                  {query.isPending ? "–" : count}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-80">
          <span className="sr-only">Tìm kiếm</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); router.replace(`${pathname}${adminFiltersToSearch({ ...filters, q: e.target.value, page: 1 })}`, { scroll: false }); }}
            placeholder="Mã TD-…, link, email khách, ghi chú"
            className="pl-9"
          />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          <span className="sr-only">Nền tảng</span>
          <Select value={filters.platform} onChange={(e) => go({ platform: e.target.value as PlatformFilter })} className="w-40">
            {(["all", ...PLATFORMS, "other"] as PlatformFilter[]).map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          Sắp xếp
          <Select value={filters.sort} onChange={(e) => go({ sort: e.target.value as AdminSort })} className="w-40">
            {(Object.keys(SORT_LABEL) as AdminSort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
          </Select>
        </label>
        {(q || filters.platform !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); go({ q: "", platform: "all" }); }}>Xoá lọc</Button>
        )}
      </div>

      {query.isError && (
        <Banner tone="bad" icon={<AlertCircle size={15} aria-hidden />} title="Không tải được danh sách."
          action={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Thử lại</Button>} />
      )}

      <Card className="relative overflow-hidden p-0">
        <ActivityBar active={query.isFetching && !query.isPending} label="Đang tải" />
        {query.isPending ? (
          <div className="flex flex-col gap-3 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : view.total === 0 ? (
          <p className="px-6 py-12 text-center text-[13px] text-muted">Không có link nào khớp bộ lọc “{TAB_LABEL[filters.tab]}”{q ? ` · “${q}”` : ""}.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1100px]">
              <div className={cn("grid items-center gap-3 border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint", COLS)}>
                <span>Link · mã</span><span>Loại</span><span>Khách</span><span>Gửi lúc</span><span>Trạng thái</span><span className="text-right">Giá</span><span className="text-right">Chờ</span><span />
              </div>
              <ul>{view.rows.map((r) => <Row key={r.code} request={r} now={now} back={listSearch} />)}</ul>
            </div>
          </div>
        )}
      </Card>

      {!query.isPending && view.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[12.5px] text-muted">
            {(view.page - 1) * filters.perPage + 1}–{(view.page - 1) * filters.perPage + view.rows.length} trên {view.total} link (bộ lọc hiện tại)
          </span>
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            Mỗi trang
            <Select value={String(filters.perPage)} onChange={(e) => go({ perPage: Number(e.target.value) })} className="h-8 w-20">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
          <div className="ml-auto">
            <Pagination page={view.page} totalPages={view.totalPages} onChange={(page) => go({ page })} />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ request, now, back }: { request: TakedownAdminRequest; now: number; back: string }) {
  const { formatLedgerMoney } = useMoney();
  const serviceLabel = useServiceLabel();
  const locale = useLocale();
  const time = useShortTime();
  // Waiting on us: the partner quoted and the buyer price is still missing.
  const waiting = bucketOf(request.status) === "review" && request.partner_status === "quoted";
  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        href={`/admin/takedown/${request.code}${back ? `?back=${encodeURIComponent(back)}` : ""}`}
        className={cn("grid items-center gap-3 px-4 py-3 transition-colors hover:bg-raised/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris", COLS)}
      >
        <LinkCell request={request} />
        <span className="text-[12.5px] text-fg">{serviceLabel(request.service)}</span>
        <span className="truncate font-mono text-[12.5px] text-muted" title={request.buyer_email ?? undefined}>{maskEmail(request.buyer_email)}</span>
        <span className="font-mono text-[12.5px] tabular text-muted">{time(request.created_at)}</span>
        <span><StatusTag request={request} label={adminStatusLabel} /></span>
        <span className="text-right font-mono text-[13px] font-semibold tabular text-fg">
          {request.price === null ? <span className="font-sans font-normal text-faint">Chưa báo</span> : formatLedgerMoney(request.price, locale)}
        </span>
        <span className={cn("text-right font-mono text-[12.5px] tabular", waiting ? "font-semibold text-warn" : "text-muted")}>
          {request.needs_sync && <AlertTriangle size={12} className="mr-1 inline text-warn" aria-label="Chờ đồng bộ" />}
          {waitedLabel(stateSince(request), now)}
        </span>
        <ChevronRight size={15} className="text-faint" aria-hidden />
      </Link>
    </li>
  );
}

/** What is missing before buyers can send links (env on the backend, see .env.example). */
function SetupBanner() {
  const status = useTakedownServiceStatus();
  const s = status.data;
  if (!s) return null;
  const missing = [
    !s.configured && "TAKEDOWN_API_BASE_URL / TAKEDOWN_CLIENT_KEY",
    !s.webhook_secret_set && "TAKEDOWN_WEBHOOK_SECRET",
    !s.seller_set && "TAKEDOWN_SELLER_EMAIL",
  ].filter(Boolean) as string[];
  if (missing.length === 0 && s.partner_reachable) return null;
  return (
    <Banner tone={missing.length ? "bad" : "warn"} icon={<AlertTriangle size={15} aria-hidden />}
      title={missing.length ? "Dịch vụ gỡ link chưa cấu hình đủ" : "Không gọi được API đối tác"}>
      {missing.length
        ? <>Thiếu biến môi trường backend: <span className="font-mono">{missing.join(", ")}</span>. Khách chưa gửi link được.</>
        : <>Đã cấu hình nhưng <span className="font-mono">/health</span> của đối tác không trả lời. Yêu cầu mới sẽ được tạo lại tự động khi đối tác hoạt động.</>}
    </Banner>
  );
}
