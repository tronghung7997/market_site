"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
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

type MethodsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; methods: DepositMethods };

export default function DepositCard({ deposits, onChanged }: {
  deposits: DepositIntent[];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("wallet");
  const td = useTranslations("status.deposit");
  const locale = useLocale();
  const { currency, formatBrowseMoney, formatLedgerMoney, fxRate } = useMoney();

  const [methodsState, setMethodsState] = useState<MethodsState>({ status: "loading" });
  const [method, setMethod] = useState<DepositMethod>("payos");
  const [userPickedMethod, setUserPickedMethod] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);

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
  const payosOn = Boolean(methods?.payos_enabled);
  const nowOn = Boolean(methods?.nowpayments_enabled);
  const anyRail = payosOn || nowOn;
  const showRailSwitch = payosOn && nowOn;

  // Default rail from display currency; keep user override when both available.
  useEffect(() => {
    if (!methods) return;
    if (userPickedMethod && showRailSwitch) return;

    if (currency === "USD" && methods.nowpayments_enabled) {
      setMethod("nowpayments");
    } else if (methods.payos_enabled) {
      setMethod("payos");
    } else if (methods.nowpayments_enabled) {
      setMethod("nowpayments");
    }
  }, [currency, methods, userPickedMethod, showRailSwitch]);

  const isUsdt = method === "nowpayments";
  const minVnd = isUsdt
    ? (methods?.deposit_usdt_min_vnd ?? 50_000)
    : (methods?.deposit_min_amount ?? 10_000);

  const amountVnd = useMemo(() => {
    if (currency === "USD" && fxRate && fxRate > 0) {
      const usd = parseFloat(amount) || 0;
      if (usd <= 0) return 0;
      return Math.round(usd * fxRate);
    }
    return parseInt(amount, 10) || 0;
  }, [amount, currency, fxRate]);

  const canCreate = anyRail && amountVnd >= minVnd && !loading && methodsState.status === "ready";

  const handleCreate = async () => {
    if (methodsState.status !== "ready" || !anyRail) return;
    if (amountVnd < minVnd) {
      setErr(t("depositMinError", {
        amount: currency === "USD" && fxRate
          ? formatBrowseMoney(minVnd, { locale })
          : formatLedgerMoney(minVnd, locale),
      }));
      return;
    }
    if (isUsdt && !nowOn) {
      setErr(t("depositUsdtUnavailable"));
      return;
    }
    if (!isUsdt && !payosOn) {
      setErr(t("depositBankUnavailable"));
      return;
    }

    setLoading(true);
    setMsg("");
    setErr("");
    // Open synchronously so browser popup protection does not interrupt the
    // provider checkout. The wallet stays open to show the pending deposit.
    const payTab = window.open("about:blank", "_blank");
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
      setErr(e instanceof Error ? e.message : t("depositCreateFail"));
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

  const copyAddress = async (id: number, address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const pending = deposits.filter((d) => d.status === "pending");
  const recent = deposits.filter((d) => d.status !== "pending").slice(0, 3);

  const formatMin = () =>
    currency === "USD" && fxRate
      ? formatBrowseMoney(minVnd, { locale })
      : formatLedgerMoney(minVnd, locale);

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
                    setMethod("payos");
                    setUserPickedMethod(true);
                    setErr("");
                  }}
                  className={cn(
                    "flex-1 h-8 rounded-md text-[12px] font-medium transition-colors cursor-pointer",
                    method === "payos"
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
              {amountVnd >= minVnd && (
                <div className="flex items-baseline justify-between gap-3 text-[12.5px] pt-1.5 border-t border-line/70">
                  <span className="text-muted">{t("depositYouWillTransfer")}</span>
                  <span className="font-mono font-semibold tabular text-fg">
                    {formatAmountLabel(amountVnd)}
                  </span>
                </div>
              )}
              {currency === "USD" && (
                <p className="text-[11px] text-faint pt-1">{t("depositLedgerNote", { currency: "USD" })}</p>
              )}
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[11px] uppercase tracking-wider text-faint font-medium">{t("depositAmount")}</span>
                <span className="text-[11px] text-faint">{t("depositMin", { amount: formatMin() })}</span>
              </div>
              {currency === "USD" && fxRate ? (
                <div className="relative">
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d.]/g, "");
                      setAmount(v);
                      setErr("");
                    }}
                    placeholder="e.g. 20"
                    disabled={loading}
                    className={cn(
                      "h-10 w-full rounded-lg bg-surface border border-line pl-3 pr-9 text-sm text-fg",
                      "font-mono tabular-nums text-right",
                      "placeholder:text-faint placeholder:font-sans placeholder:text-left",
                      "transition-colors focus:border-iris focus:bg-panel",
                      "disabled:opacity-60 disabled:cursor-not-allowed",
                    )}
                  />
                  <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-faint font-medium select-none">
                    $
                  </span>
                  {amountVnd > 0 && (
                    <p className="mt-1 text-[11px] text-muted tabular-nums">
                      ≈ {formatLedgerMoney(amountVnd, locale)}
                    </p>
                  )}
                </div>
              ) : (
                <MoneyInput
                  value={amount}
                  onValueChange={(v) => { setAmount(v); setErr(""); }}
                  placeholder={t("depositPlaceholder")}
                  disabled={loading}
                />
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
                : amountVnd >= minVnd
                  ? t("depositCreateAmount", { amount: formatAmountLabel(amountVnd) })
                  : t("depositCreate")}
            </Button>
            <p className="text-[11.5px] text-faint leading-relaxed">
              {isUsdt ? t("depositHintUsdt") : t("depositHint")}
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
          const isNow = (d.provider || "payos") === "nowpayments";
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
                        onClick={() => copyAddress(d.id, d.pay_address!)}
                        className="text-[12px] text-iris hover:underline cursor-pointer"
                      >
                        {copiedId === d.id ? t("depositCopied") : t("depositCopyAddress")}
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
                    {(d.provider || "payos") === "nowpayments" ? "USDT" : "PayOS"}
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
