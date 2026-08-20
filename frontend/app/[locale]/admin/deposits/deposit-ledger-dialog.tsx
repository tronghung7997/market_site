"use client";

import * as React from "react";
import {
  BookOpenCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Coins,
  Landmark,
  RefreshCw,
  Search,
  WalletCards,
} from "lucide-react";

import { DepositStatusBadge } from "@/components/admin";
import { Button, Input } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type {
  AdminDepositLedgerEntry,
  AdminDepositLedgerQuery,
  AdminDepositLedgerResponse,
  AdminDepositTransaction,
} from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatMoney, formatTime, numeric, providerMeta } from "./deposit-transactions-dialog";

type Props = {
  open: boolean;
  ledger: AdminDepositLedgerResponse | null;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onLoad: (query: AdminDepositLedgerQuery) => void;
};

const PAGE_SIZE = 25;
const PROVIDER_KEYS = ["sepay", "nowpayments", "payos"];

function incomingTransactions(entry: AdminDepositLedgerEntry) {
  return entry.transactions.filter((transaction) => transaction.direction !== "out");
}

function attentionCount(entry: AdminDepositLedgerEntry): number {
  const transactions = incomingTransactions(entry);
  const held = transactions.filter((transaction) => transaction.credit_status === "held").length;
  const missingJournal = entry.deposit.status === "paid" && transactions.length === 0;
  return held + (missingJournal ? 1 : 0);
}

function actualSummary(entry: AdminDepositLedgerEntry): string {
  const transactions = incomingTransactions(entry);
  if (transactions.length === 0) return "Chưa ghi nhận";
  const currencies = [...new Set(transactions.map((transaction) => transaction.currency.toUpperCase()))];
  if (currencies.length !== 1) return `${transactions.length} giao dịch`;
  const total = transactions.reduce(
    (sum, transaction) => sum + (numeric(transaction.actual_amount) ?? 0),
    0,
  );
  return formatMoney(total, currencies[0]);
}

function transactionMatch(transaction: AdminDepositTransaction) {
  const config = {
    exact: { label: "Khớp", className: "text-emerald-700" },
    underpaid: { label: "Thiếu tiền", className: "text-amber-800" },
    overpaid: { label: "Dư tiền", className: "text-amber-800" },
    unknown: { label: "Chưa xác định", className: "text-slate-500" },
  }[transaction.match_status];
  return <span className={cn("text-[11px] font-semibold", config.className)}>{config.label}</span>;
}

function transactionCredit(transaction: AdminDepositTransaction) {
  if (transaction.credit_status === "credited") {
    return <span className="text-[11px] font-semibold text-emerald-700">Đã cộng ví</span>;
  }
  if (transaction.credit_status === "held") {
    return <span className="text-[11px] font-semibold text-amber-800">Đang giữ</span>;
  }
  return <span className="text-[11px] text-slate-500">Chưa cộng ví</span>;
}

function TransactionDetails({ transactions }: { transactions: AdminDepositTransaction[] }) {
  return (
    <div className="border-t border-slate-200 bg-slate-50/80">
      {transactions.map((transaction) => (
        <div key={transaction.id} className="border-b border-slate-200 px-5 py-3 last:border-b-0 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-[1.25fr_1fr_0.75fr_0.75fr] sm:items-center">
            <div className="min-w-0">
              <p className="truncate font-mono text-[11px] font-medium text-slate-700">
                {transaction.reference || transaction.provider_transaction_id}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                {formatTime(transaction.received_at)} · {transaction.source.toUpperCase()}
              </p>
            </div>
            <div>
              <p className="font-mono text-[12px] font-semibold tabular-nums text-slate-900">
                {formatMoney(transaction.actual_amount, transaction.currency)}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                Yêu cầu {formatMoney(transaction.expected_amount, transaction.currency)}
              </p>
            </div>
            <div>{transactionMatch(transaction)}</div>
            <div>{transactionCredit(transaction)}</div>
          </div>
          <details className="group mt-2">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
              Dữ liệu gốc
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-[10px] leading-relaxed text-slate-700">
{JSON.stringify(transaction.raw, null, 2)}
            </pre>
          </details>
        </div>
      ))}
    </div>
  );
}

function LedgerRow({ entry }: { entry: AdminDepositLedgerEntry }) {
  const provider = providerMeta(entry.deposit.provider);
  const transactions = incomingTransactions(entry);
  const attention = attentionCount(entry);
  const missingJournal = entry.deposit.status === "paid" && transactions.length === 0;
  const credited = entry.deposit.status === "paid" && !missingJournal;

  return (
    <article className="border-b border-slate-200 bg-white last:border-b-0">
      <div className="grid gap-4 px-5 py-4 sm:px-6 lg:grid-cols-[1.25fr_0.8fr_0.9fr_0.75fr_0.85fr_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-slate-900">#{entry.deposit.id}</span>
            <span className="truncate text-[12px] text-slate-600">
              {entry.deposit.account_email ?? `Tài khoản #${entry.deposit.account_id}`}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Tạo lúc {formatTime(entry.deposit.created_at)}</p>
        </div>

        <div className="flex items-center gap-2.5">
          <span className={cn("grid h-8 min-w-8 place-items-center rounded-lg px-1.5 text-[9px] font-bold tracking-wide", provider.markClass)}>
            {provider.mark}
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-slate-900">{provider.name}</p>
            <p className="truncate text-[10px] text-slate-400">{provider.method}</p>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Provider nhận</p>
          <p className="mt-1 font-mono text-[13px] font-semibold tabular-nums text-slate-950">
            {actualSummary(entry)}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            Lệnh {formatMoney(entry.deposit.amount, "VND")}
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Trạng thái lệnh</p>
          <DepositStatusBadge status={entry.deposit.status} />
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Kết quả</p>
          {missingJournal ? (
            <p className="mt-1 text-[11px] font-semibold text-amber-800">Thiếu nhật ký provider</p>
          ) : attention > 0 ? (
            <p className="mt-1 text-[11px] font-semibold text-amber-800">{attention} khoản đang giữ</p>
          ) : credited ? (
            <p className="mt-1 text-[11px] font-semibold text-emerald-700">Đã cộng ví</p>
          ) : transactions.length > 0 ? (
            <p className="mt-1 text-[11px] font-medium text-slate-600">Chưa cộng ví</p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-500">Chưa có tiền vào</p>
          )}
          {transactions.length > 0 && (
            <p className="mt-0.5 text-[10px] text-slate-400">{transactions.length} giao dịch provider</p>
          )}
        </div>

        {transactions.length > 0 ? (
          <span className="hidden text-right lg:block">
            <span className="text-[10px] font-medium text-slate-400">Chi tiết</span>
            <span className="mt-1 block text-[11px] font-semibold text-slate-700">
              {transactions.length} giao dịch
            </span>
          </span>
        ) : (
          <span className="hidden text-right text-[10px] text-slate-400 lg:block">Không có giao dịch</span>
        )}
      </div>

      {transactions.length > 0 && (
        <details className="group">
          <summary
            aria-label={`Xem ${transactions.length} giao dịch của lệnh #${entry.deposit.id}`}
            className="flex cursor-pointer list-none items-center justify-between border-t border-slate-200 bg-slate-100/70 px-5 py-2.5 text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:px-6"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className={cn("grid h-6 min-w-6 place-items-center rounded-md px-1 text-[8px] font-bold tracking-wide", provider.markClass)}>
                {provider.mark}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-semibold group-open:hidden">
                  Xem chi tiết lệnh #{entry.deposit.id}
                </span>
                <span className="hidden truncate text-[11px] font-semibold group-open:block">
                  Đang xem chi tiết lệnh #{entry.deposit.id}
                </span>
                <span className="mt-0.5 block text-[10px] text-slate-500">
                  {provider.name}, {transactions.length} giao dịch provider
                </span>
              </span>
            </span>
            <span className="ml-3 flex shrink-0 items-center gap-2 text-[10px] font-semibold text-slate-500">
              <span className="hidden sm:inline group-open:hidden">Mở chi tiết</span>
              <span className="hidden sm:group-open:inline">Thu gọn</span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </span>
          </summary>
          <div className="border-l-2 border-l-slate-900">
            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-2.5 sm:px-6">
              <p className="text-[11px] font-semibold text-slate-800">
                Giao dịch thuộc lệnh #{entry.deposit.id}
              </p>
              <p className="text-[10px] text-slate-400">{provider.name}</p>
            </div>
            <TransactionDetails transactions={transactions} />
          </div>
        </details>
      )}
    </article>
  );
}

export function DepositLedgerDialog({ open, ledger, error, onOpenChange, onLoad }: Props) {
  const [providerFilter, setProviderFilter] = React.useState("all");
  const [attentionOnly, setAttentionOnly] = React.useState(false);
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);

  const query = React.useMemo<AdminDepositLedgerQuery>(() => ({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(providerFilter !== "all" ? { provider: providerFilter } : {}),
    ...(search ? { search } : {}),
  }), [page, providerFilter, search]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(0);
      setSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    if (open) onLoad(query);
  }, [onLoad, open, query]);

  React.useEffect(() => {
    if (!open) {
      setProviderFilter("all");
      setAttentionOnly(false);
      setSearchInput("");
      setSearch("");
      setPage(0);
    }
  }, [open]);

  const items = ledger?.items ?? [];
  const allTransactions = items.flatMap(incomingTransactions);
  const bankTotal = allTransactions
    .filter((transaction) => transaction.currency.toUpperCase() === "VND")
    .reduce((sum, transaction) => sum + (numeric(transaction.actual_amount) ?? 0), 0);
  const cryptoTransactions = allTransactions.filter((transaction) => transaction.currency.toUpperCase() !== "VND");
  const cryptoCurrencies = [...new Set(cryptoTransactions.map((transaction) => transaction.currency.toUpperCase()))];
  const cryptoTotal = cryptoTransactions.reduce(
    (sum, transaction) => sum + (numeric(transaction.actual_amount) ?? 0),
    0,
  );
  const cryptoSummary = cryptoCurrencies.length === 1
    ? formatMoney(cryptoTotal, cryptoCurrencies[0])
    : `${cryptoTransactions.length} giao dịch`;
  const creditedVnd = items
    .filter((entry) => entry.deposit.status === "paid")
    .reduce((sum, entry) => sum + (entry.deposit.paid_amount ?? entry.deposit.amount), 0);
  const totalAttention = items.reduce((sum, entry) => sum + attentionCount(entry), 0);
  const filteredItems = attentionOnly
    ? items.filter((entry) => attentionCount(entry) > 0)
    : items;
  const totalPages = Math.max(1, Math.ceil((ledger?.total ?? 0) / PAGE_SIZE));
  const rangeStart = ledger && ledger.total > 0 ? ledger.offset + 1 : 0;
  const rangeEnd = ledger ? ledger.offset + ledger.items.length : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[1220px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 sm:h-[min(860px,calc(100dvh-2rem))] sm:w-[calc(100vw-2rem)]">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-14 text-left sm:px-6 sm:py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-950 text-white">
              <BookOpenCheck className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[17px] text-slate-950">Sổ giao dịch nạp tiền</DialogTitle>
              <DialogDescription className="mt-1 text-[12px]">
                {ledger
                  ? `Đang xem lệnh ${rangeStart}-${rangeEnd} / ${ledger.total} theo bộ lọc hiện tại`
                  : "Tất cả lệnh nạp và giao dịch provider liên quan"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
          <section className="border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
            <div className="mb-2.5 flex items-center justify-between text-[10px] text-slate-500">
              <span className="font-semibold">Tổng hợp trang {page + 1}</span>
              <span>{PAGE_SIZE} lệnh mỗi trang</span>
            </div>
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 sm:grid-cols-4">
              <div className="border-b border-r border-slate-200 px-3.5 py-3 sm:border-b-0 sm:px-4">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  <Landmark className="h-3 w-3" aria-hidden="true" /> Tiền ngân hàng
                </div>
                <p className="mt-1.5 font-mono text-[14px] font-semibold tabular-nums text-slate-950">
                  {ledger ? formatMoney(bankTotal, "VND") : "Đang tải"}
                </p>
              </div>
              <div className="border-b border-slate-200 px-3.5 py-3 sm:border-b-0 sm:border-r sm:px-4">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  <Coins className="h-3 w-3" aria-hidden="true" /> Tiền crypto
                </div>
                <p className="mt-1.5 font-mono text-[14px] font-semibold tabular-nums text-slate-950">
                  {ledger ? cryptoSummary : "Đang tải"}
                </p>
              </div>
              <div className="border-r border-slate-200 px-3.5 py-3 sm:px-4">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  <WalletCards className="h-3 w-3" aria-hidden="true" /> Đã cộng ví
                </div>
                <p className="mt-1.5 font-mono text-[14px] font-semibold tabular-nums text-emerald-700">
                  {ledger ? formatMoney(creditedVnd, "VND") : "Đang tải"}
                </p>
              </div>
              <div className="px-3.5 py-3 sm:px-4">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  <CircleAlert className="h-3 w-3" aria-hidden="true" /> Cần xử lý
                </div>
                <p className={cn("mt-1.5 font-mono text-[14px] font-semibold tabular-nums", totalAttention > 0 ? "text-amber-800" : "text-slate-950")}>
                  {ledger ? `${totalAttention} vấn đề` : "Đang tải"}
                </p>
              </div>
            </div>
          </section>

          <section className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-3 backdrop-blur sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setProviderFilter("all");
                    setPage(0);
                  }}
                  className={cn(
                    "h-8 rounded-lg border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
                    providerFilter === "all"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                  )}
                >
                  Tất cả provider
                </button>
                {PROVIDER_KEYS.map((key) => {
                  const provider = providerMeta(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setProviderFilter(key);
                        setPage(0);
                      }}
                      className={cn(
                        "h-8 rounded-lg border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
                        providerFilter === key
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                      )}
                    >
                      {provider.name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={attentionOnly}
                  onClick={() => setAttentionOnly((value) => !value)}
                  className={cn(
                    "h-8 rounded-lg border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2",
                    attentionOnly
                      ? "border-amber-300 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                  )}
                >
                  Cần xử lý trang này
                </button>
              </div>
              <div className="relative w-full lg:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Tìm lệnh, email, mã giao dịch"
                  aria-label="Tìm trong sổ giao dịch"
                  className="h-8 pl-9 text-[11px]"
                />
              </div>
            </div>
          </section>

          <section aria-label="Tất cả lệnh nạp">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-2.5 sm:px-6">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Danh sách lệnh</h3>
              {ledger && (
                <span className="text-[11px] text-slate-400">
                  {attentionOnly ? `${filteredItems.length} cần xử lý trong trang` : `${rangeStart}-${rangeEnd} / ${ledger.total} lệnh`}
                </span>
              )}
            </div>

            {!ledger && !error ? (
              <div className="space-y-3 bg-white p-5 sm:p-6" aria-label="Đang tải sổ giao dịch">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
                ))}
              </div>
            ) : error ? (
              <div className="grid min-h-72 place-items-center bg-white px-6 py-12 text-center">
                <div>
                  <CircleAlert className="mx-auto h-6 w-6 text-red-500" aria-hidden="true" />
                  <p className="mt-3 text-[13px] font-semibold text-slate-900">Không tải được sổ giao dịch</p>
                  <p className="mt-1 max-w-sm text-[12px] text-slate-500">{error}</p>
                  <Button className="mt-4" size="sm" variant="secondary" onClick={() => onLoad(query)}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Thử lại
                  </Button>
                </div>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="grid min-h-72 place-items-center bg-white px-6 py-12 text-center">
                <div>
                  <BookOpenCheck className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
                  <p className="mt-3 text-[13px] font-semibold text-slate-900">Không có lệnh phù hợp</p>
                  <p className="mt-1 text-[12px] text-slate-500">Đổi provider, bỏ lọc cần xử lý hoặc thử từ khoá khác.</p>
                </div>
              </div>
            ) : (
              <div>
                {filteredItems.map((entry) => <LedgerRow key={entry.deposit.id} entry={entry} />)}
              </div>
            )}

            {ledger && ledger.total > 0 && (
              <nav
                aria-label="Phân trang sổ giao dịch"
                className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-3 sm:px-6"
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Trang trước
                </Button>
                <div className="text-center">
                  <p className="text-[11px] font-semibold text-slate-800">Trang {page + 1} / {totalPages}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{rangeStart}-{rangeEnd} trong {ledger.total} lệnh</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                >
                  Trang sau
                  <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </nav>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
