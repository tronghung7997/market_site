"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { AffiliateSort } from "@/lib/types";
import { useAdminAffiliates } from "@/hooks/use-affiliate";
import { Button, Select, Spinner } from "@/components/ui";
import { Pagination, SearchInput } from "@/components/admin";
import { ChevronRight, Coins, Landmark, TrendingUp, Users } from "@/components/Icons";
import { AccountAvatar } from "@/features/admin-accounts/ui/shared";
import { formatRate, ratio } from "@/features/affiliate";
import { FundPanel } from "./FundPanel";

const PER_PAGE = 20;
const SORTS: { key: AffiliateSort; label: string }[] = [
  { key: "commission", label: "Hoa hồng cao nhất" },
  { key: "clicks", label: "Nhiều lượt nhấp" },
  { key: "signups", label: "Nhiều đăng ký" },
  { key: "orders", label: "Nhiều đơn" },
  { key: "newest", label: "Tài khoản mới nhất" },
  { key: "email", label: "Email A→Z" },
];

function StatTile({ icon: Icon, label, value, sub, tone = "neutral", onClick, active }: {
  icon: typeof Users; label: string; value: string; sub?: string;
  tone?: "neutral" | "iris" | "good" | "warn" | "bad"; onClick?: () => void; active?: boolean;
}) {
  const iconTone = { neutral: "bg-raised text-muted", iris: "bg-iris-soft text-iris", good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad" }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full min-h-[72px] items-center gap-3 rounded-card border bg-card px-4 py-3 text-left shadow-card transition-colors",
        onClick ? "hover:border-line-2" : "cursor-default",
        active ? "border-iris ring-1 ring-iris/30" : "border-line",
      )}
    >
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", iconTone)}><Icon size={17} /></span>
      <span className="min-w-0">
        <span className="block text-[12px] text-muted">{label}</span>
        <span className="block truncate font-mono text-[18px] font-semibold leading-tight tabular-nums text-fg">{value}</span>
        {sub && <span className="block text-[11px] text-faint">{sub}</span>}
      </span>
    </button>
  );
}

/** Admin › Affiliate: who is referring, what it earns them, and the fund that pays for it. */
export function AdminAffiliatesConsole() {
  const router = useRouter();
  const locale = useLocale();
  const [search, setSearch] = React.useState("");
  const [activeOnly, setActiveOnly] = React.useState(true);
  const [sort, setSort] = React.useState<AffiliateSort>("commission");
  const [page, setPage] = React.useState(1);
  const [fundOpen, setFundOpen] = React.useState(false);

  const list = useAdminAffiliates({ search: search || undefined, page, per_page: PER_PAGE, sort, active_only: activeOnly });
  const fund = useQuery({ queryKey: ["admin-affiliate-fund"], queryFn: api.adminFund });
  const summary = list.data?.summary;
  const items = list.data?.items ?? [];
  const balance = fund.data?.balance ?? 0;
  const n = (v: number) => v.toLocaleString("vi-VN");

  return (
    <div className="space-y-5">
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[13px] text-muted">Ai đang giới thiệu khách, hiệu quả ra sao và quỹ hoa hồng còn bao nhiêu. Bấm vào một dòng để xem chi tiết; luật trả hoa hồng chỉnh ở Cài đặt › Affiliate.</p>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Tìm theo email…" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Landmark}
          label="Quỹ hoa hồng còn lại"
          value={fund.data ? vnd(balance) : "…"}
          sub={fund.data ? (balance < 0 ? "Quỹ âm — vẫn trả hoa hồng, cần nạp thêm" : "Bấm để nạp quỹ / xem lịch sử") : undefined}
          tone={balance < 0 ? "bad" : "iris"}
          onClick={() => setFundOpen(true)}
        />
        <StatTile icon={Coins} label="Hoa hồng đã trả" value={summary ? vnd(summary.commission) : "…"} sub={summary ? `${n(summary.orders)} đơn tính hoa hồng` : undefined} tone="good" />
        <StatTile icon={TrendingUp} label="Affiliate có hoạt động" value={summary ? n(summary.active) : "…"} sub={summary ? `${n(summary.clicks)} lượt nhấp` : undefined} tone="neutral" active={activeOnly} onClick={() => { setActiveOnly(true); setPage(1); }} />
        <StatTile icon={Users} label="Đăng ký qua giới thiệu" value={summary ? n(summary.signups) : "…"} sub={summary && summary.clicks > 0 ? `${formatRate(ratio(summary.signups, summary.clicks), "vi")} từ lượt nhấp` : undefined} tone="neutral" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-card p-0.5" role="tablist" aria-label="Lọc">
          {[{ key: true, label: "Có hoạt động" }, { key: false, label: "Tất cả tài khoản" }].map((f) => (
            <button key={String(f.key)} type="button" role="tab" aria-selected={activeOnly === f.key} onClick={() => { setActiveOnly(f.key); setPage(1); }}
              className={cn("rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors", activeOnly === f.key ? "bg-iris text-surface" : "text-muted hover:text-fg")}>
              {f.label}
            </button>
          ))}
        </div>
        <Select value={sort} onChange={(e) => { setSort(e.target.value as AffiliateSort); setPage(1); }} aria-label="Sắp xếp" className="h-9 w-auto min-w-[180px] text-[12.5px]">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        <span className="ml-auto text-[12px] text-faint">
          {list.data ? `${n(list.data.total)} tài khoản` : ""}{list.isFetching && list.data ? " · đang tải…" : ""}
        </span>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        {list.isPending ? (
          <div className="grid place-items-center py-20"><Spinner /></div>
        ) : list.isError ? (
          <div className="px-5 py-12 text-center text-[13px] text-bad">Không tải được danh sách. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void list.refetch()}>Thử lại</Button></div>
        ) : items.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[13.5px] font-medium text-fg">{activeOnly && !search ? "Chưa có ai giới thiệu khách." : "Không có tài khoản nào khớp."}</p>
            <p className="mt-1 text-[12.5px] text-muted">{activeOnly ? "Mọi tài khoản đều có mã giới thiệu — chuyển sang “Tất cả tài khoản” để xem mã của từng người." : "Thử tìm theo một phần email."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-raised/40 text-left text-[12px] text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Tài khoản</th>
                  <th className="px-3 py-2.5 text-right font-medium">Nhấp</th>
                  <th className="px-3 py-2.5 text-right font-medium">Đăng ký</th>
                  <th className="px-3 py-2.5 text-right font-medium">Đơn</th>
                  <th className="px-3 py-2.5 text-right font-medium">Chuyển đổi</th>
                  <th className="px-3 py-2.5 text-right font-medium">Hoa hồng</th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((row) => {
                  const idle = row.clicks === 0 && row.signups === 0 && row.orders === 0;
                  return (
                    <tr key={row.id} onClick={() => router.push(`/${locale}/admin/affiliates/${row.id}`)} className={cn("group cursor-pointer transition-colors hover:bg-raised/40", idle && "text-muted")}>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-3">
                          <AccountAvatar email={row.email} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-fg">{row.email}</div>
                            <div className="mt-0.5 font-mono text-[11.5px] text-faint">{row.affiliate_code}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(row.clicks)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(row.signups)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(row.orders)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">{row.clicks > 0 ? formatRate(ratio(row.signups, row.clicks), "vi") : <span className="text-faint">—</span>}</td>
                      <td className={cn("px-3 py-2.5 text-right font-medium tabular-nums", row.commission > 0 ? "text-good" : "text-faint")}>{vnd(row.commission)}</td>
                      <td className="px-3 py-2.5 text-right"><span className="inline-grid h-7 w-7 place-items-center rounded-md text-faint transition-colors group-hover:text-fg"><ChevronRight size={15} /></span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {list.data && list.data.total > PER_PAGE && <Pagination page={page} perPage={PER_PAGE} total={list.data.total} onPageChange={setPage} />}

      <FundPanel open={fundOpen} onClose={() => setFundOpen(false)} />
    </div>
  );
}
