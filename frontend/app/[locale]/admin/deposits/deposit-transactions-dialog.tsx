"use client";

import * as React from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleAlert,
  Landmark,
  RefreshCw,
  WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DepositStatusBadge } from "@/components/admin";
import type { AdminDepositIntent, AdminDepositLedgerIntent, AdminDepositTransaction } from "@/lib/types";
import { cn } from "@/lib/utils/cn";

type Props = {
  deposit: AdminDepositIntent | AdminDepositLedgerIntent | null;
  transactions: AdminDepositTransaction[] | null;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
};

const numberFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 8 });
const integerFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

export function numeric(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMoney(value: number | string | null | undefined, currency: string): string {
  const amount = numeric(value);
  if (amount == null) return "Chưa có";
  if (currency.toUpperCase() === "VND") return `${integerFormatter.format(amount)} đ`;
  return `${numberFormatter.format(amount)} ${currency.toUpperCase()}`;
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "Chưa có";
  const date = new Date(value);
  return `${date.toLocaleDateString("vi-VN")} ${date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function providerMeta(provider: string) {
  const key = provider.toLowerCase();
  if (key === "sepay") {
    return {
      mark: "SP",
      name: "SePay",
      method: "Chuyển khoản ngân hàng",
      markClass: "bg-emerald-950 text-emerald-50",
    };
  }
  if (key === "nowpayments") {
    return {
      mark: "NOW",
      name: "NOWPayments",
      method: "Thanh toán USDT",
      markClass: "bg-indigo-950 text-indigo-50",
    };
  }
  if (key === "payos") {
    return {
      mark: "PO",
      name: "PayOS",
      method: "Cổng thanh toán cũ",
      markClass: "bg-sky-950 text-sky-50",
    };
  }
  return {
    mark: provider.slice(0, 3).toUpperCase() || "PAY",
    name: provider || "Provider khác",
    method: "Phương thức thanh toán",
    markClass: "bg-slate-900 text-white",
  };
}

function providerStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    received: "Đã ghi nhận",
    outgoing: "Tiền ra",
    waiting: "Đang chờ",
    confirming: "Đang xác nhận",
    confirmed: "Đã xác nhận",
    sending: "Đang chuyển",
    finished: "Hoàn tất",
    failed: "Thất bại",
    refunded: "Đã hoàn tiền",
    expired: "Hết hạn",
    paid: "Đã thanh toán",
  };
  return labels[status.toLowerCase()] ?? status;
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    webhook: "Webhook",
    reconcile: "Đối soát API",
    ipn: "IPN",
  };
  return labels[source.toLowerCase()] ?? source;
}

function MatchBadge({ transaction }: { transaction: AdminDepositTransaction }) {
  const delta = numeric(transaction.delta_amount);
  const config = {
    exact: { label: "Khớp số tiền", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    underpaid: { label: "Thiếu tiền", className: "border-amber-200 bg-amber-50 text-amber-800" },
    overpaid: { label: "Dư tiền", className: "border-amber-200 bg-amber-50 text-amber-800" },
    unknown: { label: "Chưa xác định", className: "border-slate-200 bg-slate-50 text-slate-600" },
  }[transaction.match_status];

  return (
    <div className="space-y-1.5">
      <span className={cn("inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold", config.className)}>
        {config.label}
      </span>
      {delta != null && transaction.match_status !== "exact" && (
        <p className="font-mono text-[12px] font-semibold tabular-nums text-slate-700">
          {delta > 0 ? "+" : ""}{formatMoney(delta, transaction.currency)}
        </p>
      )}
      {transaction.match_status === "exact" && (
        <p className="text-[11px] text-slate-500">Chênh lệch 0</p>
      )}
    </div>
  );
}

function CreditBadge({ status }: { status: AdminDepositTransaction["credit_status"] }) {
  if (status === "credited") {
    return (
      <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Đã cộng ví
      </div>
    );
  }
  if (status === "held") {
    return (
      <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-800">
        <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
        Đang giữ
      </div>
    );
  }
  return <span className="text-[12px] font-medium text-slate-500">Chưa cộng ví</span>;
}

function TransactionRow({ transaction }: { transaction: AdminDepositTransaction }) {
  const provider = providerMeta(transaction.provider);
  return (
    <article className="border-b border-slate-200 last:border-b-0">
      <div className="grid gap-5 px-5 py-4 md:grid-cols-[1.35fr_1fr_0.9fr_0.85fr] md:items-start md:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className={cn("grid h-9 min-w-9 place-items-center rounded-lg px-2 text-[10px] font-bold tracking-wide", provider.markClass)}>
              {provider.mark}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-slate-900">{provider.name}</p>
              <p className="truncate text-[11px] text-slate-500">{provider.method}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
              {providerStatusLabel(transaction.provider_status)}
            </span>
            <span className="text-slate-400">{sourceLabel(transaction.source)}</span>
            {transaction.event_count > 1 && (
              <span className="text-slate-400">{transaction.event_count} lần cập nhật</span>
            )}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Tiền thực vào</p>
          <p className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-slate-950">
            {formatMoney(transaction.actual_amount, transaction.currency)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Lệnh yêu cầu {formatMoney(transaction.expected_amount, transaction.currency)}
          </p>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">So với lệnh</p>
          <MatchBadge transaction={transaction} />
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Xử lý ví</p>
          <CreditBadge status={transaction.credit_status} />
          {transaction.settled_amount != null && transaction.settled_currency && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Provider chốt {formatMoney(transaction.settled_amount, transaction.settled_currency)}
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-2.5 md:px-6">
        <div className="grid gap-x-6 gap-y-1.5 text-[11px] text-slate-500 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
          <p className="min-w-0 truncate">
            <span className="mr-1.5 text-slate-400">Mã giao dịch</span>
            <span className="font-mono text-slate-700">{transaction.provider_transaction_id}</span>
          </p>
          <p className="min-w-0 truncate">
            <span className="mr-1.5 text-slate-400">Tham chiếu</span>
            <span className="font-mono text-slate-700">{transaction.reference || "Chưa có"}</span>
          </p>
          <p className="lg:text-right">
            <span className="mr-1.5 text-slate-400">Nhận lúc</span>
            <span className="text-slate-700">{formatTime(transaction.received_at)}</span>
          </p>
        </div>
        <details className="group mt-2">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            Dữ liệu gốc
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <pre className="mt-2 max-h-52 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-[10.5px] leading-relaxed text-slate-700">
{JSON.stringify(transaction.raw, null, 2)}
          </pre>
        </details>
      </div>
    </article>
  );
}

export function DepositTransactionsDialog({ deposit, transactions, error, onOpenChange, onRetry }: Props) {
  const incoming = transactions?.filter((transaction) => transaction.direction !== "out") ?? [];
  const heldCount = incoming.filter((transaction) => transaction.credit_status === "held").length;
  const creditedCount = incoming.filter((transaction) => transaction.credit_status === "credited").length;
  const currencies = [...new Set(incoming.map((transaction) => transaction.currency.toUpperCase()))];
  const totalActual = incoming.reduce((sum, transaction) => sum + (numeric(transaction.actual_amount) ?? 0), 0);
  const actualSummary = currencies.length === 1
    ? formatMoney(totalActual, currencies[0])
    : `${incoming.length} giao dịch`;

  if (!deposit) return null;
  const provider = providerMeta(deposit.provider || "sepay");
  const creditedVnd = deposit.status === "paid" ? (deposit.paid_amount ?? deposit.amount) : 0;
  const missingJournal = transactions !== null && !error && deposit.status === "paid" && transactions.length === 0;
  const attentionCount = heldCount + (missingJournal ? 1 : 0);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(820px,calc(100dvh-2rem))] h-auto w-[calc(100vw-1rem)] max-w-[1000px] flex flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-[calc(100vw-2rem)]">
        <DialogHeader className="border-b border-line px-5 py-4 pr-14 text-left sm:px-6 sm:py-5 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn("grid h-10 min-w-10 place-items-center rounded-lg px-2 text-[10px] font-bold tracking-wide", provider.markClass)}>
              {provider.mark}
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[17px] text-slate-950">Giao dịch của lệnh #{deposit.id}</DialogTitle>
              <DialogDescription className="mt-1 text-[12px]">
                {provider.name} · {provider.method} · {deposit.account_email ?? `Tài khoản #${deposit.account_id}`}
              </DialogDescription>
            </div>
            <DepositStatusBadge status={deposit.status} />
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
          <section className="border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
            <div className={cn(
              "mb-4 flex items-start gap-3 rounded-xl border px-3.5 py-3",
              attentionCount > 0
                ? "border-amber-200 bg-amber-50/70"
                : creditedCount > 0
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-slate-200 bg-slate-50",
            )}>
              {attentionCount > 0 ? (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              ) : creditedCount > 0 ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
              ) : (
                <ArrowDownToLine className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              )}
              <div>
                <p className="text-[12px] font-semibold text-slate-900">
                  {missingJournal
                    ? "Đã cộng ví nhưng thiếu nhật ký provider"
                    : heldCount > 0
                      ? `${heldCount} vấn đề cần xử lý`
                    : creditedCount > 0
                      ? "Khoản tiền khớp đã được cộng ví"
                      : "Chưa có khoản tiền nào được cộng ví"}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                  {missingJournal
                    ? "Trạng thái nội bộ là paid nhưng không còn giao dịch provider để đối chiếu. Cần kiểm tra dữ liệu cũ hoặc lịch sử provider."
                    : heldCount > 0
                      ? "Các khoản lệch tiền vẫn được ghi nhận nhưng chưa làm thay đổi số dư khách hàng."
                    : "Số liệu bên dưới được tổng hợp từ nhật ký giao dịch của provider."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 sm:grid-cols-4 sm:divide-y-0">
              <div className="px-3.5 py-3 sm:px-4">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  <Landmark className="h-3 w-3" aria-hidden="true" /> Mục tiêu
                </div>
                <p className="mt-1.5 font-mono text-[14px] font-semibold tabular-nums text-slate-950">
                  {formatMoney(deposit.amount, "VND")}
                </p>
              </div>
              <div className="px-3.5 py-3 sm:px-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Provider ghi nhận</p>
                <p className="mt-1.5 font-mono text-[14px] font-semibold tabular-nums text-slate-950">
                  {transactions === null ? "Đang tải" : actualSummary}
                </p>
              </div>
              <div className="px-3.5 py-3 sm:px-4">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  <WalletCards className="h-3 w-3" aria-hidden="true" /> Đã cộng ví
                </div>
                <p className="mt-1.5 font-mono text-[14px] font-semibold tabular-nums text-emerald-700">
                  {formatMoney(creditedVnd, "VND")}
                </p>
              </div>
              <div className="px-3.5 py-3 sm:px-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Cần xử lý</p>
                <p className={cn("mt-1.5 font-mono text-[14px] font-semibold tabular-nums", attentionCount > 0 ? "text-amber-800" : "text-slate-950")}>
                  {transactions === null
                    ? "Đang tải"
                    : missingJournal
                      ? "1 vấn đề"
                      : `${heldCount} vấn đề`}
                </p>
              </div>
            </div>
          </section>

          <section aria-label="Danh sách giao dịch">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-2.5 sm:px-6">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Tiền provider đã ghi nhận
              </h3>
              {transactions && <span className="text-[11px] text-slate-400">{transactions.length} giao dịch</span>}
            </div>

            {transactions === null && !error ? (
              <div className="space-y-3 bg-white p-5 sm:p-6" aria-label="Đang tải giao dịch">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
                ))}
              </div>
            ) : error ? (
              <div className="grid min-h-64 place-items-center bg-white px-6 py-12 text-center">
                <div>
                  <CircleAlert className="mx-auto h-6 w-6 text-red-500" aria-hidden="true" />
                  <p className="mt-3 text-[13px] font-semibold text-slate-900">Không tải được giao dịch</p>
                  <p className="mt-1 max-w-sm text-[12px] text-slate-500">{error}</p>
                  <Button className="mt-4" size="sm" variant="secondary" onClick={onRetry}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Thử lại
                  </Button>
                </div>
              </div>
            ) : transactions?.length === 0 ? (
              <div className="grid min-h-64 place-items-center bg-white px-6 py-12 text-center">
                <div>
                  <ArrowDownToLine className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
                  <p className="mt-3 text-[13px] font-semibold text-slate-900">Chưa ghi nhận giao dịch nào</p>
                  <p className="mt-1 max-w-md text-[12px] leading-relaxed text-slate-500">
                    Nếu provider đã nhận tiền, đóng cửa sổ này và dùng nút Đối soát để đồng bộ lại.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-white">
                {transactions?.map((transaction) => (
                  <TransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
