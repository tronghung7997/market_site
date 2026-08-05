"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { timeLeftFine } from "@/lib/time";
import type { DepositIntent } from "@/lib/types";
import { Button, Card, Tag } from "@/components/ui";
import { MoneyInput } from "@/components/MoneyInput";

const PRESET_AMOUNTS = [100000, 500000, 1000000, 5000000];
const MIN_DEPOSIT = 10000;

export default function DepositCard({ deposits, onChanged }: {
  deposits: DepositIntent[];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("wallet");
  const td = useTranslations("status.deposit");
  const locale = useLocale();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const handleCreate = async () => {
    const value = parseInt(amount) || 0;
    if (value < MIN_DEPOSIT) {
      setErr(t("depositMinError", { amount: vnd(MIN_DEPOSIT, locale) }));
      return;
    }
    setLoading(true);
    setMsg("");
    setErr("");
    const payTab = window.open("about:blank", "_blank");
    try {
      const intent = await api.createDeposit(value);
      setAmount("");
      setMsg(t("depositCreated"));
      if (intent.checkout_url && payTab) payTab.location.href = intent.checkout_url;
      await onChanged();
    } catch (e) {
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

  const pending = deposits.filter((d) => d.status === "pending");
  const recent = deposits.filter((d) => d.status !== "pending").slice(0, 3);

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 border-b border-line bg-raised/30 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{t("depositTitle")}</h3>
        <Tag tone="iris">{t("depositQr")}</Tag>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-faint font-medium">{t("depositAmount")}</span>
            <span className="text-[11px] text-faint">{t("depositMin", { amount: vnd(MIN_DEPOSIT, locale) })}</span>
          </div>
          <MoneyInput
            value={amount}
            onValueChange={(v) => { setAmount(v); setErr(""); }}
            placeholder={t("depositPlaceholder")}
            disabled={loading}
          />
          <div className="flex gap-1.5 mt-2">
            {PRESET_AMOUNTS.map((preset) => (
              <button
                key={preset}
                onClick={() => setAmount(String(preset))}
                disabled={loading}
                className={cn(
                  "flex-1 h-7 rounded-md border text-[11.5px] font-mono tabular transition-colors cursor-pointer",
                  amount === String(preset)
                    ? "border-iris bg-iris-soft text-iris font-semibold"
                    : "border-line bg-surface text-muted hover:border-iris/40 hover:text-fg",
                )}
              >
                {preset >= 1_000_000
                  ? t("depositMillion", { n: preset / 1_000_000 })
                  : `${preset / 1000}K`}
              </button>
            ))}
          </div>
        </div>

        <Button
          variant="primary"
          size="md"
          block
          onClick={handleCreate}
          disabled={loading || !amount || Number(amount) < MIN_DEPOSIT}
        >
          {loading
            ? t("depositCreating")
            : amount
              ? t("depositCreateAmount", { amount: vnd(Number(amount), locale) })
              : t("depositCreate")}
        </Button>
        <p className="text-[11.5px] text-faint leading-relaxed">{t("depositHint")}</p>

        {msg && (
          <div className="p-2.5 rounded-lg bg-good-soft text-good text-[12px]">✓ {msg}</div>
        )}
        {err && (
          <div className="p-2.5 rounded-lg bg-bad-soft text-bad text-[12px]">{err}</div>
        )}

        {pending.map((d) => {
          const remaining = timeLeftFine(d.expires_at, locale);
          return (
            <div key={d.id} className="rounded-lg border border-iris/30 bg-iris-soft/40 overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-[17px] font-semibold tabular leading-tight">{vnd(d.amount, locale)}</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {remaining ? t("depositWaiting", { time: remaining }) : t("depositExpiring")}
                  </div>
                </div>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-iris opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-iris" />
                </span>
              </div>
              <div className="px-4 pb-3 flex items-center gap-2">
                {d.checkout_url && (
                  <a href={d.checkout_url} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <Button variant="secondary" size="sm" block>{t("depositOpenPay")}</Button>
                  </a>
                )}
                <button
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
                <span className="font-mono tabular">{vnd(d.paid_amount ?? d.amount, locale)}</span>
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
