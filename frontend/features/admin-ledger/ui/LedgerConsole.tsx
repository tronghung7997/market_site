"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import type { LedgerEntry, LedgerSuggestion, LedgerSummary } from "@/lib/types";
import { Button, Input, Select, Skeleton, Tag } from "@/components/ui";
import { ArrowRight, CheckCircle2, AlertTriangle, X } from "@/components/Icons";
import { useLedgerEntries, useLedgerGroup, useLedgerStatement, useLedgerSummary } from "../data";
import {
  ACTOR_LABEL, DIRECTIONS, PERIODS, ROLE_LABEL, TYPE_KEYS, apiParams, hasPinnedFilters, parseQuery,
  periodRange, queryToParams, typeLabel, vnToday, type LedgerQuery,
} from "../model";
import { Amount, GroupPanel } from "./GroupPanel";
import { SmartSearch } from "./SmartSearch";

/**
 * Tài chính › Dòng tiền: mọi đồng tiền vào/ra ở một chỗ. Chỉ đọc —
 * cộng/trừ tay vẫn làm ở hồ sơ tài khoản.
 */
export function LedgerConsole() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = React.useMemo(() => parseQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const setQuery = React.useCallback((patch: Partial<LedgerQuery>) => {
    const qs = queryToParams({ ...query, ...patch }).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, query, router]);

  // Mốc "bây giờ" giữ cố định trong phiên xem, để query key không đổi mỗi lần render.
  const [now] = React.useState(() => new Date());
  const params = React.useMemo(() => apiParams(query, now), [query, now]);
  const range = React.useMemo(() => periodRange(query, now), [query, now]);
  const { query: entriesQ, items } = useLedgerEntries(params);
  const summaryQ = useLedgerSummary(params);
  const statementQ = useLedgerStatement(query.account, range);
  const pinnedGroupQ = useLedgerGroup(query.group);
  const [openGroup, setOpenGroup] = React.useState<string | null>(null);

  const onPick = (s: LedgerSuggestion) => {
    setQuery({
      account: s.filter.account_id ?? null,
      group: s.filter.group ?? null,
      amount: s.filter.amount ?? null,
      entry: s.filter.entry_id ?? null,
    });
  };
  const clearAll = () => setQuery({ dir: null, types: [], role: null, account: null, group: null, amount: null, entry: null });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-[13px] text-muted">
          Mọi giao dịch làm thay đổi số dư: nạp, mua, giải ngân, hoàn, phí, rút, cộng/trừ tay. Chỉ xem — điều chỉnh ví làm ở hồ sơ tài khoản.
        </p>
        <SmartSearch onPick={onPick} />
      </div>

      <PeriodBar query={query} setQuery={setQuery} />

      <SummaryStrip scoped={hasPinnedFilters(query)} summary={summaryQ.data} loading={summaryQ.isLoading} error={summaryQ.isError} onType={(types) => setQuery({ types })} />

      {query.account !== null && (
        <StatementStrip
          loading={statementQ.isLoading}
          error={statementQ.isError}
          data={statementQ.data}
        />
      )}

      <div className="rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div role="radiogroup" aria-label="Chiều tiền" className="flex rounded-lg border border-line-2 bg-raised p-0.5">
            {DIRECTIONS.map((d) => (
              <button
                key={d.label}
                type="button"
                role="radio"
                aria-checked={query.dir === d.key}
                onClick={() => setQuery({ dir: d.key })}
                className={cn("rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors", query.dir === d.key ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg")}
              >
                {d.label}
              </button>
            ))}
          </div>
          <Select
            aria-label="Loại giao dịch"
            value={query.types.length === 1 ? query.types[0] : ""}
            onChange={(e) => setQuery({ types: e.target.value ? [e.target.value] : [] })}
            className="h-8 w-auto text-[12.5px]"
          >
            <option value="">{query.types.length > 1 ? `${query.types.length} loại` : "Mọi loại giao dịch"}</option>
            {TYPE_KEYS.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </Select>
          <Select
            aria-label="Vai trò ví"
            value={query.role ?? ""}
            onChange={(e) => setQuery({ role: (e.target.value || null) as LedgerQuery["role"] })}
            className="h-8 w-auto text-[12.5px]"
          >
            <option value="">Mọi ví</option>
            <option value="buyer">Ví người mua</option>
            <option value="seller">Ví người bán</option>
            <option value="platform">Ví sàn</option>
          </Select>
          <ActiveChips
            query={query}
            setQuery={setQuery}
            accountLabel={statementQ.data?.email}
            groupLabel={pinnedGroupQ.data?.header.label ?? undefined}
          />
          {hasPinnedFilters(query) && (
            <button type="button" onClick={clearAll} className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-muted hover:text-fg">
              <X size={13} /> Xoá lọc
            </button>
          )}
        </div>

        <EntriesTable
          items={items}
          loading={entriesQ.isLoading}
          error={entriesQ.isError}
          onRetry={() => entriesQ.refetch()}
          onOpenGroup={setOpenGroup}
          onFilterAccount={(id) => setQuery({ account: id })}
        />

        <div className="flex flex-col gap-2 border-t border-line px-4 py-3 text-[12.5px] sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted">
            {summaryQ.data ? (
              <>
                Bộ lọc hiện tại: <b className="text-fg tabular-nums">{summaryQ.data.filtered_count.toLocaleString("vi-VN")}</b> giao dịch ·
                vào <span className="font-mono tabular-nums text-good">+{vnd(summaryQ.data.filtered_in)}</span> ·
                ra <span className="font-mono tabular-nums text-bad">−{vnd(summaryQ.data.filtered_out)}</span>
              </>
            ) : " "}
          </span>
          <span className="flex items-center gap-3">
            <span className="text-muted">Đang hiện {items.length.toLocaleString("vi-VN")} dòng</span>
            {entriesQ.hasNextPage && (
              <Button variant="secondary" size="sm" loading={entriesQ.isFetchingNextPage} onClick={() => entriesQ.fetchNextPage()}>
                Tải thêm
              </Button>
            )}
          </span>
        </div>
      </div>

      <GroupPanel
        groupKey={openGroup}
        onClose={() => setOpenGroup(null)}
        onFilterGroup={(key) => setQuery({ group: key, account: null, amount: null, entry: null })}
        onFilterAccount={(id) => setQuery({ account: id, group: null, entry: null })}
      />
    </div>
  );
}

function PeriodBar({ query, setQuery }: { query: LedgerQuery; setQuery: (p: Partial<LedgerQuery>) => void }) {
  const today = vnToday();
  const pinned = query.group !== null || query.entry !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Kỳ" className="flex flex-wrap rounded-lg border border-line-2 bg-surface p-0.5">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={query.period === p.key}
            onClick={() => setQuery(p.key === "custom" ? { period: "custom", from: query.from ?? today, to: query.to ?? today } : { period: p.key })}
            className={cn("rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors", query.period === p.key ? "bg-fg text-surface" : "text-muted hover:text-fg")}
          >
            {p.label}
          </button>
        ))}
      </div>
      {query.period === "custom" && (
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <label className="sr-only" htmlFor="ledger-from">Từ ngày</label>
          <Input id="ledger-from" type="date" max={today} value={query.from ?? ""} onChange={(e) => setQuery({ from: e.target.value || null })} className="h-8 w-[150px] text-[12.5px]" />
          <span aria-hidden>→</span>
          <label className="sr-only" htmlFor="ledger-to">Đến ngày</label>
          <Input id="ledger-to" type="date" max={today} min={query.from ?? undefined} value={query.to ?? ""} onChange={(e) => setQuery({ to: e.target.value || null })} className="h-8 w-[150px] text-[12.5px]" />
        </div>
      )}
      {pinned && <span className="text-[12px] text-muted">Đang xem một sự kiện cụ thể — bỏ qua kỳ.</span>}
    </div>
  );
}

function Metric({ label, value, hint, onClick }: { label: string; value: string; hint?: React.ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-mono text-[17px] tabular-nums text-fg">{value}</div>
      {hint && <div className="mt-0.5 text-[11.5px] text-muted">{hint}</div>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="px-4 py-3 text-left transition-colors hover:bg-raised focus-visible:bg-raised">{body}</button>
  ) : <div className="px-4 py-3">{body}</div>;
}

/** Một bề mặt chia ô (DESIGN §10) thay vì nhiều thẻ số rời. */
function SummaryStrip({ summary: s, loading, error, onType, scoped }: {
  summary?: LedgerSummary; loading: boolean; error: boolean; onType: (types: string[]) => void; scoped: boolean;
}) {
  const inPeriod = scoped ? "trong kỳ · theo bộ lọc" : "trong kỳ";
  if (error) return <div className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-bad">Không tải được số tổng hợp.</div>;
  if (loading || !s) return <Skeleton className="h-[150px] rounded-xl" />;
  const t = (k: string) => s.by_type[k]?.amount ?? 0;
  const flow: { label: string; types: string[]; amount: number }[] = [
    { label: "Nạp + cộng tay", types: ["deposit", "topup", "adjustment_credit"], amount: t("deposit") + t("topup") + t("adjustment_credit") },
    { label: "Giữ tiền đơn", types: ["purchase_hold"], amount: t("purchase_hold") },
    { label: "Giải ngân seller", types: ["purchase_release", "promo_subsidy"], amount: t("purchase_release") + t("promo_subsidy") },
    { label: "Rút đã chi", types: ["withdraw"], amount: t("withdraw") },
  ];
  const side: { label: string; types: string[]; amount: number }[] = [
    { label: "Hoàn về ví mua", types: ["refund"], amount: t("refund") },
    { label: "Phí sàn", types: ["platform_fee"], amount: t("platform_fee") },
    { label: "Hoa hồng", types: ["affiliate_commission"], amount: t("affiliate_commission") },
    { label: "Trừ tay", types: ["adjustment_debit"], amount: t("adjustment_debit") },
  ];
  const run = s.last_reconcile;
  return (
    <section aria-label="Tổng hợp" className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-2 divide-line md:grid-cols-3 xl:grid-cols-6 [&>*]:border-b [&>*]:border-line xl:[&>*]:border-b-0 xl:divide-x">
        <Metric label="Tiền vào sàn" value={vnd(s.money_in)} hint={`Nạp, cộng tay, hoa hồng, bù KM · ${inPeriod}`} />
        <Metric label="Tiền ra sàn" value={vnd(s.money_out)} hint={`Rút đã chi, trừ tay · ${inPeriod}`} />
        <Metric label="Doanh thu sàn" value={vnd(s.platform_revenue)} hint={`Phí đơn + phí rút · ${inPeriod}`} onClick={() => onType(["platform_fee"])} />
        <Metric label="Ví người dùng" value={vnd(s.user_available)} hint="Khả dụng · hiện tại" />
        <Metric label="Đang giữ escrow" value={vnd(s.escrow_open_amount)} hint={`${s.escrow_open_orders.toLocaleString("vi-VN")} đơn chưa giải ngân`} />
        <Metric label="Khoá chờ rút" value={vnd(s.locked)} hint={`${s.pending_withdrawals.toLocaleString("vi-VN")} lệnh chờ duyệt`} onClick={() => onType(["withdraw_lock"])} />
      </div>
      <div className="flex flex-col gap-3 border-t border-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          {flow.map((step, i) => (
            <React.Fragment key={step.label}>
              {i > 0 && <ArrowRight size={13} className="text-faint" aria-hidden />}
              <FlowChip {...step} onClick={() => onType(step.types)} />
            </React.Fragment>
          ))}
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          {side.filter((x) => x.amount > 0).map((step) => <FlowChip key={step.label} {...step} onClick={() => onType(step.types)} />)}
        </div>
        {run ? (
          <Link href="/admin/alerts" className={cn("inline-flex shrink-0 items-center gap-1.5 text-[12px]", run.ok ? "text-good" : "text-bad")}>
            {run.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {run.ok ? "Sổ khớp" : `${run.mismatch_count} chỗ lệch`} · đối soát {formatDateTime(run.ran_at, "vi")}
          </Link>
        ) : <span className="text-[12px] text-muted">Chưa có lần đối soát nào</span>}
      </div>
    </section>
  );
}

function FlowChip({ label, amount, onClick }: { label: string; amount: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border border-line-2 bg-raised px-2 py-1 hover:border-faint">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums text-fg">{vnd(amount)}</span>
    </button>
  );
}

function StatementStrip({ data, loading, error }: { data?: import("@/lib/types").LedgerStatement; loading: boolean; error: boolean }) {
  if (error) return <div className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-bad">Không tải được sổ của tài khoản này.</div>;
  if (loading || !data) return <Skeleton className="h-[86px] rounded-xl" />;
  const cell = "px-4 py-3";
  return (
    <section aria-label={`Sổ của ${data.email}`} className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-[12.5px]">
        <span>
          Sổ của <Link href={`/admin/accounts/${data.account_id}`} className="font-medium text-iris-hi hover:underline">{data.email}</Link>
          <Tag className="ml-2">{ROLE_LABEL[data.role]}</Tag>
        </span>
        <span className="text-muted">
          Giữ trong escrow: <span className="font-mono tabular-nums text-fg">{vnd(data.escrow_open_amount)}</span> ({data.escrow_open_orders} đơn) ·
          Khoá chờ rút: <span className="font-mono tabular-nums text-fg">{vnd(data.locked_now)}</span>
        </span>
      </div>
      <div className="grid grid-cols-2 items-center sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        <div className={cell}><div className="text-[11px] text-muted">Số dư đầu kỳ</div><div className="font-mono tabular-nums text-fg">{vnd(data.opening)}</div></div>
        <span className="hidden text-muted sm:block" aria-hidden>+</span>
        <div className={cell}><div className="text-[11px] text-muted">Tiền vào</div><div className="font-mono tabular-nums text-good">{vnd(data.money_in)}</div></div>
        <span className="hidden text-muted sm:block" aria-hidden>−</span>
        <div className={cell}><div className="text-[11px] text-muted">Tiền ra</div><div className="font-mono tabular-nums text-bad">{vnd(data.money_out)}</div></div>
        <span className="hidden text-muted sm:block" aria-hidden>=</span>
        <div className={cell}>
          <div className="text-[11px] text-muted">Số dư cuối kỳ</div>
          <div className="font-mono font-semibold tabular-nums text-fg">{vnd(data.closing)}</div>
          {data.matches_wallet === true && <div className="mt-0.5 flex items-center gap-1 text-[11px] text-good"><CheckCircle2 size={12} /> khớp số dư ví</div>}
          {data.matches_wallet === false && <div className="mt-0.5 flex items-center gap-1 text-[11px] text-bad"><AlertTriangle size={12} /> lệch số dư ví ({vnd(data.available_now)})</div>}
        </div>
      </div>
    </section>
  );
}

function ActiveChips({ query, setQuery, accountLabel, groupLabel }: {
  query: LedgerQuery; setQuery: (p: Partial<LedgerQuery>) => void; accountLabel?: string; groupLabel?: string;
}) {
  const chips: { key: string; label: string; clear: Partial<LedgerQuery> }[] = [];
  if (query.account) chips.push({ key: "account", label: accountLabel ?? `Tài khoản #${query.account}`, clear: { account: null } });
  if (query.group) chips.push({ key: "group", label: groupLabel ?? query.group, clear: { group: null } });
  if (query.amount) chips.push({ key: "amount", label: `Số tiền ${vnd(query.amount)}`, clear: { amount: null } });
  if (query.entry) chips.push({ key: "entry", label: `Giao dịch #${query.entry}`, clear: { entry: null } });
  if (query.types.length > 1) chips.push({ key: "types", label: query.types.map((t) => typeLabel(t)).join(" + "), clear: { types: [] } });
  return (
    <>
      {chips.map((c) => (
        <span key={c.key} className="inline-flex h-8 max-w-[260px] items-center gap-1 rounded-lg border border-iris/30 bg-iris-soft pl-2.5 text-[12.5px] text-iris-hi">
          <span className="truncate">{c.label}</span>
          <button type="button" onClick={() => setQuery(c.clear)} aria-label={`Bỏ lọc ${c.label}`} className="inline-flex h-8 w-7 items-center justify-center rounded-r-lg hover:bg-iris/10">
            <X size={12} />
          </button>
        </span>
      ))}
    </>
  );
}

const COLS = "md:grid md:grid-cols-[112px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_120px_120px_120px_72px] md:items-center md:gap-3";

function EntriesTable({ items, loading, error, onRetry, onOpenGroup, onFilterAccount }: {
  items: LedgerEntry[]; loading: boolean; error: boolean; onRetry: () => void;
  onOpenGroup: (key: string) => void; onFilterAccount: (id: number) => void;
}) {
  if (error) {
    return (
      <div className="space-y-3 px-4 py-10 text-center">
        <p className="text-[13px] text-bad">Không tải được danh sách giao dịch.</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>Thử lại</Button>
      </div>
    );
  }
  if (loading) return <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>;
  if (items.length === 0) return <p className="px-4 py-10 text-center text-[13px] text-muted">Không có giao dịch nào khớp bộ lọc trong kỳ này.</p>;
  return (
    <div role="table" aria-label="Giao dịch">
      <div role="row" className={cn("hidden border-b border-line bg-raised px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted", COLS)}>
        <span role="columnheader">Thời gian</span>
        <span role="columnheader">Tài khoản</span>
        <span role="columnheader">Loại</span>
        <span role="columnheader">Sự kiện</span>
        <span role="columnheader" className="text-right">Vào</span>
        <span role="columnheader" className="text-right">Ra</span>
        <span role="columnheader" className="text-right">Số dư sau</span>
        <span role="columnheader">Bởi</span>
      </div>
      {items.map((e) => (
        <div key={e.id} role="row" className={cn("grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-line px-4 py-2.5 text-[12.5px] last:border-b-0", COLS)}>
          <span role="cell" className="order-3 text-[11.5px] tabular-nums text-muted md:order-none md:text-[12.5px]">{formatDateTime(e.created_at, "vi")}</span>
          <span role="cell" className="order-1 min-w-0 md:order-none">
            {e.account_role === "platform" ? (
              <span className="text-fg">Ví sàn</span>
            ) : (
              <button type="button" onClick={() => onFilterAccount(e.account_id)} title="Xem sổ của tài khoản này" className="max-w-full truncate text-left text-fg hover:text-iris-hi hover:underline">
                {e.account_email}
              </button>
            )}
          </span>
          <span role="cell" className="order-4 min-w-0 md:order-none">
            <span className="text-fg">{typeLabel(e.type, e.actor)}</span>
            {e.actor === "admin" && e.description && <span className="block truncate text-[11.5px] text-muted" title={e.description}>{e.description}</span>}
            {e.proof_count > 0 && <span className="block text-[11px] text-muted">{e.proof_count} ảnh chứng từ</span>}
          </span>
          <span role="cell" className="order-5 min-w-0 md:order-none">
            {e.group ? (
              <button type="button" onClick={() => onOpenGroup(e.group!)} className="max-w-full truncate font-mono text-[12px] text-iris-hi hover:underline">
                {e.group_label ?? e.group}
              </button>
            ) : <span className="text-faint">—</span>}
          </span>
          <span role="cell" className="order-2 text-right md:order-none">
            {e.direction === "in" ? <Amount direction="in" amount={e.amount} /> : e.direction === "neutral" ? <Amount direction="neutral" amount={e.amount} className="md:hidden" /> : null}
            {e.direction === "out" && <Amount direction="out" amount={e.amount} className="md:hidden" />}
          </span>
          <span role="cell" className="hidden text-right md:block">
            {e.direction === "out" ? <Amount direction="out" amount={e.amount} /> : e.direction === "neutral" ? <Amount direction="neutral" amount={e.amount} /> : null}
          </span>
          <span role="cell" className="hidden text-right font-mono tabular-nums text-muted md:block">{e.balance_after !== null ? vnd(e.balance_after) : "—"}</span>
          <span role="cell" className="hidden text-muted md:block">{ACTOR_LABEL[e.actor]}</span>
        </div>
      ))}
    </div>
  );
}
