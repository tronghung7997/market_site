"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
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

  const handleCreate = async () => {
    if (methodsState.status !== "ready" || !anyRail) return;
    if (!meetsMin) {
      setErr(t("depositMinError", { amount: formatMinLabel }));
      return;
    }
    if (!meetsMax) {
      // Prefer display-currency max — never surface ledger-VND API copy in USD mode.
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
    // Open synchronously so browser popup protection does not interrupt the
    // provider checkout. The wallet stays open to show the pending deposit.
    const payTab = isUsdt ? window.open("about:blank", "_blank") : null;
    try {
      const intent = await api.createDeposit(amountVnd, {
        method,
      });
      setAmount("");
      setMsg(isUsdt ? t("depositCreatedUsdt") : t("depositCreated"));
      if (intent.checkout_url && payTab) {
        payTab.location.href = intent.checkout_url;
      } else if (payTab) {
        payTab.close();
      }
      await onChanged();
    } catch (e) {
      if (payTab) payTab.close();
      // Backend still speaks ledger VND; remap known max/min failures to the
      // same display-currency copy the client uses for local validation.
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
      await onChanged();
    } catch (e) {
      setErr(t("depositCancelFail", { error: e instanceof Error ? e.message : "—" }));
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

  const pending = deposits.filter((d) => d.status === "pending");
  const recent = deposits.filter((d) => d.status !== "pending").slice(0, 3);

  const formatAmountLabel = (vnd: number) =>
    currency === "USD" && fxRate
      ? formatBrowseMoney(vnd, { locale })
      : formatLedgerMoney(vnd, locale);

  const presets = currency === "USD" && fxRate ? PRESET_USD : PRESET_VND;

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 border-b border-line bg-raised/30 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{t("depositTitle")}</h3>
        {methodsState.status === "ready" && anyRail && (
          <Tag tone={isUsdt ? "good" : "iris"}>
            {isUsdt ? t("depositRailTagUsdt") : t("depositRailTag")}
          </Tag>
        )}
      </div>
      <div className="p-5 space-y-4">
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

            <div className="rounded-lg border border-line bg-raised/40 px-3.5 py-3 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="text-muted">{t("depositPaymentMethod")}</span>
                <span className="font-medium text-right">
                  {isUsdt ? t("depositPaymentMethodUsdt") : t("depositPaymentMethodValue")}
                </span>
              </div>
              {amountInRange && (
                <div className="flex items-baseline justify-between gap-3 text-[12.5px] pt-1.5 border-t border-line/70">
                  <span className="text-muted">{t("depositYouWillTransfer")}</span>
                  <span className="font-mono font-semibold tabular text-fg">
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
                      // USD cents only — strips extra fraction digits so min $0.39 is unambiguous.
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

        {pending.map((d) => {
          const remaining = timeLeftFine(d.expires_at, locale);
          const isNow = (d.provider || "sepay") === "nowpayments";
          return (
            <div key={d.id} className="rounded-lg border border-iris/30 bg-iris-soft/40 overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-[17px] font-semibold tabular leading-tight">
                    {formatAmountLabel(d.amount)}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {remaining ? t("depositWaiting", { time: remaining }) : t("depositExpiring")}
                  </div>
                  <div className="text-[11px] text-faint mt-0.5">
                    {isNow ? t("depositPaymentMethodUsdt") : t("depositPaymentMethodValue")}
                  </div>
                </div>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-iris opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-iris" />
                </span>
              </div>

              {!isNow && d.qr_code && d.payment_code && d.bank_account_number && (
                <div className="px-4 pb-3 space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="mx-auto shrink-0 rounded-lg border border-line bg-white p-2 sm:mx-0">
                      <Image
                        loader={qrImageLoader}
                        unoptimized
                        src={d.qr_code}
                        width={184}
                        height={184}
                        alt={t("depositQrAlt")}
                        className="h-[184px] w-[184px] object-contain"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2 text-[12px]">
                      <div>
                        <div className="text-faint">{t("depositBankAccount")}</div>
                        <div className="font-mono font-semibold break-all">
                          {d.bank_account_number}
                        </div>
                        <div className="text-muted">
                          {[d.bank_code, d.bank_account_name].filter(Boolean).join(" · ")}
                        </div>
                        <button
                          type="button"
                          onClick={() => copyValue(`${d.id}:account`, d.bank_account_number!)}
                          className="mt-0.5 text-iris hover:underline cursor-pointer"
                        >
                          {copiedKey === `${d.id}:account` ? t("depositCopied") : t("depositCopy")}
                        </button>
                      </div>
                      <div className="border-t border-line/70 pt-2">
                        <div className="text-faint">{t("depositTransferContent")}</div>
                        <div className="font-mono text-[14px] font-semibold text-iris break-all">
                          {d.payment_code}
                        </div>
                        <button
                          type="button"
                          onClick={() => copyValue(`${d.id}:code`, d.payment_code!)}
                          className="mt-0.5 text-iris hover:underline cursor-pointer"
                        >
                          {copiedKey === `${d.id}:code` ? t("depositCopied") : t("depositCopy")}
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-bad/90">
                    {t("depositExactTransferWarn")}
                  </p>
                </div>
              )}

              {isNow && d.pay_address && (
                <div className="px-4 pb-3 space-y-2">
                  <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                    {t("depositNetworkBadge")}
                  </div>
                  {d.pay_amount != null && (
                    <div className="text-[13px] font-mono font-semibold tabular">
                      {t("depositPayAmount", { amount: String(d.pay_amount) })}
                    </div>
                  )}
                  <p className="text-[11px] text-muted">{t("depositPayAmountHint")}</p>
                  <div className="flex gap-3 items-start">
                    <div className="rounded-md border border-line bg-white p-1.5 shrink-0">
                      <QRCodeSVG value={d.pay_address} size={96} level="M" includeMargin={false} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="text-[11px] text-faint">{t("depositAddress")}</div>
                      <div className="font-mono text-[11px] break-all leading-snug">{d.pay_address}</div>
                      <button
                        type="button"
                        onClick={() => copyValue(`${d.id}:address`, d.pay_address!)}
                        className="text-[12px] text-iris hover:underline cursor-pointer"
                      >
                        {copiedKey === `${d.id}:address` ? t("depositCopied") : t("depositCopyAddress")}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-bad/90">{t("depositNetworkWarn")}</p>
                </div>
              )}

              <div className="px-4 pb-3 flex items-center gap-2">
                {d.checkout_url && (!isNow || d.now_invoice_id) && (
                  <a href={d.checkout_url} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <Button variant="secondary" size="sm" block>{t("depositOpenPay")}</Button>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => handleCancel(d.id)}
                  className="text-[12px] text-faint hover:text-bad transition-colors cursor-pointer px-2 h-8"
                >
                  {t("depositCancel")}
                </button>
              </div>
            </div>
          );
        })}

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
  );
}
