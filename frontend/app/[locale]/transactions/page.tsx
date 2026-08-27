"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { useWalletBalance, useWalletTransactions } from "@/hooks/use-wallet";
import type { Transaction } from "@/lib/types";
import {
  Button,
  Card,
  Spinner,
  Tag,
  Pagination,
} from "@/components/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Search,
  X,
  Wallet,
  Receipt,
  Copy,
  Check,
  ArrowLeft,
  SlidersHorizontal,
  ChevronRight,
  Inbox,
  Package,
} from "lucide-react";

type Filter = "all" | "in" | "out" | "pending";

function providerFor(tx: Transaction): string {
  const text = `${tx.description ?? ""} ${tx.reference_id ?? ""}`.toLowerCase();
  if (text.includes("nowpayments") || text.includes("now-") || text.includes("usdt")) return "NOWPayments";
  if (
    text.includes("sepay") ||
    text.includes("sbe") ||
    text.includes("chuyển khoản") ||
    text.includes("bank") ||
    text.includes("payos")
  ) {
    return "SePay";
  }
  if (tx.type.startsWith("purchase")) return "Marketplace";
  return "Marketplace";
}

function isPending(tx: Transaction): boolean {
  return (
    ["pending", "processing", "delivered", "disputed"].includes(tx.order_status ?? "") ||
    tx.type === "withdraw_lock"
  );
}

function extractOrderId(tx: Transaction): number | null {
  if (tx.reference_id) {
    const match = tx.reference_id.match(/order[_-](\d+)/i) || tx.reference_id.match(/^(\d+)$/);
    if (match) return parseInt(match[1], 10);
  }
  if (tx.description) {
    const match = tx.description.match(/đơn\s*(?:hàng\s*)?#?(\d+)/i) || tx.description.match(/order\s*#?(\d+)/i);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function typeLabel(tx: Transaction, t: ReturnType<typeof useTranslations>): string {
  if (tx.type === "deposit") {
    const text = `${tx.description ?? ""} ${tx.reference_id ?? ""}`.toLowerCase();
    if (text.includes("usdt") || text.includes("nowpayments")) return t("typeDepositUsdt");
    if (text.includes("sepay") || text.includes("chuyển khoản") || text.includes("bank") || text.includes("payos")) {
      return t("typeDepositBank");
    }
  }
  const key = `type.${tx.type}`;
  return t.has(key) ? t(key) : tx.type;
}

function statusLabel(tx: Transaction, t: ReturnType<typeof useTranslations>): {
  label: string;
  tone: "good" | "warn" | "neutral" | "bad";
} {
  if (isPending(tx)) return { label: t("statusPending"), tone: "warn" };
  if (tx.type === "purchase_hold") return { label: t("statusHeld"), tone: "warn" };
  return { label: t("statusRecorded"), tone: "good" };
}

export default function TransactionsPage() {
  const t = useTranslations("transactions");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { account, loading: authLoading } = useAuth();
  const { formatBrowseMoney } = useMoney();
  const ready = !authLoading && !!account;
  const balanceQ = useWalletBalance(ready);
  const txQ = useWalletTransactions(ready);

  const [filter, setFilter] = useState<Filter>("all");
  const [provider, setProvider] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const perPage = 10;

  useEffect(() => {
    if (!authLoading && !account) router.push("/login");
  }, [account, authLoading, router]);

  const txs = txQ.data ?? [];
  const providers = useMemo(() => [...new Set(txs.map(providerFor))].sort(), [txs]);

  const counts = useMemo(() => {
    return {
      all: txs.length,
      in: txs.filter((tx) => tx.direction === "in").length,
      out: txs.filter((tx) => tx.direction === "out").length,
      pending: txs.filter(isPending).length,
    };
  }, [txs]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return txs.filter((tx) => {
      if (filter === "in" && tx.direction !== "in") return false;
      if (filter === "out" && tx.direction !== "out") return false;
      if (filter === "pending" && !isPending(tx)) return false;
      if (provider !== "all" && providerFor(tx) !== provider) return false;
      if (
        needle &&
        !`${tx.description ?? ""} ${tx.reference_id ?? ""} ${providerFor(tx)} ${tx.type}`
          .toLowerCase()
          .includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [filter, provider, query, txs]);

  useEffect(() => setPage(1), [filter, provider, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const visible = filtered.slice((page - 1) * perPage, page * perPage);

  const inTotal = txs.filter((tx) => tx.direction === "in").reduce((sum, tx) => sum + tx.amount, 0);
  const outTotal = txs.filter((tx) => tx.direction === "out").reduce((sum, tx) => sum + tx.amount, 0);
  const pendingCount = counts.pending;
  const loc = locale === "vi" ? "vi-VN" : "en-US";

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const hasActiveFilters = filter !== "all" || provider !== "all" || query.trim().length > 0;

  const resetFilters = () => {
    setQuery("");
    setProvider("all");
    setFilter("all");
  };

  // Query order details when a transaction associated with an order is opened
  const selectedOrderId = selectedTx ? extractOrderId(selectedTx) : null;
  const orderQuery = useQuery({
    queryKey: ["transaction-order-detail", selectedOrderId],
    queryFn: () => (selectedOrderId ? api.getOrder(selectedOrderId) : null),
    enabled: !!selectedOrderId && ready,
    staleTime: 60_000,
  });
  const relatedOrder = orderQuery.data ?? null;

  if (authLoading || balanceQ.isPending || txQ.isPending) {
    return (
      <div className="mx-auto flex min-h-[50vh] w-full max-w-[1240px] items-center justify-center px-6 py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-10">
      {/* ── Top Bar & Navigation ── */}
      <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <button
            onClick={() => router.push("/wallet")}
            className="group mb-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-fg"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
            <span>{t("backWallet")}</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-iris-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-[.12em] text-iris">
              <Receipt className="h-3 w-3" />
              {t("eyebrow")}
            </span>
          </div>
          <h1 className="mt-1.5 font-serif text-[26px] font-bold tracking-[-.02em] text-fg sm:text-[30px]">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-faint">
            {t("subtitle")}
          </p>
        </div>

        {/* Balance Hero Card */}
        <div className="flex items-center gap-3">
          <Card className="aura relative flex min-w-[240px] items-center justify-between gap-4 p-4 shadow-card sm:min-w-[280px]">
            <div>
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-faint">
                <Wallet className="h-3.5 w-3.5 text-iris" />
                <span>{t("currentBalance")}</span>
              </div>
              <p className="mt-1 font-mono text-[22px] font-bold tabular tracking-tight text-fg">
                {formatBrowseMoney(balanceQ.data?.available_balance ?? 0, { locale })}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => router.push("/wallet")}
              className="shrink-0 font-medium shadow-xs"
            >
              + {tn("topUp")}
            </Button>
          </Card>
        </div>
      </div>

      {/* ── KPI Bento Grid (Interactive Filters) ── */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Inflow Card */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setFilter(filter === "in" ? "all" : "in")}
          className={cn(
            "group relative overflow-hidden p-4 cursor-pointer select-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg",
            filter === "in"
              ? "ring-2 ring-good border-good bg-good-soft/25 shadow-md"
              : "hover:border-line-2"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-faint">{t("totalIn")}</span>
            {filter === "in" ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-good px-2 py-0.5 text-[10.5px] font-bold text-white shadow-xs">
                ● {t("filtering")}
              </span>
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-good-soft text-good transition-transform group-hover:scale-105">
                <ArrowDownLeft className="h-4 w-4" />
              </span>
            )}
          </div>
          <div className="mt-2 font-mono text-[20px] font-bold tabular tracking-tight text-good">
            +{formatBrowseMoney(inTotal, { locale })}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-faint">
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-medium text-fg">{counts.in}</span>
              <span>{t("transactionsSuffix")}</span>
            </div>
            <span className={cn("text-[10.5px] font-medium transition-colors", filter === "in" ? "text-good font-semibold" : "text-faint/80 group-hover:text-fg")}>
              {filter === "in" ? `✓ ${t("currentlySelected")}` : t("clickToFilter")}
            </span>
          </div>
        </Card>

        {/* Outflow Card */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setFilter(filter === "out" ? "all" : "out")}
          className={cn(
            "group relative overflow-hidden p-4 cursor-pointer select-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg",
            filter === "out"
              ? "ring-2 ring-bad border-bad bg-bad-soft/25 shadow-md"
              : "hover:border-line-2"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-faint">{t("totalOut")}</span>
            {filter === "out" ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-bad px-2 py-0.5 text-[10.5px] font-bold text-white shadow-xs">
                ● {t("filtering")}
              </span>
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bad-soft text-bad transition-transform group-hover:scale-105">
                <ArrowUpRight className="h-4 w-4" />
              </span>
            )}
          </div>
          <div className="mt-2 font-mono text-[20px] font-bold tabular tracking-tight text-bad">
            −{formatBrowseMoney(outTotal, { locale })}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-faint">
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-medium text-fg">{counts.out}</span>
              <span>{t("transactionsSuffix")}</span>
            </div>
            <span className={cn("text-[10.5px] font-medium transition-colors", filter === "out" ? "text-bad font-semibold" : "text-faint/80 group-hover:text-fg")}>
              {filter === "out" ? `✓ ${t("currentlySelected")}` : t("clickToFilter")}
            </span>
          </div>
        </Card>

        {/* Pending Card */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setFilter(filter === "pending" ? "all" : "pending")}
          className={cn(
            "group relative overflow-hidden p-4 cursor-pointer select-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg",
            filter === "pending"
              ? "ring-2 ring-warn border-warn bg-warn-soft/25 shadow-md"
              : "hover:border-line-2"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-faint">{t("pending")}</span>
            {filter === "pending" ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-warn px-2 py-0.5 text-[10.5px] font-bold text-white shadow-xs">
                ● {t("filtering")}
              </span>
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-warn-soft text-warn transition-transform group-hover:scale-105">
                <Clock className="h-4 w-4" />
              </span>
            )}
          </div>
          <div className="mt-2 font-mono text-[20px] font-bold tabular tracking-tight text-warn">
            {pendingCount}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-faint">
            <span>{t("awaitingProcessing")}</span>
            <span className={cn("text-[10.5px] font-medium transition-colors", filter === "pending" ? "text-warn font-semibold" : "text-faint/80 group-hover:text-fg")}>
              {filter === "pending" ? `✓ ${t("currentlySelected")}` : t("clickToFilter")}
            </span>
          </div>
        </Card>

        {/* Filtered Summary Card */}
        <Card
          role="button"
          tabIndex={0}
          onClick={resetFilters}
          className={cn(
            "group relative overflow-hidden p-4 cursor-pointer select-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg",
            filter === "all" && !query && provider === "all"
              ? "ring-2 ring-iris border-iris bg-iris-soft/25 shadow-md"
              : "hover:border-line-2"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-faint">{t("shown")}</span>
            {filter === "all" && !query && provider === "all" ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-iris px-2 py-0.5 text-[10.5px] font-bold text-white shadow-xs">
                ● {t("allHistory")}
              </span>
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-iris-soft text-iris transition-transform group-hover:scale-105">
                <SlidersHorizontal className="h-4 w-4" />
              </span>
            )}
          </div>
          <div className="mt-2 font-mono text-[20px] font-bold tabular tracking-tight text-fg">
            {filtered.length}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-faint">
            {hasActiveFilters ? (
              <span className="font-semibold text-iris group-hover:underline">
                ✕ {t("clear")}
              </span>
            ) : (
              <span>{t("allHistory")}</span>
            )}
            <span className="text-[10.5px] font-medium text-faint/80 group-hover:text-fg">
              {hasActiveFilters ? t("resetAction") : `✓ ${t("defaultView")}`}
            </span>
          </div>
        </Card>
      </div>

      {/* ── Main Ledger Card ── */}
      <Card className="overflow-hidden shadow-card">
        {/* Controls / Filter Toolbar */}
        <div className="border-b border-line bg-surface/80 p-4 backdrop-blur-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Search Input */}
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-10 w-full rounded-lg border border-line bg-card pl-10 pr-9 text-[13px] text-fg outline-none transition-all placeholder:text-faint focus:border-iris focus:ring-2 focus:ring-iris/10"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-faint hover:bg-raised hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Provider & Action */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="h-10 rounded-lg border border-line bg-card px-3.5 pr-8 text-[13px] font-medium text-fg outline-none transition-colors hover:border-line-2 focus:border-iris"
                >
                  <option value="all">{t("allProviders")}</option>
                  {providers.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="h-10 border border-line text-[12.5px] hover:border-bad/30 hover:text-bad"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("clear")}
                </Button>
              )}
            </div>
          </div>

          {/* Segmented Filter Pills */}
          <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-3.5">
            {(["all", "in", "out", "pending"] as Filter[]).map((item) => {
              const active = filter === item;
              const count = counts[item];
              return (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-all",
                    active
                      ? "bg-fg text-surface shadow-xs"
                      : "bg-raised/70 text-muted hover:bg-raised hover:text-fg"
                  )}
                >
                  <span>{t(`filter.${item}`)}</span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.2 text-[10.5px] font-mono tabular",
                      active ? "bg-white/20 text-white" : "bg-surface text-faint border border-line"
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Desktop Table View (≥ 768px) ── */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line bg-raised/40 text-[11px] font-bold uppercase tracking-[.08em] text-faint">
                <th className="px-5 py-3.5">{t("date")}</th>
                <th className="px-4 py-3.5">{t("transaction")}</th>
                <th className="px-4 py-3.5">{t("provider")}</th>
                <th className="px-4 py-3.5">{t("reference")}</th>
                <th className="px-4 py-3.5">{t("status")}</th>
                <th className="px-5 py-3.5 text-right">{t("amount")}</th>
                <th className="w-10 px-3 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 text-[13px]">
              {visible.map((tx) => {
                const date = new Date(tx.created_at);
                const status = statusLabel(tx, t);
                const isIncoming = tx.direction === "in";
                const isOutgoing = tx.direction === "out";
                const sign = isIncoming ? "+" : isOutgoing ? "−" : "";
                const isCopied = copiedId === `desk-${tx.id}`;
                const orderId = extractOrderId(tx);

                return (
                  <tr
                    key={tx.id}
                    onClick={() => setSelectedTx(tx)}
                    className="group cursor-pointer transition-colors duration-150 hover:bg-raised/60"
                  >
                    {/* Date */}
                    <td className="whitespace-nowrap px-5 py-4">
                      <div className="font-medium text-fg">
                        {date.toLocaleDateString(loc, {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </div>
                      <div className="font-mono text-[11.5px] text-faint">
                        {date.toLocaleTimeString(loc, {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </div>
                    </td>

                    {/* Transaction / Type */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold shadow-xs",
                            isIncoming
                              ? "bg-good-soft text-good"
                              : isOutgoing
                              ? "bg-bad-soft text-bad"
                              : "bg-raised text-faint"
                          )}
                        >
                          {isIncoming ? (
                            <ArrowDownLeft className="h-4 w-4" />
                          ) : isOutgoing ? (
                            <ArrowUpRight className="h-4 w-4" />
                          ) : (
                            <Clock className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="max-w-[240px] truncate font-semibold text-fg">
                              {typeLabel(tx, t)}
                            </p>
                            {orderId && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/orders?search=${orderId}`);
                                }}
                                className="inline-flex items-center gap-1 rounded bg-iris-soft/80 px-1.5 py-0.2 font-mono text-[10.5px] font-semibold text-iris hover:bg-iris hover:text-white transition-colors"
                                title={t("viewOrder")}
                              >
                                #{orderId} ↗
                              </button>
                            )}
                          </div>
                          {tx.description && (
                            <p className="mt-0.5 max-w-[280px] truncate text-[11.5px] text-faint">
                              {tx.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Provider */}
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[11.5px] font-medium text-muted">
                        {providerFor(tx)}
                      </span>
                    </td>

                    {/* Reference ID + Copy */}
                    <td className="px-4 py-4">
                      {tx.reference_id ? (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(tx.reference_id!, `desk-${tx.id}`);
                          }}
                          className="group/ref inline-flex items-center gap-1.5 rounded bg-raised px-2 py-1 font-mono text-[11.5px] text-muted transition-colors hover:bg-iris-soft hover:text-iris"
                          title="Click to copy"
                        >
                          <span className="max-w-[130px] truncate">{tx.reference_id}</span>
                          {isCopied ? (
                            <Check className="h-3 w-3 text-good" />
                          ) : (
                            <Copy className="h-3 w-3 opacity-60 group-hover/ref:opacity-100" />
                          )}
                        </div>
                      ) : (
                        <span className="font-mono text-[11.5px] text-faint">#{tx.id}</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      <Tag tone={status.tone} className="px-2 py-0.5 text-[11px] font-medium">
                        {status.label}
                      </Tag>
                    </td>

                    {/* Amount */}
                    <td className="whitespace-nowrap px-5 py-4 text-right">
                      <span
                        className={cn(
                          "font-mono text-[14.5px] font-bold tabular",
                          isIncoming
                            ? "text-good"
                            : isOutgoing
                            ? "text-bad"
                            : "text-muted"
                        )}
                      >
                        {sign}
                        {formatBrowseMoney(tx.amount, { locale })}
                      </span>
                    </td>

                    {/* Chevron Indicator */}
                    <td className="px-3 py-4 text-right text-faint">
                      <ChevronRight className="h-4 w-4 opacity-40 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Mobile Card List View (< 768px) ── */}
        <div className="divide-y divide-line md:hidden">
          {visible.map((tx) => {
            const date = new Date(tx.created_at);
            const status = statusLabel(tx, t);
            const isIncoming = tx.direction === "in";
            const isOutgoing = tx.direction === "out";
            const sign = isIncoming ? "+" : isOutgoing ? "−" : "";
            const orderId = extractOrderId(tx);

            return (
              <div
                key={tx.id}
                onClick={() => setSelectedTx(tx)}
                className="flex items-start justify-between gap-3 p-4 transition-colors active:bg-raised cursor-pointer"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold",
                      isIncoming
                        ? "bg-good-soft text-good"
                        : isOutgoing
                        ? "bg-bad-soft text-bad"
                        : "bg-raised text-faint"
                    )}
                  >
                    {isIncoming ? (
                      <ArrowDownLeft className="h-4 w-4" />
                    ) : isOutgoing ? (
                      <ArrowUpRight className="h-4 w-4" />
                    ) : (
                      <Clock className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-semibold text-fg text-[13.5px]">
                        {typeLabel(tx, t)}
                      </p>
                      {orderId && (
                        <span className="rounded bg-iris-soft px-1.5 py-0.2 font-mono text-[10px] font-bold text-iris">
                          #{orderId}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
                      <span>{date.toLocaleDateString(loc)}</span>
                      <span>•</span>
                      <span>{date.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}</span>
                      <span>•</span>
                      <span className="font-medium text-muted">{providerFor(tx)}</span>
                    </div>
                    {tx.reference_id && (
                      <div className="mt-1 font-mono text-[11px] text-faint truncate">
                        Ref: {tx.reference_id}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p
                    className={cn(
                      "font-mono text-[14px] font-bold tabular",
                      isIncoming
                        ? "text-good"
                        : isOutgoing
                        ? "text-bad"
                        : "text-muted"
                    )}
                  >
                    {sign}
                    {formatBrowseMoney(tx.amount, { locale })}
                  </p>
                  <div className="mt-1">
                    <Tag tone={status.tone} className="text-[10px] px-1.5 py-0.2">
                      {status.label}
                    </Tag>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Empty State ── */}
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised text-faint">
              <Inbox className="h-6 w-6" />
            </div>
            <h3 className="mt-3.5 font-serif text-[16px] font-bold text-fg">
              {t("empty")}
            </h3>
            <p className="mt-1 max-w-sm text-[12.5px] text-faint">
              {hasActiveFilters ? t("emptyFilteredHint") : t("emptyNone")}
            </p>
            {hasActiveFilters && (
              <Button
                variant="secondary"
                size="sm"
                onClick={resetFilters}
                className="mt-4 gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                {t("clear")}
              </Button>
            )}
          </div>
        )}

        {/* ── Footer & Pagination ── */}
        {filtered.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-line bg-surface/50 px-4 py-3.5 text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span className="text-faint">
              {t("range", {
                from: (page - 1) * perPage + 1,
                to: Math.min(page * perPage, filtered.length),
                total: filtered.length,
              })}
            </span>
            <Pagination
              page={page}
              totalPages={totalPages}
              onChange={(p) => setPage(p)}
            />
          </div>
        )}
      </Card>

      {/* ── Transaction Details Dialog ── */}
      <Dialog open={!!selectedTx} onOpenChange={(open: boolean) => !open && setSelectedTx(null)}>
        <DialogContent className="max-w-lg border-line bg-card p-6 shadow-card-lg sm:rounded-2xl">
          {selectedTx && (
            <div>
              <DialogHeader className="text-left">
                <div className="flex items-center justify-between gap-2">
                  <Tag
                    tone={statusLabel(selectedTx, t).tone}
                    className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
                  >
                    {statusLabel(selectedTx, t).label}
                  </Tag>
                  <span className="font-mono text-[11.5px] text-faint">
                    ID #{selectedTx.id}
                  </span>
                </div>
                <DialogTitle className="mt-2 text-[20px] font-bold text-fg">
                  {typeLabel(selectedTx, t)}
                </DialogTitle>
                <DialogDescription className="text-[12.5px] text-faint">
                  {new Date(selectedTx.created_at).toLocaleString(loc, {
                    dateStyle: "full",
                    timeStyle: "medium",
                  })}
                </DialogDescription>
              </DialogHeader>

              {/* Amount Showcase Banner */}
              <div className="my-5 rounded-xl border border-line bg-raised/50 p-4 text-center">
                <div className="text-[11.5px] font-medium text-faint">
                  {t("amount")}
                </div>
                <div
                  className={cn(
                    "mt-1 font-mono text-[26px] font-bold tabular tracking-tight",
                    selectedTx.direction === "in"
                      ? "text-good"
                      : selectedTx.direction === "out"
                      ? "text-bad"
                      : "text-fg"
                  )}
                >
                  {selectedTx.direction === "in" ? "+" : selectedTx.direction === "out" ? "−" : ""}
                  {formatBrowseMoney(selectedTx.amount, { locale })}
                </div>
              </div>

              {/* Related Order & Product Section (if transaction is linked to an order) */}
              {selectedOrderId ? (
                <div className="my-4 rounded-xl border border-iris/25 bg-iris-soft/30 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-iris">
                      <Package className="h-4 w-4" />
                      <span>{t("orderInfo")}</span>
                    </div>
                    <span className="rounded bg-surface px-2 py-0.5 font-mono text-[11px] font-bold text-iris border border-iris/20">
                      #{selectedOrderId}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    {relatedOrder?.product_title ? (
                      <div>
                        <span className="text-[11px] font-medium text-faint uppercase tracking-wider">{t("productName")}</span>
                        <p className="mt-0.5 text-[13.5px] font-semibold text-fg leading-snug">{relatedOrder.product_title}</p>
                        {relatedOrder.variant_name && (
                          <p className="text-[11.5px] text-faint mt-0.5">{relatedOrder.variant_name} · x{relatedOrder.quantity}</p>
                        )}
                      </div>
                    ) : orderQuery.isLoading ? (
                      <div className="flex items-center gap-2 text-[12px] text-faint py-1">
                        <Spinner />
                        <span>{t("loadingOrder")}</span>
                      </div>
                    ) : selectedTx.description ? (
                      <div>
                        <span className="text-[11px] font-medium text-faint uppercase tracking-wider">{t("productName")}</span>
                        <p className="mt-0.5 text-[13px] font-medium text-fg leading-snug">{selectedTx.description}</p>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-iris/15">
                      {relatedOrder?.product_id ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setSelectedTx(null);
                            router.push(`/products/${relatedOrder.product_id}`);
                          }}
                          className="gap-1.5 text-[12px] font-medium shadow-xs"
                        >
                          <Package className="h-3.5 w-3.5" />
                          {t("viewProduct")} ↗
                        </Button>
                      ) : null}

                      <Button
                        variant={relatedOrder?.product_id ? "secondary" : "primary"}
                        size="sm"
                        onClick={() => {
                          setSelectedTx(null);
                          router.push(`/orders?search=${selectedOrderId}`);
                        }}
                        className="gap-1.5 text-[12px] font-medium"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        {t("viewOrder")} #{selectedOrderId} ↗
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Metadata rows */}
              <div className="space-y-3 divide-y divide-line/60 text-[13px]">
                <div className="flex items-center justify-between pt-2">
                  <span className="text-faint">{t("provider")}</span>
                  <span className="font-medium text-fg">{providerFor(selectedTx)}</span>
                </div>

                <div className="flex items-center justify-between pt-2.5">
                  <span className="text-faint">{t("reference")}</span>
                  {selectedTx.reference_id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px] text-fg">
                        {selectedTx.reference_id}
                      </span>
                      <button
                        onClick={() => handleCopy(selectedTx.reference_id!, "dialog-ref")}
                        className="rounded p-1 text-faint hover:bg-raised hover:text-fg"
                      >
                        {copiedId === "dialog-ref" ? (
                          <Check className="h-3.5 w-3.5 text-good" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2.5">
                  <span className="text-faint">Type raw</span>
                  <span className="font-mono text-[12px] text-muted">{selectedTx.type}</span>
                </div>

                {selectedTx.description && !selectedOrderId && (
                  <div className="pt-2.5">
                    <div className="text-faint mb-1">{t("note")}</div>
                    <div className="rounded-lg bg-raised/70 p-2.5 text-[12.5px] leading-relaxed text-muted">
                      {selectedTx.description}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedTx(null)}
                >
                  {tc("close")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

