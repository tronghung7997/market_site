"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { ActivityBar, Banner, Button, Card, Input, Pagination, Select, Skeleton, buttonClass } from "@/components/ui";
import { AlertCircle, Search } from "@/components/Icons";
import {
  LIST_TABS, PAGE_SIZES, countByBucket, filterRequests, needsBuyer, paginate, parseListTab, parsePage, parsePerPage, sortRequests,
  type ListTab, type TakedownRequest,
} from "../model";
import { useTakedownRequests } from "../useTakedown";
import { LinkCell, StatusTag, StepBar, useServiceLabel, useShortTime, useWarrantyLabel } from "./parts";

const COLS = "grid-cols-[minmax(240px,1fr)_160px_100px_80px_190px_110px_84px]";
const BUYER_PAGE_SIZE = 10;

export function TakedownList() {
  const t = useTranslations("takedown");
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = parseListTab(params.get("status"));
  const page = parsePage(params.get("page"));
  const perPage = parsePerPage(params.get("per"), BUYER_PAGE_SIZE);
  const [search, setSearch] = useState(params.get("q") ?? "");

  const { account, loading } = useAuth();
  const query = useTakedownRequests(account?.id, !loading && Boolean(account));
  const all = useMemo(() => sortRequests(query.data ?? []), [query.data]);
  const filtered = useMemo(() => filterRequests(all, tab, search), [all, tab, search]);
  const view = paginate(filtered, page, perPage);
  const counts = countByBucket(all);

  const setParams = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) sp.delete(k); else sp.set(k, v);
    }
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };
  const setTab = (next: ListTab) => setParams({ status: next === "all" ? null : next, page: null });
  const onSearch = (value: string) => {
    setSearch(value);
    setParams({ q: value.trim() ? value : null, page: null });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label={t("list.tabsLabel")} className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1">
          {LIST_TABS.map((key) => {
            const count = key === "all" ? all.length : counts[key];
            const selected = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(key)}
                className={cn(
                  "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors",
                  selected ? "bg-fg text-surface" : "text-muted hover:bg-raised hover:text-fg",
                )}
              >
                {t(`bucket.${key}`)}
                <span className={cn("font-mono text-[12px] tabular", selected ? "text-surface/80" : "text-faint")}>{query.isPending ? "–" : count}</span>
              </button>
            );
          })}
        </div>
        <label className="relative ml-auto w-full sm:w-72">
          <span className="sr-only">{t("list.search")}</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={t("list.search")} className="pl-9" />
        </label>
      </div>

      {query.isError && (
        <Banner tone="bad" icon={<AlertCircle size={15} aria-hidden />} title={t("dashboard.error")}
          action={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{t("dashboard.retry")}</Button>} />
      )}

      <Card className="relative overflow-hidden p-0">
        <ActivityBar active={query.isFetching && !query.isPending} label={t("list.tabsLabel")} />
        {query.isPending ? (
          <div className="flex flex-col gap-3 p-4" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : view.total === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="text-[14px] text-muted">{all.length === 0 ? t("dashboard.emptyBody") : t("list.emptyFiltered")}</p>
            {all.length === 0
              ? <Link href="/takedown/new" className={buttonClass()}>{t("nav.new")}</Link>
              : <Button variant="secondary" onClick={() => { setSearch(""); setParams({ status: null, q: null, page: null }); }}>{t("list.clearFilters")}</Button>}
          </div>
        ) : (
          <>
            <div className="hidden lg:block">
              <div className={cn("grid items-center gap-4 border-b border-line px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint", COLS)}>
                <span>{t("list.colLink")}</span><span>{t("list.colService")}</span><span>{t("list.colCreated")}</span><span>{t("list.colWarranty")}</span>
                <span>{t("list.colStatus")}</span><span className="text-right">{t("list.colPrice")}</span><span />
              </div>
              <ul>{view.rows.map((r) => <DesktopRow key={r.code} request={r} />)}</ul>
            </div>
            <ul className="lg:hidden">{view.rows.map((r) => <MobileRow key={r.code} request={r} />)}</ul>
          </>
        )}
      </Card>

      {!query.isPending && view.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[12.5px] text-muted">
            {t("list.showing", { from: (view.page - 1) * perPage + 1, to: (view.page - 1) * perPage + view.rows.length, total: view.total })}
          </span>
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            {t("list.perPage")}
            <Select value={String(perPage)} onChange={(e) => setParams({ per: e.target.value === String(BUYER_PAGE_SIZE) ? null : e.target.value, page: null })} className="h-8 w-20">
              {[BUYER_PAGE_SIZE, ...PAGE_SIZES.filter((n) => n !== BUYER_PAGE_SIZE)].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
          <div className="ml-auto">
            <Pagination page={view.page} totalPages={view.totalPages} onChange={(p) => setParams({ page: p > 1 ? String(p) : null })} />
          </div>
        </div>
      )}
    </div>
  );
}

function PriceCell({ request }: { request: TakedownRequest }) {
  const t = useTranslations("takedown.list");
  const { formatBrowseMoney } = useMoney();
  const locale = useLocale();
  if (request.price === null) return <span className="text-[12.5px] text-faint">{t("awaitingQuote")}</span>;
  return <span className="font-mono text-[13.5px] font-semibold tabular text-fg">{formatBrowseMoney(request.price, { locale })}</span>;
}

function RowAction({ request }: { request: TakedownRequest }) {
  const t = useTranslations("takedown.list");
  const href = `/takedown/requests/${request.code}`;
  return needsBuyer(request)
    ? <Link href={href} className={buttonClass({ size: "sm" })}>{t("viewQuote")}</Link>
    : <Link href={href} className={buttonClass({ size: "sm", variant: "ghost" })}>{t("open")}</Link>;
}

function DesktopRow({ request }: { request: TakedownRequest }) {
  const warranty = useWarrantyLabel();
  const serviceLabel = useServiceLabel();
  const time = useShortTime();
  return (
    <li className={cn("grid items-center gap-4 border-b border-line px-5 py-3 last:border-b-0", COLS, needsBuyer(request) && "bg-warn-soft/40")}>
      <LinkCell request={request} />
      <span className="text-[13px] text-fg">{serviceLabel(request.service)}</span>
      <span className="font-mono text-[12.5px] tabular text-muted">{time(request.created_at)}</span>
      <span className="text-[13px] text-fg">{warranty(request.warranty_hours)}</span>
      <span className="flex flex-col gap-1.5"><span><StatusTag request={request} /></span><StepBar request={request} /></span>
      <span className="text-right"><PriceCell request={request} /></span>
      <span className="text-right"><RowAction request={request} /></span>
    </li>
  );
}

function MobileRow({ request }: { request: TakedownRequest }) {
  const t = useTranslations("takedown");
  const warranty = useWarrantyLabel();
  const serviceLabel = useServiceLabel();
  const time = useShortTime();
  return (
    <li className={cn("flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0", needsBuyer(request) && "bg-warn-soft/40")}>
      <LinkCell request={request} />
      <div className="flex flex-wrap items-center gap-2"><StatusTag request={request} /><span className="text-[12px] text-muted">{serviceLabel(request.service)}</span></div>
      <StepBar request={request} />
      <dl className="grid grid-cols-3 gap-2 text-[12px]">
        <div><dt className="text-faint">{t("list.colCreated")}</dt><dd className="font-mono text-fg">{time(request.created_at)}</dd></div>
        <div><dt className="text-faint">{t("list.colWarranty")}</dt><dd className="text-fg">{warranty(request.warranty_hours)}</dd></div>
        <div><dt className="text-faint">{t("list.colPrice")}</dt><dd><PriceCell request={request} /></dd></div>
      </dl>
      <div><RowAction request={request} /></div>
    </li>
  );
}
