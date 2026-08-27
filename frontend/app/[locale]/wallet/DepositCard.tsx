"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { timeLeftFine } from "@/lib/time";
import type { DepositIntent, DepositMethod, DepositMethods } from "@/lib/types";
import { Button, Card, Tag } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";

const PRESET_VND = [100_000, 500_000, 1_000_000, 5_000_000];
const PRESET_USD = [5, 20, 50, 100];
const qrImageLoader = ({ src }: { src: string }) => src;

type MethodsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; methods: DepositMethods };

/**
 * Smallest USD (2dp) that still passes Math.round(usd * fxRate) >= minVnd.
 * Plain formatBrowseMoney(minVnd) rounds half-down (e.g. 10_000/26_000 → 0.38$)
 * so typing that amount yields 9_999 VND and the create button stays disabled.
 */
function minPayableUsd(minVnd: number, fxRate: number): number {
  if (!(fxRate > 0) || minVnd <= 0) return 0;
  let cents = Math.ceil((minVnd / fxRate) * 100);
  while (Math.round((cents / 100) * fxRate) < minVnd) {
    cents += 1;
  }
  return cents / 100;
}

/**
 * Largest USD (2dp) that still passes Math.round(usd * fxRate) <= maxVnd.
 * Mirrors minPayableUsd so max labels stay payable under the same rounding.
 */
function maxPayableUsd(maxVnd: number, fxRate: number): number {
  if (!(fxRate > 0) || maxVnd <= 0) return 0;
  let cents = Math.floor((maxVnd / fxRate) * 100);
  while (cents > 0 && Math.round((cents / 100) * fxRate) > maxVnd) {
    cents -= 1;
  }
  return cents / 100;
}

function formatUsdAmount(usd: number, locale: string): string {
  const loc = locale === "vi" || locale.startsWith("vi") ? "vi-VN" : "en-US";
  return new Intl.NumberFormat(loc, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

/** Keep USD typing bounded so JS number + FX math stay sane. */
const USD_INPUT_MAX_INT_DIGITS = 9;

export default function DepositCard({ deposits, onChanged }: {
  deposits: DepositIntent[];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("wallet");
  const td = useTranslations("status.deposit");
  const locale = useLocale();
  const { currency, formatBrowseMoney, formatLedgerMoney, fxRate, showFxHints } = useMoney();

  const [methodsState, setMethodsState] = useState<MethodsState>({ status: "loading" });
  const [method, setMethod] = useState<DepositMethod>("sepay");
  const [userPickedMethod, setUserPickedMethod] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPendingId, setSelectedPendingId] = useState<number | null>(null);
  const [paidDeposit, setPaidDeposit] = useState<DepositIntent | null>(null);
  const previousDepositStatuses = useRef<Map<number, string> | null>(null);

  const loadMethods = useCallback(async () => {
    setMethodsState({ status: "loading" });
    try {
      const m = await api.depositMethods();
      setMethodsState({ status: "ready", methods: m });
    } catch (e) {
      setMethodsState({
        status: "error",
        message: e instanceof Error ? e.message : t("depositMethodsLoadFail"),
      });
    }
  }, [t]);

  useEffect(() => {
    void loadMethods();
  }, [loadMethods]);

  const methods = methodsState.status === "ready" ? methodsState.methods : null;
  const sepayOn = Boolean(methods?.sepay_enabled);
  const nowOn = Boolean(methods?.nowpayments_enabled);
  const anyRail = sepayOn || nowOn;
  const showRailSwitch = sepayOn && nowOn;

  // Default rail from display currency; keep user override when both available.
  useEffect(() => {
    if (!methods) return;
    if (userPickedMethod && showRailSwitch) return;

    if (currency === "USD" && methods.nowpayments_enabled) {
      setMethod("nowpayments");
    } else if (methods.sepay_enabled) {
      setMethod("sepay");
    } else if (methods.nowpayments_enabled) {
      setMethod("nowpayments");
    }
  }, [currency, methods, userPickedMethod, showRailSwitch]);

  const isUsdt = method === "nowpayments";
  const minVnd = isUsdt
    ? (methods?.deposit_usdt_min_vnd ?? 50_000)
    : (methods?.deposit_min_amount ?? 10_000);
  const maxVnd = isUsdt
    ? (methods?.deposit_usdt_max_vnd ?? 50_000_000)
    : (methods?.deposit_max_amount ?? 100_000_000);

  const minUsd = useMemo(() => {
    if (currency === "USD" && fxRate && fxRate > 0) {
      return minPayableUsd(minVnd, fxRate);
    }
    return null;
  }, [currency, fxRate, minVnd]);

  const maxUsd = useMemo(() => {
    if (currency === "USD" && fxRate && fxRate > 0) {
      return maxPayableUsd(maxVnd, fxRate);
    }
    return null;
  }, [currency, fxRate, maxVnd]);

  const amountVnd = useMemo(() => {
    if (currency === "USD" && fxRate && fxRate > 0) {
      const usd = parseFloat(amount) || 0;
      if (usd <= 0) return 0;
      // Match the 2-decimal USD input so 0.3899 cannot sneak past the min label.
      const cents = Math.round(usd * 100) / 100;
      return Math.round(cents * fxRate);
    }
    return parseInt(amount, 10) || 0;
  }, [amount, currency, fxRate]);

  const amountUsd = useMemo(() => {
    if (currency !== "USD") return null;
    const usd = parseFloat(amount);
    if (!Number.isFinite(usd) || usd <= 0) return 0;
    return Math.round(usd * 100) / 100;
  }, [amount, currency]);

  const hasAmount = amountVnd > 0;
  const meetsMin =
    hasAmount &&
    amountVnd >= minVnd &&
    (minUsd == null || (amountUsd != null && amountUsd >= minUsd));
  const meetsMax =
    !hasAmount ||
    (amountVnd <= maxVnd &&
      (maxUsd == null || (amountUsd != null && amountUsd <= maxUsd)));
  const amountInRange = meetsMin && meetsMax;

  const canCreate =
    anyRail && amountInRange && !loading && methodsState.status === "ready";

  const formatMinLabel = useMemo(() => {
    if (minUsd != null) return formatUsdAmount(minUsd, locale);
    return formatLedgerMoney(minVnd, locale);
  }, [minUsd, minVnd, locale, formatLedgerMoney]);

  const formatMaxLabel = useMemo(() => {
    if (maxUsd != null) return formatUsdAmount(maxUsd, locale);
    return formatLedgerMoney(maxVnd, locale);
  }, [maxUsd, maxVnd, locale, formatLedgerMoney]);

  const pending = deposits.filter((d) => d.status === "pending");
  const recent = deposits.filter((d) => d.status !== "pending").slice(0, 3);
  // Once a user has opened a specific deposit, never silently switch the modal
  // to another pending order when that order is paid or expires.
  const activePending = selectedPendingId === null
    ? pending[0] ?? null
    : pending.find((d) => d.id === selectedPendingId) ?? null;

  // Show the success dialog only for a real pending -> paid transition. This
  // avoids surprising users with a dialog on initial page load.
  useEffect(() => {
    const previous = previousDepositStatuses.current;
    if (previous) {
      const newlyPaid = deposits.find(
        (deposit) => deposit.status === "paid" && previous.get(deposit.id) === "pending",
      );
      if (newlyPaid) {
        setPaidDeposit(newlyPaid);
        setIsModalOpen(false);
        setSelectedPendingId(null);
      }
    }
    previousDepositStatuses.current = new Map(deposits.map((deposit) => [deposit.id, deposit.status]));
  }, [deposits]);

  // Auto-close as soon as the selected deposit leaves pending (paid, expired,
  // or cancelled). This also prevents a stale modal after a webhook refresh.
  useEffect(() => {
    if (selectedPendingId !== null) {
      const found = deposits.find((d) => d.id === selectedPendingId);
      if (found && found.status !== "pending") {
        setIsModalOpen(false);
        setSelectedPendingId(null);
      }
    }
  }, [deposits, selectedPendingId]);

  const handleCreate = async () => {
    if (methodsState.status !== "ready" || !anyRail) return;
    if (!meetsMin) {
      setErr(t("depositMinError", { amount: formatMinLabel }));
      return;
    }
    if (!meetsMax) {
      setErr(t("depositMaxError", { amount: formatMaxLabel }));
      return;
    }
    if (isUsdt && !nowOn) {
      setErr(t("depositUsdtUnavailable"));
      return;
    }
    if (!isUsdt && !sepayOn) {
      setErr(t("depositBankUnavailable"));
      return;
    }

    setLoading(true);
    setMsg("");
    setErr("");
    const payTab = isUsdt ? window.open("about:blank", "_blank") : null;
    try {
      const intent = await api.createDeposit(amountVnd, {
        method,
      });
      setAmount("");
      setSelectedPendingId(intent.id);
      // NOWPayments owns the payment screen. SePay keeps the in-app QR modal.
      setIsModalOpen(!isUsdt);
      if (intent.checkout_url && payTab) {
        payTab.location.href = intent.checkout_url;
      } else if (payTab) {
        payTab.close();
      }
      await onChanged();
    } catch (e) {
      if (payTab) payTab.close();
      const raw = e instanceof Error ? e.message : "";
      if (/tối đa|maximum|max/i.test(raw)) {
        setErr(t("depositMaxError", { amount: formatMaxLabel }));
      } else if (/tối thiểu|minimum|min/i.test(raw)) {
        setErr(t("depositMinError", { amount: formatMinLabel }));
      } else {
        setErr(raw || t("depositCreateFail"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (id: number) => {
    setErr("");
    try {
      await api.cancelDeposit(id);
      if (selectedPendingId === id) {
        setIsModalOpen(false);
        setSelectedPendingId(null);
      }
      await onChanged();
    } catch (e) {
      setErr(t("depositCancelFail", { error: e instanceof Error ? e.message : "Không xác định" }));
    }
  };

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const formatAmountLabel = (vnd: number) =>
    currency === "USD" && fxRate
      ? formatBrowseMoney(vnd, { locale })
      : formatLedgerMoney(vnd, locale);

  const presets = currency === "USD" && fxRate ? PRESET_USD : PRESET_VND;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line bg-raised/30 px-4 py-3 sm:px-5">
          <h3 className="text-[13px] font-semibold">{t("depositTitle")}</h3>
          {methodsState.status === "ready" && anyRail && (
            <Tag tone={isUsdt ? "good" : "iris"}>
              {isUsdt ? t("depositRailTagUsdt") : t("depositRailTag")}
            </Tag>
          )}
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          {methodsState.status === "loading" && (
            <div className="py-8 text-center text-[13px] text-muted">{t("depositMethodsLoading")}</div>
          )}

          {methodsState.status === "error" && (
            <div className="space-y-3 py-4 text-center">
              <p className="text-[13px] text-bad">{methodsState.message}</p>
              <Button variant="secondary" size="sm" onClick={() => void loadMethods()}>
                {t("depositMethodsRetry")}
              </Button>
            </div>
          )}

          {methodsState.status === "ready" && !anyRail && (
            <div className="space-y-3 py-6 text-center">
              <p className="text-[13px] text-muted">{t("depositNoRails")}</p>
              <Button variant="secondary" size="sm" onClick={() => void loadMethods()}>
                {t("depositMethodsRetry")}
              </Button>
            </div>
          )}

          {pending.length > 0 && (
            <section className="space-y-2.5" aria-label={t("pendingDepositsAria")}>
              <div className="flex items-center justify-between px-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-fg">
                    {t("pendingDeposits")}
                  </span>
                  <span className="rounded-full bg-iris-soft px-2 py-0.5 text-[10px] font-semibold text-iris">
                    {pending.length}
                  </span>
                </div>
                <span className="text-[10.5px] text-muted">
                  {t("depositOpenNeeded")}
                </span>
              </div>

              <div className="space-y-2">
                {pending.map((deposit) => {
                  const isUsdtDeposit = deposit.provider === "nowpayments";
                  const timeLeft = timeLeftFine(deposit.expires_at, locale);
                  return (
                    <div key={deposit.id} className="rounded-xl border border-iris/35 bg-iris-soft/35 p-3.5 sm:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-iris" aria-hidden />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-[12.5px] font-semibold text-fg">
                                {isUsdtDeposit ? "USDT" : "SePay"}
                              </span>
                              <span className="text-[10.5px] text-muted">#{deposit.id}</span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted">
                              {timeLeft ? t("depositWaiting", { time: timeLeft }) : t("depositExpiring")}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-[17px] font-bold tabular text-fg">
                          {formatAmountLabel(deposit.amount)}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-iris/20 pt-2.5">
                        <span className="min-w-0 text-[11.5px] leading-snug text-muted">
                          {isUsdtDeposit ? t("depositPaymentMethodUsdt") : t("depositPaymentMethodValue")}
                        </span>
                        {isUsdtDeposit && deposit.checkout_url ? (
                          <a href={deposit.checkout_url} target="_blank" rel="noopener noreferrer">
                            <Button variant="primary" size="sm" className="font-semibold">
                              {t("depositOpenPay")}
                            </Button>
                          </a>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setSelectedPendingId(deposit.id);
                              setIsModalOpen(true);
                            }}
                            className="font-semibold"
                          >
                            {t("depositOpenQrModal")}
                          </Button>
                        )}
                      </div>

                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleCancel(deposit.id)}
                          className="text-[11px] text-faint transition-colors hover:text-bad cursor-pointer"
                        >
                          {t("depositCancel")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {methodsState.status === "ready" && anyRail && (
            <>
              {showRailSwitch && (
                <div className="flex rounded-lg border border-line p-0.5 bg-raised/40">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setMethod("sepay");
                      setUserPickedMethod(true);
                      setErr("");
                    }}
                    className={cn(
                      "flex-1 h-8 rounded-md text-[12px] font-medium transition-colors cursor-pointer",
                      method === "sepay"
                        ? "bg-surface text-fg shadow-sm border border-line"
                        : "text-muted hover:text-fg",
                    )}
                  >
                    {t("depositRailBank")}
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setMethod("nowpayments");
                      setUserPickedMethod(true);
                      setErr("");
                    }}
                    className={cn(
                      "flex-1 h-8 rounded-md text-[12px] font-medium transition-colors cursor-pointer",
                      method === "nowpayments"
                        ? "bg-surface text-fg shadow-sm border border-line"
                        : "text-muted hover:text-fg",
                    )}
                  >
                    {t("depositRailUsdt")}
                  </button>
                </div>
              )}

              <div className="space-y-1.5 rounded-lg border border-line bg-raised/40 px-3 py-3 sm:px-3.5">
                <div className="grid grid-cols-[88px_minmax(0,1fr)] items-baseline gap-3 text-[12.5px]">
                  <span className="text-muted">{t("depositPaymentMethod")}</span>
                  <span className="min-w-0 text-right font-medium leading-snug">
                    {isUsdt ? t("depositPaymentMethodUsdt") : t("depositPaymentMethodValue")}
                  </span>
                </div>
                {amountInRange && (
                  <div className="grid grid-cols-[88px_minmax(0,1fr)] items-baseline gap-3 border-t border-line/70 pt-1.5 text-[12.5px]">
                    <span className="text-muted">{t("depositYouWillTransfer")}</span>
                    <span className="text-right font-mono font-semibold tabular text-fg">
                      {formatAmountLabel(amountVnd)}
                    </span>
                  </div>
                )}
                {showFxHints && currency === "USD" && (
                  <p className="text-[11px] text-faint pt-1">{t("depositLedgerNote", { currency: "USD" })}</p>
                )}
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-faint font-medium">{t("depositAmount")}</span>
                  <span className="text-[11px] text-faint text-right">
                    {t("depositMin", { amount: formatMinLabel })}
                  </span>
                </div>
                {currency === "USD" && fxRate ? (
                  <div className="relative">
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      value={amount}
                      onChange={(e) => {
                        let v = e.target.value.replace(/[^\d.]/g, "");
                        const dot = v.indexOf(".");
                        if (dot !== -1) {
                          const intPart = v.slice(0, dot).slice(0, USD_INPUT_MAX_INT_DIGITS);
                          const frac = v.slice(dot + 1).replace(/\./g, "").slice(0, 2);
                          v = frac.length > 0 || v.endsWith(".") ? `${intPart}.${frac}` : intPart;
                        } else {
                          v = v.slice(0, USD_INPUT_MAX_INT_DIGITS);
                        }
                        setAmount(v);
                        setErr("");
                      }}
                      onBlur={() => {
                        if (!amount) return;
                        const usd = parseFloat(amount);
                        if (!Number.isFinite(usd) || usd <= 0) return;
                        setAmount((Math.round(usd * 100) / 100).toFixed(2));
                      }}
                      placeholder="e.g. 20.00"
                      disabled={loading}
                      aria-invalid={hasAmount && !meetsMax}
                      className={cn(
                        "h-10 w-full rounded-lg bg-surface border pl-3 pr-9 text-sm text-fg",
                        "font-mono tabular-nums text-right",
                        "placeholder:text-faint placeholder:font-sans placeholder:text-left",
                        "transition-colors focus:bg-panel",
                        "disabled:opacity-60 disabled:cursor-not-allowed",
                        hasAmount && !meetsMax
                          ? "border-bad focus:border-bad"
                          : "border-line focus:border-iris",
                      )}
                    />
                    <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-faint font-medium select-none">
                      $
                    </span>
                    {hasAmount && !meetsMax && (
                      <p className="mt-1 text-[11px] text-bad">
                        {t("depositMaxError", { amount: formatMaxLabel })}
                      </p>
                    )}
                    {showFxHints && amountInRange && amountVnd > 0 && (
                      <p className="mt-1 text-[11px] text-muted tabular-nums">
                        ≈ {formatLedgerMoney(amountVnd, locale)}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <MoneyInput
                      value={amount}
                      onValueChange={(v) => { setAmount(v); setErr(""); }}
                      placeholder={t("depositPlaceholder")}
                      disabled={loading}
                    />
                    {hasAmount && !meetsMax && (
                      <p className="mt-1 text-[11px] text-bad">
                        {t("depositMaxError", { amount: formatMaxLabel })}
                      </p>
                    )}
                  </div>
                )}
                <div className="flex gap-1.5 mt-2">
                  {presets.map((preset) => {
                    const label = currency === "USD" && fxRate
                      ? `$${preset}`
                      : preset >= 1_000_000
                        ? t("depositMillion", { n: preset / 1_000_000 })
                        : `${preset / 1000}K`;
                    const raw = String(preset);
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAmount(raw)}
                        disabled={loading}
                        className={cn(
                          "flex-1 h-7 rounded-md border text-[11.5px] font-mono tabular transition-colors cursor-pointer",
                          amount === raw
                            ? "border-iris bg-iris-soft text-iris font-semibold"
                            : "border-line bg-surface text-muted hover:border-iris/40 hover:text-fg",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button
                variant="primary"
                size="md"
                block
                onClick={handleCreate}
                disabled={!canCreate}
              >
                {loading
                  ? t("depositCreating")
                  : amountInRange
                    ? t("depositCreateAmount", { amount: formatAmountLabel(amountVnd) })
                    : t("depositCreate")}
              </Button>
              <p className="text-[11.5px] text-faint leading-relaxed">
                {isUsdt
                  ? (showFxHints ? t("depositHintUsdt") : t("depositHintUsdtClean"))
                  : t("depositHint")}
              </p>
            </>
          )}

          {msg && (
            <div className="p-2.5 rounded-lg bg-good-soft text-good text-[12px]">✓ {msg}</div>
          )}
          {err && (
            <div className="p-2.5 rounded-lg bg-bad-soft text-bad text-[12px]">{err}</div>
          )}

          {recent.length > 0 && (
            <div className="pt-1 space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider text-faint font-medium">{t("depositRecent")}</div>
              {recent.map((d) => (
                <div key={d.id} className="flex items-center justify-between text-[12.5px]">
                  <span className="font-mono tabular flex items-center gap-2">
                    {formatAmountLabel(d.paid_amount ?? d.amount)}
                    <span className="text-[10px] text-faint uppercase">
                      {(d.provider || "sepay") === "nowpayments" ? "USDT" : "SePay"}
                    </span>
                  </span>
                  <Tag tone={d.status === "paid" ? "good" : d.status === "expired" ? "bad" : "neutral"}>
                    {td.has(d.status) ? td(d.status as "pending") : d.status}
                  </Tag>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* FOCUSED PAYMENT MODAL POPUP */}
      {isModalOpen && activePending && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in-0 duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
        >
          <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[440px] flex-col overflow-y-auto rounded-2xl bg-surface border border-line p-4 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200 sm:p-6">
            {/* Close X Button */}
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-faint hover:text-fg hover:bg-raised transition-colors cursor-pointer"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>

            {/* Modal Header */}
            <div className="pr-8 pl-1 text-left">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-iris" aria-hidden />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-iris">
                  {(activePending.provider || "sepay") === "nowpayments" ? "USDT" : "SePay"}
                </span>
              </div>
              <h3 className="text-[18px] font-bold leading-tight text-fg tracking-tight">
                {t("depositModalTitle")}
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                {(activePending.provider || "sepay") === "nowpayments"
                  ? t("depositModalSubtitleUsdt")
                  : t("depositModalSubtitle")}
              </p>
            </div>

            {/* SePay Bank Transfer QR Section */}
            {(activePending.provider || "sepay") !== "nowpayments" && (
              <div className="space-y-3">
                <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-white p-3 shadow-sm mx-auto w-full">
                  {activePending.qr_code ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activePending.qr_code}
                      alt={t("depositQrAlt")}
                      className="h-[min(48vw,208px)] w-[min(48vw,208px)] max-h-[208px] max-w-[208px] object-contain"
                      loading="eager"
                    />
                  ) : activePending.bank_account_number && activePending.payment_code ? (
                    <QRCodeSVG
                      value={`https://qr.sepay.vn/img?acc=${activePending.bank_account_number}&bank=${activePending.bank_code || "TPB"}&amount=${activePending.amount}&des=${activePending.payment_code}`}
                      size={190}
                      level="M"
                    />
                  ) : null}
                  <div className="mt-2.5 text-center">
                    <div className="text-[11px] text-slate-500 font-medium">
                      {t("depositAmountExact")}
                    </div>
                    <div className="font-mono text-[20px] font-bold text-slate-900 leading-tight">
                      {formatLedgerMoney(activePending.amount, locale)}
                      {currency === "USD" && fxRate && (
                        <span className="text-[13px] font-normal text-slate-500 ml-1.5">
                          ({formatBrowseMoney(activePending.amount, { locale })})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-[12px]">
                  {activePending.bank_account_number && (
                    <div className="rounded-lg border border-line bg-raised/40 p-3 flex items-center justify-between">
                      <div className="min-w-0 pr-2">
                        <div className="text-[10px] text-faint uppercase tracking-wider font-medium">
                          {t("depositBankAccount")} ({activePending.bank_code || "TPBank"})
                        </div>
                        <div className="font-mono font-bold text-[14.5px] text-fg mt-0.5 break-all">
                          {activePending.bank_account_number}
                        </div>
                        {activePending.bank_account_name && (
                          <div className="text-[11px] text-muted truncate">
                            {activePending.bank_account_name}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyValue(`${activePending.id}:account`, activePending.bank_account_number!)}
                        className="shrink-0 px-3 py-1.5 rounded-md bg-surface border border-line text-iris hover:bg-iris hover:text-white transition-colors text-[11.5px] font-semibold cursor-pointer"
                      >
                        {copiedKey === `${activePending.id}:account` ? t("depositCopied") : t("depositCopy")}
                      </button>
                    </div>
                  )}

                  {activePending.payment_code && (
                    <div className="rounded-lg border border-iris/40 bg-iris-soft/40 p-3 flex items-center justify-between">
                      <div className="min-w-0 pr-2">
                        <div className="text-[10px] text-iris uppercase tracking-wider font-semibold">
                          {t("depositTransferContent")} (Bắt buộc)
                        </div>
                        <div className="font-mono font-bold text-iris text-[15px] mt-0.5 break-all">
                          {activePending.payment_code}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyValue(`${activePending.id}:code`, activePending.payment_code!)}
                        className="shrink-0 px-3 py-1.5 rounded-md bg-iris text-white hover:bg-iris/90 transition-colors text-[11.5px] font-semibold cursor-pointer shadow-sm"
                      >
                        {copiedKey === `${activePending.id}:code` ? t("depositCopied") : t("depositCopy")}
                      </button>
                    </div>
                  )}
                </div>

                <p className="text-[11px] leading-relaxed text-bad/90 bg-bad-soft/50 border border-bad/20 rounded-lg p-2.5">
                  {t("depositExactTransferWarn")}
                </p>
              </div>
            )}

            {/* NOWPayments USDT QR Section */}
            {(activePending.provider || "sepay") === "nowpayments" && activePending.pay_address && (
              <div className="space-y-3">
                <div className="text-center text-[12px] font-semibold text-amber-600 dark:text-amber-300">
                  {t("depositNetworkBadge")}
                </div>
                {activePending.pay_amount != null && (
                  <div className="text-center font-mono text-[18px] font-bold tabular text-fg">
                    {t("depositPayAmount", { amount: String(activePending.pay_amount) })}
                  </div>
                )}
                <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl border border-line shadow-sm mx-auto">
                  <QRCodeSVG value={activePending.pay_address} size={160} level="M" includeMargin={false} />
                </div>
                <div className="rounded-lg border border-line bg-raised/40 p-3 flex items-center justify-between text-[12px]">
                  <div className="min-w-0 pr-2">
                    <div className="text-[10px] text-faint uppercase">{t("depositAddress")}</div>
                    <div className="font-mono text-[11.5px] break-all leading-snug text-fg mt-0.5">
                      {activePending.pay_address}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyValue(`${activePending.id}:address`, activePending.pay_address!)}
                    className="shrink-0 px-2.5 py-1 rounded bg-surface border border-line text-iris hover:underline text-[11px] cursor-pointer"
                  >
                    {copiedKey === `${activePending.id}:address` ? t("depositCopied") : t("depositCopyAddress")}
                  </button>
                </div>
                <p className="text-[11px] text-bad/90">{t("depositNetworkWarn")}</p>
              </div>
            )}

            {/* Realtime Waiting Indicator & Countdown */}
            <div className="flex items-start justify-between gap-3 bg-raised/40 border border-line rounded-lg px-3.5 py-2.5 text-[11.5px]">
              <div className="flex items-center gap-2 text-iris">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-iris opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-iris" />
                </span>
                <span className="leading-relaxed">
                  {t("depositWaitingConfirmation")}
                </span>
              </div>
              <span className="font-mono text-muted tabular">
                {timeLeftFine(activePending.expires_at, locale)
                  ? t("depositWaiting", { time: timeLeftFine(activePending.expires_at, locale) ?? "" })
                  : t("depositExpiring")}
              </span>
            </div>

            {/* Modal Bottom Actions */}
            <div className="space-y-2 pt-1 border-t border-line">
              {activePending.checkout_url && (
                <a href={activePending.checkout_url} target="_blank" rel="noopener noreferrer" className="block">
                  <Button variant="primary" size="md" block>{t("depositOpenPay")}</Button>
                </a>
              )}

              <Button
                variant="secondary"
                size="md"
                block
                onClick={() => setIsModalOpen(false)}
              >
                {t("depositModalClose")}
              </Button>

              <div className="flex items-center justify-between text-[11px] text-faint pt-1">
                <span>
                  {t("depositModalCloseHint")}
                </span>
                <button
                  type="button"
                  onClick={() => handleCancel(activePending.id)}
                  className="text-bad hover:underline cursor-pointer ml-2 shrink-0"
                >
                  {t("depositCancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {paidDeposit && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deposit-success-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm animate-in fade-in-0 duration-200"
        >
          <div className="w-full max-w-[390px] rounded-2xl border border-line bg-surface p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6">
            <div className="flex flex-col items-center text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-good-soft text-[28px] font-semibold text-good ring-8 ring-good-soft/40" aria-hidden>
                ✓
              </div>
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-good">
                {t("paymentReceived")}
              </p>
              <h3 id="deposit-success-title" className="mt-1 text-[20px] font-bold tracking-tight text-fg">
                {t("depositSuccessTitle")}
              </h3>
              <p className="mt-2 max-w-[280px] text-[12.5px] leading-relaxed text-muted">
                {t("depositSuccessHint")}
              </p>

              <div className="mt-5 w-full rounded-xl border border-good/25 bg-good-soft/45 px-4 py-3.5">
                <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted">
                  {t("amountCredited")}
                </div>
                <div className="mt-1 font-mono text-[24px] font-bold tabular text-good">
                  +{formatAmountLabel(paidDeposit.paid_amount ?? paidDeposit.amount)}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {paidDeposit.provider === "nowpayments" ? "NOWPayments · USDT" : t("sepayBankTransfer")}
                </div>
              </div>

              <Button
                variant="primary"
                size="md"
                block
                className="mt-5"
                onClick={() => setPaidDeposit(null)}
              >
                {t("continueWallet")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
