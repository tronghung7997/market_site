"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { useWalletBalance, useWalletLedger } from "@/hooks/use-wallet";
import type { Transaction, WalletLedgerPage, WalletLedgerQuery } from "@/lib/types";
import { productPath } from "@/lib/routes";
import { TX_TYPES, txKind, txNote, txOrderHref, type TxKind } from "@/lib/tx-kind";
import { orderedDateRange } from "@/lib/date-input";
import { usePageClamp } from "@/lib/hooks/usePageClamp";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { useDelayedFlag } from "@/lib/hooks/useDelayedFlag";
import { cn } from "@/lib/cn";
import { ActivityBar, Button, Card, Input, Pagination, Select, Skeleton, Tag, buttonClass } from "@/components/ui";
import { DateInput } from "@/components/ui/DateInput";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertCircle, ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, ChevronRight, Copy, Inbox, Minus, Search, X,
} from "lucide-react";
import {
  DEFAULT_TX_VIEW, hasTxFilters, kindsOfGroup, matchesWordStarts, parseTxView, periodBounds,
  TX_CHANNELS, TX_GROUPS, TX_PERIODS, txChannel, txGroup, txLabelKey, txState, txViewToSearch,
  type TxView,
} from "@/features/wallet-ledger/model";

const PER_PAGE = 20;

function useLedgerText() {
  const t = useTranslations("transactions");
  const label = useCallback((tx: Transaction) => t(`label.${txLabelKey(tx)}`), [t]);
  const state = useCallback((tx: Transaction) => t(`state.${txState(tx).key}`), [t]);
  /** Ledger types whose label matches every word of `q` — the server cannot
   *  search translated labels, so it is told which types they name. */
  const labelTypes = useCallback((q: string) => {
    if (!q.trim()) return [];
    return TX_TYPES.filter((type) => {
      const names = type === "deposit" ? [t("label.deposit_bank"), t("label.deposit_usdt")] : [t(`label.${txLabelKey({ type, description: null, reference_id: null })}`)];
      return names.some((name) => matchesWordStarts(name, q));
    });
  }, [t]);
  return { t, label, state, labelTypes };
}

export default function TransactionsPage() {
  const { t, label, state, labelTypes } = useLedgerText();
  const locale = useLocale();
  const router = useRouter();
  const { account, loading: authLoading } = useAuth();
  const ready = !authLoading && !!account;
  const isSeller = !!account?.roles.includes("seller");
  const balanceQ = useWalletBalance(ready);

  // The view lives in the URL (?q=&group=&kind=&dir=&open=&channel=&period=&page=)
  // so opening an order and pressing Back returns to the same list. Read after
  // mount: the server render has no URL state.
  const [view, setView] = useState<TxView>(DEFAULT_TX_VIEW);
  const [viewLoaded, setViewLoaded] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (!authLoading && !account) router.push("/login?next=%2Ftransactions");
  }, [account, authLoading, router]);
  useEffect(() => {
    setView(parseTxView(new URLSearchParams(window.location.search)));
    setViewLoaded(true);
  }, []);
  useEffect(() => {
    if (!viewLoaded) return;
    const next = `${window.location.pathname}${txViewToSearch(view)}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [view, viewLoaded]);

  /** A filter change starts over at page 1. */
  const patch = useCallback((change: Partial<TxView>) => setView((v) => ({ ...v, page: 1, ...change })), []);

  // Filtered, summed and paged on the server; typing waits for a pause.
  const q = useDebounce(view.q.trim(), 300);
  const params = useMemo<WalletLedgerQuery>(() => {
    const { start, end } = periodBounds(view, now);
    return {
      group: view.group === "all" ? undefined : view.group,
      kind: view.kind === "all" ? undefined : view.kind,
      dir: view.dir === "all" ? undefined : view.dir,
      open: view.open || undefined,
      channel: view.channel === "all" ? undefined : view.channel,
      start: start?.toISOString(),
      end: end?.toISOString(),
      q: q || undefined,
      qTypes: q ? labelTypes(q) : undefined,
      page: view.page,
      perPage: PER_PAGE,
    };
  }, [view, now, q, labelTypes]);
  const txQ = useWalletLedger(params, ready && viewLoaded);
  const data: WalletLedgerPage | undefined = txQ.data;
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  usePageClamp(view.page, data ? total : null, PER_PAGE, (page) => setView((v) => ({ ...v, page })));
  const refreshing = useDelayedFlag(txQ.isFetching && !txQ.isPending);
  const filtering = hasTxFilters(view);
  const presentGroups = new Set(data?.present.groups ?? []);
  const presentKinds = new Set(data?.present.kinds ?? []);
  const presentChannels = new Set(data?.present.channels ?? []);

  if (authLoading || !account || !viewLoaded || (txQ.isPending && !txQ.isError)) return <LedgerSkeleton />;

  const groupTabs = TX_GROUPS.filter((g) => g === view.group || presentGroups.has(g) || (g === "sell" && isSeller));
  const kindOptions = kindsOfGroup(view.group).filter((k) => presentKinds.has(k) || k === view.kind);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href="/wallet" className="mb-2 inline-flex items-center gap-1.5 rounded text-[12.5px] font-medium text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t("backWallet")}
          </Link>
          <h1 className="font-serif text-[26px] font-semibold tracking-[-.01em] text-fg sm:text-[30px]">{t("title")}</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isSeller && <Link href="/seller/withdrawals" className={buttonClass({ variant: "secondary" })}>{t("withdraw")}</Link>}
          <Link href="/wallet" className={buttonClass({ variant: "primary" })}>{t("topUp")}</Link>
        </div>
      </header>

      <BalanceSummary
        wallet={balanceQ.data}
        failed={balanceQ.isError}
        onRetry={() => void balanceQ.refetch()}
        isSeller={isSeller}
        onShowHeld={() => setView({ ...DEFAULT_TX_VIEW, group: "buy", kind: "purchase", open: true })}
      />

      <Card className="mt-5 overflow-hidden">
        <div className="space-y-3 border-b border-line p-4 sm:p-5">
          <div role="tablist" aria-label={t("groupsLabel")} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
            {(["all", ...groupTabs] as const).map((g) => {
              const active = view.group === g;
              return (
                <button
                  key={g}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => patch({ group: g, kind: g === "all" || (view.kind !== "all" && txGroup(kindType(view.kind)) === g) ? view.kind : "all" })}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                    active ? "bg-fg text-surface" : "text-muted hover:bg-raised hover:text-fg",
                  )}
                >
                  {t(`group.${g}`)}
                  <span className={cn("rounded px-1.5 font-mono text-[11px] tabular", active ? "bg-surface/20" : "bg-raised text-faint")}>
                    {(data?.group_counts[g] ?? 0).toLocaleString(locale)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
              <Input
                type="search"
                value={view.q}
                onChange={(e) => patch({ q: e.target.value.slice(0, 80) })}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchLabel")}
                className="pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
              />
              {view.q && (
                <button type="button" onClick={() => patch({ q: "" })} aria-label={t("clearSearch")} className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-faint hover:bg-raised hover:text-fg">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
            <Select value={view.period} onChange={(e) => patch({ period: e.target.value as TxView["period"] })} aria-label={t("periodLabel")} className="w-auto min-w-[9.5rem] pr-8">
              {TX_PERIODS.map((p) => <option key={p} value={p}>{t(`period.${p}`)}</option>)}
            </Select>
            {view.period === "custom" && (
              <span className="flex items-center gap-1.5">
                <DateInput value={view.from} onCommit={(from) => patch(orderedDateRange(from, view.to))} aria-label={t("from")} className="h-10 w-auto" />
                <span className="text-faint" aria-hidden>→</span>
                <DateInput value={view.to} onCommit={(to) => patch(orderedDateRange(view.from, to))} aria-label={t("to")} className="h-10 w-auto" />
              </span>
            )}
            {kindOptions.length > 1 && (
              <Select value={view.kind} onChange={(e) => patch({ kind: e.target.value as TxKind | "all" })} aria-label={t("kindLabel")} className="w-auto min-w-[10rem] pr-8">
                <option value="all">{t("kindAll")}</option>
                {kindOptions.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
              </Select>
            )}
            <Select value={view.dir} onChange={(e) => patch({ dir: e.target.value as TxView["dir"] })} aria-label={t("dirLabel")} className="w-auto min-w-[8.5rem] pr-8">
              {(["all", "in", "out"] as const).map((d) => <option key={d} value={d}>{t(`dir.${d}`)}</option>)}
            </Select>
            {(presentChannels.size > 1 || view.channel !== "all") && (
              <Select value={view.channel} onChange={(e) => patch({ channel: e.target.value as TxView["channel"] })} aria-label={t("channelLabel")} className="w-auto min-w-[8.5rem] pr-8">
                <option value="all">{t("channelAll")}</option>
                {TX_CHANNELS.map((c) => <option key={c} value={c}>{t(`channel.${c}`)}</option>)}
              </Select>
            )}
            <button
              type="button"
              aria-pressed={view.open}
              onClick={() => patch({ open: !view.open })}
              title={t("openOnlyHint")}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                view.open ? "border-warn/40 bg-warn-soft text-warn" : "border-line bg-surface text-muted hover:text-fg",
              )}
            >
              {view.open && <Check className="h-3.5 w-3.5" aria-hidden />}
              {t("openOnly")}
              <span className="font-mono text-[11px] tabular">{(data?.open_total ?? 0).toLocaleString(locale)}</span>
            </button>
            {filtering && (
              <Button variant="ghost" onClick={() => setView(DEFAULT_TX_VIEW)} className="h-10 gap-1.5">
                <X className="h-3.5 w-3.5" aria-hidden /> {t("clear")}
              </Button>
            )}
          </div>

          {data && <FilterSummary scoped={filtering} summary={data.summary} />}
        </div>

        {txQ.isError && !data ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" role="alert">
            <AlertCircle className="h-7 w-7 text-bad" aria-hidden />
            <p className="text-[13px] text-muted">{t("loadFailed")}</p>
            <Button variant="secondary" size="sm" onClick={() => void txQ.refetch()}>{t("retry")}</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-raised text-faint"><Inbox className="h-6 w-6" aria-hidden /></span>
            <h2 className="mt-3 text-[15px] font-semibold text-fg">{filtering ? t("empty") : t("emptyNoneTitle")}</h2>
            <p className="mt-1 max-w-sm text-[13px] text-muted">{filtering ? t("emptyFilteredHint") : t("emptyNone")}</p>
            {filtering ? (
              <Button variant="secondary" size="sm" onClick={() => setView(DEFAULT_TX_VIEW)} className="mt-4 gap-1.5"><X className="h-3.5 w-3.5" aria-hidden /> {t("clear")}</Button>
            ) : (
              <Link href="/wallet" className={cn(buttonClass({ variant: "primary", size: "sm" }), "mt-4")}>{t("topUp")}</Link>
            )}
          </div>
        ) : (
          <div className="relative">
            <ActivityBar active={txQ.isFetching && !txQ.isPending} label={t("refreshing")} />
            {txQ.isError && (
              <div role="alert" className="flex items-center justify-between gap-3 border-b border-line bg-bad-soft px-4 py-2.5 text-[12.5px] text-bad sm:px-5">
                {t("loadFailed")}
                <Button variant="secondary" size="sm" onClick={() => void txQ.refetch()}>{t("retry")}</Button>
              </div>
            )}
            <div className={cn("transition-opacity duration-200", refreshing && "pointer-events-none opacity-55")}>
              <LedgerTable rows={rows} label={label} state={state} onOpen={setSelected} />
              <LedgerList rows={rows} label={label} state={state} onOpen={setSelected} />
            </div>
            <div className="flex flex-col gap-3 border-t border-line px-4 py-3.5 text-[12.5px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <span>{t("range", { from: (view.page - 1) * PER_PAGE + 1, to: Math.min(view.page * PER_PAGE, total), total })}</span>
              <Pagination page={view.page} totalPages={totalPages} onChange={(page) => setView((v) => ({ ...v, page }))} />
            </div>
          </div>
        )}
      </Card>

      <TxDetailDialog
        tx={selected}
        label={label}
        state={state}
        onSelect={setSelected}
        onClose={() => setSelected(null)}
        onFilterOrder={(code) => { setSelected(null); setView({ ...DEFAULT_TX_VIEW, q: code }); }}
      />
    </div>
  );
}

/** Any ledger type of a kind, to find the kind's group. */
function kindType(kind: TxKind): string {
  return ({ topup: "deposit", purchase: "purchase_hold", sale: "purchase_release", refund: "refund", affiliate: "affiliate_commission", withdraw: "withdraw", adjustment: "adjustment_credit" } as const)[kind];
}

function LedgerSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-10" aria-busy="true">
      <Skeleton className="h-3.5 w-16" />
      <Skeleton className="mt-3 h-8 w-64 max-w-full" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <Skeleton className="mt-6 h-24 w-full rounded-card" />
      <Card className="mt-5 space-y-3 p-5">
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </Card>
    </div>
  );
}

function BalanceSummary({ wallet, failed, onRetry, isSeller, onShowHeld }: {
  wallet: { available_balance: number; escrow_paid: number; escrow_incoming: number; locked_balance: number } | undefined;
  failed: boolean;
  onRetry: () => void;
  isSeller: boolean;
  onShowHeld: () => void;
}) {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  if (failed) {
    return (
      <Card className="flex items-center justify-between gap-3 p-4 text-[13px] text-muted" role="alert">
        <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-bad" aria-hidden /> {t("balance.loadFailed")}</span>
        <Button variant="secondary" size="sm" onClick={onRetry}>{t("retry")}</Button>
      </Card>
    );
  }
  if (!wallet) return <Skeleton className="h-24 w-full rounded-card" />;
  const parts: { key: string; value: number; hint: string; action?: React.ReactNode }[] = [
    { key: "available", value: wallet.available_balance, hint: t("balance.availableHint") },
  ];
  if (wallet.escrow_paid > 0) {
    parts.push({
      key: "escrowPaid", value: wallet.escrow_paid, hint: t("balance.escrowPaidHint"),
      action: <button type="button" onClick={onShowHeld} className="text-[12px] font-medium text-iris hover:underline">{t("balance.showHeld")}</button>,
    });
  }
  if (isSeller || wallet.escrow_incoming > 0) {
    parts.push({
      key: "escrowIncoming", value: wallet.escrow_incoming, hint: t("balance.escrowIncomingHint"),
      action: <Link href="/seller/orders" className="text-[12px] font-medium text-iris hover:underline">{t("balance.showSalesWaiting")}</Link>,
    });
  }
  if (isSeller || wallet.locked_balance > 0) {
    parts.push({
      key: "locked", value: wallet.locked_balance, hint: t("balance.lockedHint"),
      action: isSeller ? <Link href="/seller/withdrawals" className="text-[12px] font-medium text-iris hover:underline">{t("balance.showWithdrawals")}</Link> : undefined,
    });
  }
  return (
    <Card className={cn("grid gap-px overflow-hidden bg-line", BALANCE_COLS[parts.length])} aria-label={t("balance.label")}>
      {parts.map((part, i) => (
        <div key={part.key} className="flex min-w-0 flex-col gap-1 bg-card p-4 sm:p-5">
          <span className="text-[12.5px] font-medium text-muted">{t(`balance.${part.key}`)}</span>
          <span className={cn("font-mono tabular font-semibold tracking-tight text-fg", i === 0 ? "text-[24px]" : "text-[19px]")}>
            {formatBrowseMoney(part.value, { locale })}
          </span>
          <span className="text-[12px] leading-snug text-muted">{part.hint}</span>
          {part.action && <span className="mt-0.5">{part.action}</span>}
        </div>
      ))}
    </Card>
  );
}

const BALANCE_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

function FilterSummary({ scoped, summary }: { scoped: boolean; summary: WalletLedgerPage["summary"] }) {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const money = (n: number) => formatBrowseMoney(n, { locale });
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px] text-muted">
      <span className="font-medium text-fg">{scoped ? t("summary.scopeFiltered") : t("summary.scopeAll")}: {t("summary.count", { count: summary.count.toLocaleString(locale) })}</span>
      <span>{t("summary.in")} <b className={cn("font-mono font-semibold tabular", summary.in > 0 ? "text-good" : "text-fg")}>{summary.in > 0 ? "+" : ""}{money(summary.in)}</b></span>
      <span>{t("summary.out")} <b className={cn("font-mono font-semibold tabular", summary.out > 0 ? "text-bad" : "text-fg")}>{summary.out > 0 ? "−" : ""}{money(summary.out)}</b></span>
      <span title={t("summary.netHint")}>
        {t("summary.net")}{" "}
        <b className={cn("font-mono font-semibold tabular", summary.net > 0 ? "text-good" : summary.net < 0 ? "text-bad" : "text-fg")}>
          {summary.net > 0 ? "+" : summary.net < 0 ? "−" : ""}{money(Math.abs(summary.net))}
        </b>
      </span>
    </p>
  );
}

function DirectionIcon({ tx, className }: { tx: Transaction; className?: string }) {
  const Icon = tx.direction === "in" ? ArrowDownLeft : tx.direction === "out" ? ArrowUpRight : Minus;
  return (
    <span className={cn(
      "grid shrink-0 place-items-center rounded-lg",
      tx.direction === "in" ? "bg-good-soft text-good" : tx.direction === "out" ? "bg-bad-soft text-bad" : "bg-raised text-muted",
      className,
    )}>
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

function Amount({ tx, className }: { tx: Transaction; className?: string }) {
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const sign = tx.direction === "in" ? "+" : tx.direction === "out" ? "−" : "";
  return (
    <span className={cn("font-mono font-semibold tabular whitespace-nowrap", tx.direction === "in" ? "text-good" : tx.direction === "out" ? "text-bad" : "text-muted", className)}>
      {sign}{formatBrowseMoney(tx.amount, { locale })}
    </span>
  );
}

/** Second line of a row: the note, or what a sale was net of. */
function useRowDetail() {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  return (tx: Transaction): string | null => {
    if (tx.type === "purchase_release" && tx.fee_amount) return t("detail.netOfFee", { fee: formatBrowseMoney(tx.fee_amount, { locale }) });
    return txNote(tx.description);
  };
}

function useDateParts() {
  const locale = useLocale();
  const loc = locale === "vi" ? "vi-VN" : "en-US";
  return (iso: string) => {
    const d = new Date(iso);
    return {
      day: d.toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "numeric" }),
      time: d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }),
    };
  };
}

function LedgerTable({ rows, label, state, onOpen }: {
  rows: Transaction[]; label: (tx: Transaction) => string; state: (tx: Transaction) => string; onOpen: (tx: Transaction) => void;
}) {
  const t = useTranslations("transactions");
  const detail = useRowDetail();
  const date = useDateParts();
  return (
    <div className="hidden md:block">
      <table className="w-full table-fixed text-left text-[13px]">
        <colgroup>
          <col className="w-[120px]" /><col /><col className="w-[190px]" /><col className="w-[220px]" /><col className="w-[150px]" /><col className="w-12" />
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-raised/40 text-[12px] font-medium text-muted">
            <th scope="col" className="px-5 py-3 font-medium">{t("column.date")}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t("column.transaction")}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t("column.reference")}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t("column.status")}</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">{t("column.amount")}</th>
            <th scope="col"><span className="sr-only">{t("detail.open")}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((tx) => {
            const when = date(tx.created_at);
            const note = detail(tx);
            const st = txState(tx);
            return (
              <tr key={tx.id} onClick={() => onOpen(tx)} className="group cursor-pointer transition-colors hover:bg-raised/50">
                <td className="px-5 py-3.5 align-top">
                  <div className="font-mono text-[12.5px] tabular text-fg">{when.day}</div>
                  <div className="font-mono text-[12px] tabular text-muted">{when.time}</div>
                </td>
                <td className="px-4 py-3.5 align-top">
                  <div className="flex min-w-0 items-start gap-3">
                    <DirectionIcon tx={tx} className="mt-0.5 h-8 w-8" />
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-2 font-semibold text-fg">
                        <span className="truncate">{label(tx)}</span>
                        <HiddenOrderTag tx={tx} />
                      </p>
                      {note && <p className="mt-0.5 truncate text-[12px] text-muted" title={note}>{note}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 align-top">
                  {tx.reference_label ? <CopyCode value={tx.reference_label} /> : <span className="text-faint">—</span>}
                </td>
                <td className="px-4 py-3.5 align-top"><Tag tone={st.tone} className="whitespace-normal">{state(tx)}</Tag></td>
                <td className="px-4 py-3.5 text-right align-top"><Amount tx={tx} className="text-[14px]" /></td>
                <td className="py-3.5 pr-3 text-right align-top">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpen(tx); }}
                    aria-label={`${t("detail.open")}: ${label(tx)}`}
                    className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors group-hover:text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LedgerList({ rows, label, state, onOpen }: {
  rows: Transaction[]; label: (tx: Transaction) => string; state: (tx: Transaction) => string; onOpen: (tx: Transaction) => void;
}) {
  const detail = useRowDetail();
  const date = useDateParts();
  return (
    <ul className="divide-y divide-line md:hidden">
      {rows.map((tx) => {
        const when = date(tx.created_at);
        const note = detail(tx);
        return (
          <li key={tx.id}>
            <button type="button" onClick={() => onOpen(tx)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors active:bg-raised focus-visible:bg-raised focus-visible:outline-none">
              <DirectionIcon tx={tx} className="mt-0.5 h-9 w-9" />
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-[13.5px] font-semibold leading-snug text-fg">
                    {label(tx)} <HiddenOrderTag tx={tx} />
                  </span>
                  <Amount tx={tx} className="shrink-0 text-[14px]" />
                </span>
                {note && <span className="mt-0.5 block truncate text-[12px] text-muted">{note}</span>}
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <Tag tone={txState(tx).tone}>{state(tx)}</Tag>
                  <span className="font-mono tabular">{when.day} {when.time}</span>
                  {tx.reference_label && <span className="font-mono">{tx.reference_label}</span>}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CopyCode({ value }: { value: string }) {
  const t = useTranslations("transactions");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {});
      }}
      aria-label={copied ? t("detail.copied") : t("detail.copy", { value })}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-raised px-2 py-1 font-mono text-[12px] text-muted transition-colors hover:bg-iris-soft hover:text-iris-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
    >
      <span className="truncate">{value}</span>
      {copied ? <Check className="h-3 w-3 shrink-0 text-good" aria-hidden /> : <Copy className="h-3 w-3 shrink-0 opacity-70" aria-hidden />}
      <span className="sr-only" aria-live="polite">{copied ? t("detail.copied") : ""}</span>
    </button>
  );
}

function TxDetailDialog({ tx, label, state, onSelect, onClose, onFilterOrder }: {
  tx: Transaction | null;
  label: (tx: Transaction) => string;
  state: (tx: Transaction) => string;
  onSelect: (tx: Transaction) => void;
  onClose: () => void;
  onFilterOrder: (code: string) => void;
}) {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const loc = locale === "vi" ? "vi-VN" : "en-US";
  const { formatBrowseMoney } = useMoney();
  const money = (n: number) => formatBrowseMoney(n, { locale });
  const date = useDateParts();
  const orderHref = tx ? txOrderHref(tx) : null;
  const kind = tx ? txKind(tx.type) : null;
  // Only the buyer or seller of an order can open it; a commission points at someone else's.
  const orderQ = useQuery({
    queryKey: ["transaction-order-detail", tx?.order_code ?? null],
    queryFn: () => api.getOrder(tx!.order_code!),
    enabled: !!tx?.order_code && orderHref !== null,
    staleTime: 60_000,
    retry: false,
  });
  // The order's other rows (payment, refunds, payout, promo top-up), wherever they page.
  const sameOrderQ = useWalletLedger({ q: tx?.order_code ?? "", perPage: 50 }, !!tx?.order_code);
  if (!tx) return <Dialog open={false} />;

  const st = txState(tx);
  const explain = st.key === "credited" || st.key === "debited" || st.key === "settled"
    ? (t.has(`explain.type.${tx.type}`) ? t(`explain.type.${tx.type}`) : null)
    : t(`explain.${st.key}`);
  const siblings = (sameOrderQ.data?.items ?? []).filter((row) => row.id !== tx.id && row.order_code === tx.order_code);
  const note = txNote(tx.description);
  const channel = txChannel(tx);
  const order = orderQ.data ?? null;
  const orderTitle = kind === "sale" ? t("detail.orderSell") : kind === "affiliate" ? t("detail.orderReferred") : t("detail.orderBuy");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto border-line bg-card p-0 shadow-card-lg sm:rounded-card">
        <div className="p-5 sm:p-6">
          <DialogHeader className="text-left">
            <Tag tone={st.tone} className="w-fit">{state(tx)}</Tag>
            <DialogTitle className="mt-2 pr-8 text-[19px] font-semibold text-fg">{label(tx)}</DialogTitle>
            <DialogDescription className="text-[12.5px] text-muted">
              {new Date(tx.created_at).toLocaleString(loc, { dateStyle: "full", timeStyle: "short" })}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 rounded-card border border-line bg-raised/50 px-4 py-3.5">
            <Amount tx={tx} className="text-[24px]" />
            <p className="mt-0.5 text-[12.5px] text-muted">{t(`effect.${tx.direction}`)}</p>
          </div>

          {explain && <p className="mt-4 text-[13px] leading-relaxed text-fg">{explain}</p>}
          {tx.order_hidden && (
            <p className="mt-3 rounded-lg border border-line bg-raised/60 p-3 text-[12.5px] leading-relaxed text-muted">
              <HiddenOrderTag tx={tx} /> <span className="ml-1">{t("hiddenOrderHint")}</span>
            </p>
          )}

          {kind === "sale" && tx.type === "purchase_release" && (
            <section className="mt-4">
              <h3 className="text-[12.5px] font-medium text-muted">{t("detail.saleBreakdown")}</h3>
              <dl className="mt-2 space-y-1.5 text-[13px]">
                {order && <Line term={t("detail.customerPaid")} value={money(order.total_amount)} />}
                {order && (order.refunded_amount ?? 0) > 0 && <Line term={t("detail.refundedToCustomer")} value={`−${money(order.refunded_amount ?? 0)}`} />}
                <Line term={t("detail.platformFee")} value={tx.fee_amount ? `−${money(tx.fee_amount)}` : money(0)} />
                <Line term={t("detail.youReceived")} value={money(tx.amount)} strong />
              </dl>
            </section>
          )}

          {tx.order_code && (
            <section className="mt-4 rounded-card border border-line p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[12.5px] font-medium text-muted">{orderTitle}</h3>
                <CopyCode value={tx.order_code} />
              </div>
              {orderHref && (
                orderQ.isPending ? (
                  <p className="mt-2 text-[12.5px] text-muted">{t("detail.loadingOrder")}</p>
                ) : order ? (
                  <p className="mt-2 text-[13.5px] font-semibold leading-snug text-fg">
                    {order.product_title}
                    {order.variant_name && <span className="block text-[12.5px] font-normal text-muted">{order.variant_name} · ×{order.quantity}</span>}
                  </p>
                ) : (
                  <p className="mt-2 text-[12.5px] text-muted">{t("detail.orderUnavailable")}</p>
                )
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {orderHref && (
                  <Link href={orderHref} onClick={onClose} className={buttonClass({ variant: "primary", size: "sm" })}>
                    {kind === "sale" ? t("detail.viewSellOrder") : t("detail.viewBuyOrder")}
                  </Link>
                )}
                {order?.product_id != null && (
                  <Link href={productPath({ id: order.product_id, slug: order.product_slug, public_key: order.product_key })} onClick={onClose} className={buttonClass({ variant: "secondary", size: "sm" })}>
                    {t("detail.viewProduct")}
                  </Link>
                )}
                {kind === "affiliate" && (
                  <Link href="/affiliate" onClick={onClose} className={buttonClass({ variant: "secondary", size: "sm" })}>{t("detail.viewAffiliate")}</Link>
                )}
              </div>
              {siblings.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <h4 className="text-[12.5px] font-medium text-muted">{t("detail.sameOrder")}</h4>
                  <ul className="mt-1.5 space-y-1">
                    {siblings.map((row) => (
                      <li key={row.id}>
                        <button type="button" onClick={() => onSelect(row)} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
                          <span className="min-w-0">
                            <span className="block truncate text-fg">{label(row)}</span>
                            <span className="font-mono text-[11.5px] tabular text-muted">{date(row.created_at).day}</span>
                          </span>
                          <Amount tx={row} className="text-[13px]" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => onFilterOrder(tx.order_code!)} className="mt-2 text-[12.5px] font-medium text-iris hover:underline">
                    {t("detail.filterOrder")}
                  </button>
                </div>
              )}
            </section>
          )}

          <dl className="mt-4 space-y-2 text-[13px]">
            {tx.reference_label && tx.reference_label !== tx.order_code && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t("detail.reference")}</dt>
                <dd><CopyCode value={tx.reference_label} /></dd>
              </div>
            )}
            {channel && <Line term={t("detail.channel")} value={t(`channel.${channel}`)} />}
            {note && (
              <div>
                <dt className="text-muted">{t("detail.note")}</dt>
                <dd className="mt-1 rounded-lg bg-raised/70 p-2.5 text-[12.5px] leading-relaxed text-fg">{note}</dd>
              </div>
            )}
          </dl>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {txGroup(tx.type) === "funds" && kind === "withdraw" && (
              <Link href="/seller/withdrawals" onClick={onClose} className={buttonClass({ variant: "secondary", size: "sm" })}>{t("detail.viewWithdrawals")}</Link>
            )}
            <Button variant="secondary" size="sm" onClick={onClose}>{t("detail.close")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Line({ term, value, strong }: { term: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "border-t border-line pt-1.5")}>
      <dt className="text-muted">{term}</dt>
      <dd className={cn("font-mono tabular", strong ? "font-semibold text-fg" : "text-fg")}>{value}</dd>
    </div>
  );
}

/** A test order hidden from the order lists: its money row stays, labelled. */
function HiddenOrderTag({ tx }: { tx: Transaction }) {
  const t = useTranslations("transactions");
  if (!tx.order_hidden) return null;
  return <Tag tone="neutral" className="shrink-0 align-middle font-medium">{t("hiddenOrder")}</Tag>;
}
