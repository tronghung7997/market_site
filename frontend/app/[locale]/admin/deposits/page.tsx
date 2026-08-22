"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

import { api } from "@/lib/api";
import type {
  AdminDepositIntent,
  AdminDepositLedgerEntry,
  AdminDepositLedgerIntent,
  AdminDepositLedgerQuery,
  AdminDepositLedgerResponse,
  AdminDepositTransaction,
} from "@/lib/types";
import { Button, Card, Input, Tag } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DepositStatusBadge } from "@/components/admin";
import {
  AlertCircle,
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Info,
  Landmark,
  RefreshCw,
  RotateCcw,
  Search,
  WalletCards,
  X,
} from "@/components/Icons";
import { cn } from "@/lib/utils/cn";
import { DepositTransactionsDialog, formatMoney, formatTime, numeric, providerMeta } from "./deposit-transactions-dialog";

const PAGE_SIZE = 25;

const STATUS_TABS = [
  { key: "all", label: "Tất cả" },
  { key: "pending", label: "Chờ thanh toán" },
  { key: "paid", label: "Đã nhận tiền" },
  { key: "expired", label: "Hết hạn" },
  { key: "cancelled", label: "Đã huỷ" },
];

const PROVIDER_OPTIONS = [
  { key: "all", label: "Tất cả cổng" },
  { key: "sepay", label: "SePay (Ngân hàng)" },
  { key: "nowpayments", label: "NOWPayments (USDT)" },
  { key: "payos", label: "PayOS" },
];

function incomingTransactions(entry: AdminDepositLedgerEntry) {
  return entry.transactions.filter((transaction) => transaction.direction !== "out");
}

function attentionCount(entry: AdminDepositLedgerEntry): number {
  const transactions = incomingTransactions(entry);
  const held = transactions.filter((transaction) => transaction.credit_status === "held").length;
  const underpaid = transactions.filter((transaction) => transaction.match_status === "underpaid").length;
  const missingJournal = entry.deposit.status === "paid" && transactions.length === 0;
  return held + underpaid + (missingJournal ? 1 : 0);
}

function actualSummary(entry: AdminDepositLedgerEntry): string {
  const transactions = incomingTransactions(entry);
  if (transactions.length === 0) return "Chưa ghi nhận";
  const currencies = [...new Set(transactions.map((t) => t.currency.toUpperCase()))];
  if (currencies.length !== 1) return `${transactions.length} giao dịch`;
  const total = transactions.reduce(
    (sum, t) => sum + (numeric(t.actual_amount) ?? 0),
    0,
  );
  return formatMoney(total, currencies[0]);
}

interface ReconcileFeedback {
  id: string;
  type: "success" | "info" | "warning" | "error";
  title: string;
  message: string;
  depositId?: number;
  entry?: AdminDepositLedgerEntry;
}

export default function AdminDepositsPage() {
  const [ledger, setLedger] = React.useState<AdminDepositLedgerResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Filters & Search
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [providerFilter, setProviderFilter] = React.useState("all");
  const [attentionOnly, setAttentionOnly] = React.useState(false);
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);

  // Reconcile states
  const [reconcilingId, setReconcilingId] = React.useState<number | null>(null);
  const [feedback, setFeedback] = React.useState<ReconcileFeedback | null>(null);
  const [rowStatusMap, setRowStatusMap] = React.useState<Record<number, { text: string; tone: "good" | "warn" | "neutral" | "bad" }>>({});

  // Bulk Reconcile Modal State
  const [bulkModalOpen, setBulkModalOpen] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [bulkProgress, setBulkProgress] = React.useState<{ total: number; current: number; changed: number; errors: number } | null>(null);

  // Detail Modal Popup
  const [selectedEntry, setSelectedEntry] = React.useState<AdminDepositLedgerEntry | null>(null);

  const ledgerRequestRef = React.useRef(0);

  // Debounce search
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(0);
      setSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Server Query with active filters
  const query = React.useMemo<AdminDepositLedgerQuery>(() => ({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(providerFilter !== "all" ? { provider: providerFilter } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(search ? { search } : {}),
  }), [page, providerFilter, statusFilter, search]);

  const loadLedger = React.useCallback(async (q: AdminDepositLedgerQuery) => {
    const requestId = ++ledgerRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.adminDepositLedger(q);
      if (requestId === ledgerRequestRef.current) {
        setLedger(result);
      }
    } catch (err) {
      if (requestId === ledgerRequestRef.current) {
        setError(err instanceof Error ? err.message : "Không tải được danh sách nạp tiền");
      }
    } finally {
      if (requestId === ledgerRequestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    void loadLedger(query);
  }, [loadLedger, query]);

  // Auto-dismiss toast feedback after 6s
  React.useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => {
      setFeedback(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Reset all filters
  const handleResetFilters = () => {
    setStatusFilter("all");
    setProviderFilter("all");
    setAttentionOnly(false);
    setSearchInput("");
    setSearch("");
    setPage(0);
  };

  const isFiltered = statusFilter !== "all" || providerFilter !== "all" || attentionOnly || search !== "";

  // Single Reconcile Action
  const handleReconcile = async (entry: AdminDepositLedgerEntry) => {
    const deposit = entry.deposit;
    setReconcilingId(deposit.id);
    try {
      const result = await api.adminReconcileDeposit(deposit.id);
      const provider = (deposit.provider || "sepay") === "nowpayments" ? "NOWPayments" : "SePay";

      if (result.reconcile_result === "credited" || result.status === "paid") {
        setRowStatusMap((prev) => ({
          ...prev,
          [deposit.id]: { text: "Đã khớp & cộng ví", tone: "good" },
        }));
        setFeedback({
          id: String(Date.now()),
          type: "success",
          title: `Lệnh #${deposit.id}: Đã cộng ví thành công`,
          message: `Xác nhận thanh toán từ ${provider}. Trạng thái: "${result.status}".`,
          depositId: deposit.id,
          entry,
        });
      } else if (result.reconcile_result === "not_found") {
        setRowStatusMap((prev) => ({
          ...prev,
          [deposit.id]: { text: "Chưa có tiền vào", tone: "neutral" },
        }));
        setFeedback({
          id: String(Date.now()),
          type: "info",
          title: `Lệnh #${deposit.id}: Chưa tìm thấy giao dịch`,
          message: `${provider} chưa ghi nhận giao dịch chuyển tiền. Trạng thái: "${result.status}".`,
          depositId: deposit.id,
          entry,
        });
      } else if (result.reconcile_result === "validation_failed") {
        setRowStatusMap((prev) => ({
          ...prev,
          [deposit.id]: { text: "Lệch tiền / Cần kiểm tra", tone: "warn" },
        }));
        setFeedback({
          id: String(Date.now()),
          type: "warning",
          title: `Lệnh #${deposit.id}: Cần kiểm tra thủ công`,
          message: `Giao dịch chưa vượt qua kiểm tra an toàn hoặc số tiền không khớp.`,
          depositId: deposit.id,
          entry,
        });
      } else if (result.reconcile_result === "not_configured") {
        setRowStatusMap((prev) => ({
          ...prev,
          [deposit.id]: { text: "Chưa cấu hình cổng", tone: "warn" },
        }));
        setFeedback({
          id: String(Date.now()),
          type: "warning",
          title: `Lệnh #${deposit.id}: Thiếu cấu hình cổng`,
          message: `Chưa thiết lập tài khoản đối soát cho ${provider}.`,
          depositId: deposit.id,
          entry,
        });
      } else {
        setRowStatusMap((prev) => ({
          ...prev,
          [deposit.id]: { text: `Trạng thái: ${result.status}`, tone: "neutral" },
        }));
        setFeedback({
          id: String(Date.now()),
          type: "info",
          title: `Lệnh #${deposit.id}: Đã kiểm tra`,
          message: `Trạng thái nội bộ hiện tại là "${result.status}".`,
          depositId: deposit.id,
          entry,
        });
      }

      await loadLedger(query);
    } catch (err) {
      setRowStatusMap((prev) => ({
        ...prev,
        [deposit.id]: { text: "Lỗi kết nối", tone: "bad" },
      }));
      setFeedback({
        id: String(Date.now()),
        type: "error",
        title: `Lệnh #${deposit.id}: Lỗi đối soát`,
        message: err instanceof Error ? err.message : "Lỗi kết nối tới cổng thanh toán.",
        depositId: deposit.id,
        entry,
      });
    } finally {
      setReconcilingId(null);
    }
  };

  // Bulk Reconcile Execution
  const rawItems = ledger?.items ?? [];
  const pendingTargets = rawItems.filter((entry) => entry.deposit.status !== "paid");

  const handleStartBulkReconcile = async () => {
    if (pendingTargets.length === 0) return;
    setBulkBusy(true);
    setBulkProgress({ total: pendingTargets.length, current: 0, changed: 0, errors: 0 });

    let changed = 0;
    let errors = 0;

    for (let i = 0; i < pendingTargets.length; i++) {
      const item = pendingTargets[i];
      setBulkProgress({ total: pendingTargets.length, current: i + 1, changed, errors });
      try {
        const r = await api.adminReconcileDeposit(item.deposit.id);
        if (r.status !== item.deposit.status) changed++;
        if (["not_configured", "provider_error", "validation_failed"].includes(r.reconcile_result)) {
          errors++;
        }
      } catch {
        errors++;
      }
    }

    setBulkBusy(false);
    setBulkModalOpen(false);
    setBulkProgress(null);

    setFeedback({
      id: String(Date.now()),
      type: changed > 0 ? "success" : errors > 0 ? "warning" : "info",
      title: `Đối soát hoàn tất: ${pendingTargets.length} lệnh`,
      message: `${changed} lệnh đã cập nhật trạng thái mới.${errors > 0 ? ` Có ${errors} lệnh cần kiểm tra.` : ""}`,
    });

    await loadLedger(query);
  };

  // Client attention filtering over page items
  const displayItems = attentionOnly
    ? rawItems.filter((entry) => attentionCount(entry) > 0)
    : rawItems;

  const totalCount = ledger?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rangeStart = totalCount > 0 ? page * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);

  // Financial Metrics Calculation over current page
  const allTransactions = rawItems.flatMap(incomingTransactions);

  const bankTotal = allTransactions
    .filter((tx) => tx.currency.toUpperCase() === "VND")
    .reduce((sum, tx) => sum + (numeric(tx.actual_amount) ?? 0), 0);

  const cryptoTransactions = allTransactions.filter((tx) => tx.currency.toUpperCase() !== "VND");
  const cryptoCurrencies = [...new Set(cryptoTransactions.map((tx) => tx.currency.toUpperCase()))];
  const cryptoTotal = cryptoTransactions.reduce(
    (sum, tx) => sum + (numeric(tx.actual_amount) ?? 0),
    0,
  );
  const cryptoSummary = cryptoCurrencies.length === 1
    ? formatMoney(cryptoTotal, cryptoCurrencies[0])
    : `${cryptoTransactions.length} gd`;

  const creditedVnd = rawItems
    .filter((entry) => entry.deposit.status === "paid")
    .reduce((sum, entry) => sum + (entry.deposit.paid_amount ?? entry.deposit.amount), 0);

  const attentionOrders = rawItems.filter((entry) => attentionCount(entry) > 0);
  const totalAttentionOrdersCount = attentionOrders.length;
  const totalAttentionIssuesCount = rawItems.reduce((sum, entry) => sum + attentionCount(entry), 0);

  const providerLabel = PROVIDER_OPTIONS.find((p) => p.key === providerFilter)?.label ?? "Tất cả cổng";
  const statusLabel = STATUS_TABS.find((s) => s.key === statusFilter)?.label ?? "Tất cả";

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="space-y-5">
      {/* Viewport-fixed Toast Notification via Portal (100% visible anywhere on screen) */}
      {mounted &&
        createPortal(
          <div className="pointer-events-none fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-2">
            <AnimatePresence>
              {feedback && (
                <motion.aside
                  key={feedback.id}
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 15, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  aria-live="polite"
                  className="pointer-events-auto w-full max-w-[360px] rounded-xl border border-line bg-card p-3.5 shadow-2xl backdrop-blur-md"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div
                        className={cn(
                          "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg",
                          feedback.type === "success" && "bg-good-soft text-good",
                          feedback.type === "info" && "bg-iris-soft text-iris",
                          feedback.type === "warning" && "bg-warn-soft text-warn",
                          feedback.type === "error" && "bg-bad-soft text-bad",
                        )}
                      >
                        {feedback.type === "success" && <CheckCircle2 className="h-4 w-4" />}
                        {feedback.type === "info" && <Info className="h-4 w-4" />}
                        {feedback.type === "warning" && <AlertTriangle className="h-4 w-4" />}
                        {feedback.type === "error" && <AlertCircle className="h-4 w-4" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h4 className="text-[13px] font-semibold text-fg leading-snug">
                          {feedback.title}
                        </h4>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                          {feedback.message}
                        </p>
                        {feedback.entry && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedEntry(feedback.entry!);
                              setFeedback(null);
                            }}
                            className="mt-1.5 h-6 px-2 text-[11.5px] font-semibold text-iris hover:bg-iris-soft"
                          >
                            Xem chi tiết giao dịch →
                          </Button>
                        )}
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFeedback(null)}
                      className="h-6 w-6 shrink-0 p-0 text-faint hover:text-fg"
                      aria-label="Đóng thông báo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>
          </div>,
          document.body,
        )}

      {/* Action Header bar (Title is already rendered by AdminShell) */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-[13px] text-faint">
          Kiểm soát dòng tiền, tra cứu giao dịch ngân hàng / crypto và đối soát realtime.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadLedger(query)}
            disabled={loading || bulkBusy}
            className="h-8.5 text-[12.5px]"
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
            Làm mới
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setBulkModalOpen(true)}
            disabled={bulkBusy || loading || pendingTargets.length === 0}
            className="h-8.5 text-[12.5px]"
          >
            <span>Đối soát {pendingTargets.length > 0 ? `${pendingTargets.length} lệnh` : "các lệnh"} chưa chốt</span>
          </Button>
        </div>
      </div>

      {/* Financial Metrics Ribbon — Mobile 2x2, Desktop 4 Cols, Clickable Attention Card */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-card p-3.5 sm:p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
              Tổng tiền VND
            </span>
            <div className="grid h-6 w-6 sm:h-7 sm:w-7 place-items-center rounded-lg bg-good-soft text-good">
              <Landmark className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <p className="mt-1.5 sm:mt-2 font-mono text-[16px] sm:text-[19px] font-semibold tabular text-fg truncate">
            {ledger ? formatMoney(bankTotal, "VND") : "—"}
          </p>
          <p className="mt-0.5 text-[10.5px] sm:text-[11px] text-faint truncate">
            SePay trong trang
          </p>
        </div>

        <div className="rounded-card border border-line bg-card p-3.5 sm:p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
              Tiền USDT
            </span>
            <div className="grid h-6 w-6 sm:h-7 sm:w-7 place-items-center rounded-lg bg-iris-soft text-iris-hi">
              <Coins className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <p className="mt-1.5 sm:mt-2 font-mono text-[16px] sm:text-[19px] font-semibold tabular text-fg truncate">
            {ledger ? cryptoSummary : "—"}
          </p>
          <p className="mt-0.5 text-[10.5px] sm:text-[11px] text-faint truncate">
            {cryptoTransactions.length} giao dịch NOWPayments
          </p>
        </div>

        <div className="rounded-card border border-line bg-card p-3.5 sm:p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
              Đã cộng ví
            </span>
            <div className="grid h-6 w-6 sm:h-7 sm:w-7 place-items-center rounded-lg bg-good-soft text-good">
              <WalletCards className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <p className="mt-1.5 sm:mt-2 font-mono text-[16px] sm:text-[19px] font-semibold tabular text-good truncate">
            {ledger ? formatMoney(creditedVnd, "VND") : "—"}
          </p>
          <p className="mt-0.5 text-[10.5px] sm:text-[11px] text-faint truncate">
            Thành công của người dùng
          </p>
        </div>

        {/* Clickable Attention Shortcut */}
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setAttentionOnly((prev) => !prev);
              setPage(0);
            }
          }}
          onClick={() => {
            setAttentionOnly((prev) => !prev);
            setPage(0);
          }}
          className={cn(
            "rounded-card border p-3.5 sm:p-4 text-left shadow-card transition-all cursor-pointer select-none",
            attentionOnly
              ? "border-warn bg-warn-soft/80 ring-2 ring-warn/30"
              : totalAttentionOrdersCount > 0
                ? "border-warn/40 bg-warn-soft/30 hover:border-warn hover:bg-warn-soft/50"
                : "border-line bg-card hover:border-line-2",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
              Cần xử lý {attentionOnly && "(Đang lọc)"}
            </span>
            <div
              className={cn(
                "grid h-6 w-6 sm:h-7 sm:w-7 place-items-center rounded-lg",
                totalAttentionOrdersCount > 0 ? "bg-warn-soft text-warn" : "bg-raised text-faint",
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <p
            className={cn(
              "mt-1.5 sm:mt-2 font-mono text-[16px] sm:text-[19px] font-semibold tabular truncate",
              totalAttentionOrdersCount > 0 ? "text-warn" : "text-fg",
            )}
          >
            {ledger ? `${totalAttentionOrdersCount} lệnh (${totalAttentionIssuesCount} vấn đề)` : "—"}
          </p>
          <p className="mt-0.5 text-[10.5px] sm:text-[11px] text-faint truncate">
            {totalAttentionOrdersCount > 0 ? "Bấm để xem danh sách lệch" : "0 vấn đề tồn đọng"}
          </p>
        </div>
      </div>

      {/* Main Container: Toolbar + Table/Mobile Cards */}
      <Card className="overflow-hidden p-0 shadow-card">
        {/* Streamlined Toolbar */}
        <div className="border-b border-line bg-surface p-3.5 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Status Pills (Scrollable horizontally on small screens) */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-raised p-0.5 scrollbar-none">
                {STATUS_TABS.map((tab) => (
                  <Button
                    key={tab.key}
                    variant={statusFilter === tab.key ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => {
                      setStatusFilter(tab.key);
                      setPage(0);
                    }}
                    className={cn(
                      "h-7 whitespace-nowrap px-3 text-[12px] font-semibold",
                      statusFilter === tab.key
                        ? "bg-surface text-fg shadow-card"
                        : "text-muted hover:text-fg",
                    )}
                  >
                    {tab.label}
                  </Button>
                ))}
              </div>

              {/* Provider Selector */}
              <div className="inline-flex rounded-lg border border-line bg-raised p-0.5">
                {PROVIDER_OPTIONS.map((opt) => (
                  <Button
                    key={opt.key}
                    variant={providerFilter === opt.key ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => {
                      setProviderFilter(opt.key);
                      setPage(0);
                    }}
                    className={cn(
                      "h-7 px-2.5 text-[11.5px] font-medium",
                      providerFilter === opt.key
                        ? "bg-surface text-fg shadow-card"
                        : "text-faint hover:text-fg",
                    )}
                  >
                    {opt.key === "all" ? "Tất cả cổng" : opt.key === "sepay" ? "SePay" : opt.key === "nowpayments" ? "NOWPayments" : "PayOS"}
                  </Button>
                ))}
              </div>

              {/* Reset Filters Button */}
              {isFiltered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetFilters}
                  className="h-7 px-2 text-[11.5px] text-faint hover:text-fg"
                  title="Xoá tất cả bộ lọc"
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Xoá lọc
                </Button>
              )}
            </div>

            {/* Search Box */}
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm ID, email, mã tham chiếu…"
                className="h-8.5 pl-9 text-[12px]"
                aria-label="Tìm kiếm trong sổ giao dịch"
              />
            </div>
          </div>
        </div>

        {/* Desktop Structured Data Table (Hidden on Mobile) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-raised/70 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-faint">
                <th className="px-5 py-3">#</th>
                <th className="px-5 py-3">Tài khoản</th>
                <th className="px-5 py-3">Cổng nạp</th>
                <th className="px-5 py-3 text-right">Số tiền</th>
                <th className="px-5 py-3">Trạng thái lệnh</th>
                <th className="px-5 py-3">Tiền vào / Đối soát</th>
                <th className="px-5 py-3">Thời gian</th>
                <th className="px-5 py-3 text-right">Hành động</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-line">
              {loading && !ledger ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-faint">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-iris" />
                      <span>Đang tải danh sách lệnh nạp…</span>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center">
                    <AlertCircle className="mx-auto h-6 w-6 text-bad" />
                    <p className="mt-2 text-[13px] font-semibold text-fg">Không tải được dữ liệu</p>
                    <p className="mt-0.5 text-[12px] text-faint">{error}</p>
                    <Button className="mt-3" size="sm" variant="secondary" onClick={() => void loadLedger(query)}>
                      Thử lại
                    </Button>
                  </td>
                </tr>
              ) : displayItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-faint">
                    <BookOpenCheck className="mx-auto h-7 w-7 text-faint mb-2" />
                    <p className="text-[13px] font-semibold text-fg">Không có lệnh nạp nào khớp bộ lọc</p>
                    <p className="text-[12px] mt-0.5">Thử đổi trạng thái, cổng nạp hoặc xoá từ khoá tìm kiếm.</p>
                  </td>
                </tr>
              ) : (
                displayItems.map((entry) => {
                  const d = entry.deposit;
                  const provider = providerMeta(d.provider);
                  const txs = incomingTransactions(entry);
                  const att = attentionCount(entry);
                  const missingJournal = d.status === "paid" && txs.length === 0;
                  const credited = d.status === "paid" && !missingJournal;

                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedEntry(entry)}
                      className="cursor-pointer transition-colors hover:bg-raised/50"
                    >
                      {/* ID */}
                      <td className="px-5 py-3 font-mono font-semibold text-fg whitespace-nowrap">
                        #{d.id}
                      </td>

                      {/* Account */}
                      <td className="px-5 py-3 max-w-[200px]">
                        <div className="truncate font-medium text-fg" title={d.account_email ?? ""}>
                          {d.account_email ?? `Tài khoản #${d.account_id}`}
                        </div>
                        <div className="text-[11px] text-faint">
                          Tạo: {formatTime(d.created_at)}
                        </div>
                      </td>

                      {/* Provider */}
                      <td className="px-5 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={cn("grid h-6 min-w-6 place-items-center rounded-md px-1 text-[8.5px] font-bold", provider.markClass)}>
                            {provider.mark}
                          </span>
                          <div>
                            <span className="font-semibold text-fg text-[12px]">{provider.name}</span>
                            {d.now_payment_id && (
                              <div className="font-mono text-[10px] text-faint truncate max-w-[110px]" title={d.now_payment_id}>
                                {d.now_payment_id}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <div className="font-mono font-semibold tabular text-fg">
                          {formatMoney(d.paid_amount ?? d.amount, "VND")}
                        </div>
                        {d.paid_amount != null && d.paid_amount !== d.amount && (
                          <div className="text-[10.5px] text-warn">
                            dự kiến {formatMoney(d.amount, "VND")}
                          </div>
                        )}
                      </td>

                      {/* Intent Status */}
                      <td className="px-5 py-3 whitespace-nowrap">
                        <DepositStatusBadge status={d.status} />
                      </td>

                      {/* Ledger / Settlement Status */}
                      <td className="px-5 py-3 whitespace-nowrap">
                        {missingJournal ? (
                          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-warn">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            Thiếu log provider
                          </span>
                        ) : att > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-warn">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            {att} vấn đề
                          </span>
                        ) : credited ? (
                          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-good">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            Đã cộng ví
                          </span>
                        ) : txs.length > 0 ? (
                          <span className="text-[11.5px] font-medium text-muted">Chưa cộng ví</span>
                        ) : (
                          <span className="text-[11.5px] text-faint">Chưa có tiền vào</span>
                        )}
                        {txs.length > 0 && (
                          <div className="text-[10.5px] text-faint">
                            {actualSummary(entry)}
                          </div>
                        )}
                      </td>

                      {/* Paid Timestamp */}
                      <td className="px-5 py-3 whitespace-nowrap text-faint text-[12px]">
                        {d.paid_at ? (
                          <div>
                            <span>{formatTime(d.paid_at)}</span>
                            {d.payment_code && (
                              <div className="font-mono text-[10.5px] text-faint">
                                code: {d.payment_code}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span>—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          {rowStatusMap[d.id] && (
                            <span
                              className={cn(
                                "text-[11px] font-medium animate-fade-in",
                                rowStatusMap[d.id].tone === "good" && "text-good font-semibold",
                                rowStatusMap[d.id].tone === "warn" && "text-warn font-semibold",
                                rowStatusMap[d.id].tone === "bad" && "text-bad font-semibold",
                                rowStatusMap[d.id].tone === "neutral" && "text-faint",
                              )}
                            >
                              {rowStatusMap[d.id].text}
                            </span>
                          )}

                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setSelectedEntry(entry)}
                            className="h-7 px-2.5 text-[12px]"
                          >
                            Xem giao dịch
                          </Button>

                          {d.status !== "paid" && (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={reconcilingId === d.id || bulkBusy}
                              onClick={() => void handleReconcile(entry)}
                              className="h-7 px-2.5 text-[12px]"
                            >
                              {reconcilingId === d.id ? (
                                <span className="flex items-center gap-1">
                                  <RefreshCw className="h-3 w-3 animate-spin text-surface" />
                                  <span>Đang quét…</span>
                                </span>
                              ) : (
                                "Đối soát"
                              )}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Card View (Shown on Mobile Only) */}
        <div className="sm:hidden divide-y divide-line">
          {loading && !ledger ? (
            <div className="p-6 text-center text-faint">
              <RefreshCw className="mx-auto h-5 w-5 animate-spin text-iris" />
              <p className="mt-2 text-[12px]">Đang tải danh sách lệnh…</p>
            </div>
          ) : displayItems.length === 0 ? (
            <div className="p-8 text-center text-faint">
              <BookOpenCheck className="mx-auto h-7 w-7 text-faint mb-2" />
              <p className="text-[13px] font-semibold text-fg">Không có lệnh nạp nào</p>
            </div>
          ) : (
            displayItems.map((entry) => {
              const d = entry.deposit;
              const provider = providerMeta(d.provider);
              const txs = incomingTransactions(entry);
              const att = attentionCount(entry);
              const missingJournal = d.status === "paid" && txs.length === 0;
              const credited = d.status === "paid" && !missingJournal;

              return (
                <article
                  key={d.id}
                  onClick={() => setSelectedEntry(entry)}
                  className="p-4 space-y-2.5 active:bg-raised/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-bold text-[13px] text-fg">#{d.id}</span>
                      <span className={cn("grid h-5 min-w-5 place-items-center rounded px-1 text-[8px] font-bold", provider.markClass)}>
                        {provider.mark}
                      </span>
                      <span className="truncate text-[12.5px] font-medium text-fg" title={d.account_email ?? ""}>
                        {d.account_email ?? `User #${d.account_id}`}
                      </span>
                    </div>
                    <DepositStatusBadge status={d.status} />
                  </div>

                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-faint">{formatTime(d.created_at)}</span>
                    <span className="font-mono font-bold tabular text-fg text-[13.5px]">
                      {formatMoney(d.paid_amount ?? d.amount, "VND")}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11.5px] border-t border-line/60 pt-2">
                    <div>
                      {missingJournal ? (
                        <span className="text-warn font-semibold">Thiếu log provider</span>
                      ) : att > 0 ? (
                        <span className="text-warn font-semibold">{att} vấn đề</span>
                      ) : credited ? (
                        <span className="text-good font-semibold">Đã cộng ví</span>
                      ) : (
                        <span className="text-faint">Chưa có tiền vào</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setSelectedEntry(entry)}
                        className="h-7 px-2.5 text-[11.5px]"
                      >
                        Chi tiết
                      </Button>
                      {d.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={reconcilingId === d.id || bulkBusy}
                          onClick={() => void handleReconcile(entry)}
                          className="h-7 px-2.5 text-[11.5px]"
                        >
                          {reconcilingId === d.id ? "Quét…" : "Đối soát"}
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {/* Server Pagination Footer with Precise Scope */}
        {totalCount > 0 && (
          <nav
            aria-label="Phân trang sổ giao dịch"
            className="flex items-center justify-between border-t border-line bg-surface px-4 py-3 sm:px-5"
          >
            <Button
              size="sm"
              variant="secondary"
              disabled={page === 0 || loading}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              className="h-8 text-[12px]"
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Trang trước</span>
            </Button>

            <div className="text-center">
              <p className="text-[12px] font-semibold text-fg">
                Trang {page + 1} / {totalPages}
              </p>
              <p className="text-[10.5px] text-faint">
                {attentionOnly
                  ? `${displayItems.length} lệnh cần xử lý trong trang`
                  : `${rangeStart}–${rangeEnd} trong ${totalCount} kết quả (${statusLabel} · ${providerLabel})`}
              </p>
            </div>

            <Button
              size="sm"
              variant="secondary"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              className="h-8 text-[12px]"
            >
              <span className="hidden sm:inline">Trang sau</span>
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </nav>
        )}
      </Card>

      {/* Safe Bulk Reconcile Confirmation Dialog */}
      <Dialog open={bulkModalOpen} onOpenChange={(open) => !bulkBusy && setBulkModalOpen(open)}>
        <DialogContent className="max-w-md p-5 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-[16px] font-semibold text-fg">
              Xác nhận đối soát hàng loạt
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[12.5px] text-muted leading-relaxed">
              Bạn đang chuẩn bị đối soát <strong>{pendingTargets.length} lệnh chưa chốt</strong> trong phạm vi <strong>{providerLabel}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="my-3 rounded-xl border border-line bg-raised p-3 text-[12px] text-muted space-y-1">
            <p>• Hệ thống sẽ truy vấn API của cổng thanh toán tương ứng.</p>
            <p>• Các lệnh đã nhận đủ tiền sẽ được tự động chuyển sang <strong>Đã nhận tiền</strong> và cộng số dư ví.</p>
          </div>

          {bulkProgress && (
            <div className="my-2 space-y-1.5">
              <div className="flex items-center justify-between text-[11.5px] font-medium text-fg">
                <span>Đang xử lý {bulkProgress.current} / {bulkProgress.total} lệnh…</span>
                <span>{Math.round((bulkProgress.current / bulkProgress.total) * 100)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full bg-iris transition-all duration-200"
                  style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={bulkBusy}
              onClick={() => setBulkModalOpen(false)}
            >
              Huỷ
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={bulkBusy || pendingTargets.length === 0}
              onClick={handleStartBulkReconcile}
            >
              {bulkBusy ? (
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Đang thực thi…</span>
                </span>
              ) : (
                `Bắt đầu đối soát (${pendingTargets.length} lệnh)`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction Details Modal Popup (Adaptive Content Height) */}
      <DepositTransactionsDialog
        deposit={selectedEntry ? selectedEntry.deposit : null}
        transactions={selectedEntry ? selectedEntry.transactions : null}
        error={null}
        onOpenChange={(open) => {
          if (!open) setSelectedEntry(null);
        }}
        onRetry={() => {
          if (selectedEntry) {
            void loadLedger(query);
          }
        }}
      />
    </div>
  );
}



