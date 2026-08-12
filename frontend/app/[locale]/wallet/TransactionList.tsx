"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { Transaction } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";

type Tone = "good" | "bad" | "warn" | "iris" | "neutral";
const TONE: Record<string, Tone> = {
  topup: "good", deposit: "good", purchase_release: "good", refund: "good",
  affiliate_commission: "good", withdraw_unlock: "good",
  purchase_hold: "bad", withdraw: "bad", withdraw_lock: "warn",
  platform_fee: "neutral", adjustment_credit: "neutral", adjustment_debit: "neutral",
};

const HOLD_TONE: Record<string, Tone> = {
  pending: "warn", processing: "warn", delivered: "warn", completed: "good",
  disputed: "warn", refunded: "neutral", cancelled: "neutral",
};

export default function TransactionList({ txs }: { txs: Transaction[] }) {
  const t = useTranslations("wallet");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const loc = locale === "vi" ? "vi-VN" : "en-US";

  function describeTransaction(tx: Transaction): { label: string; tone: Tone } {
    if (tx.type === "purchase_hold" && tx.order_status) {
      const key = `txHold.${tx.order_status}` as const;
      if (t.has(key)) {
        return { label: t(key), tone: HOLD_TONE[tx.order_status] ?? "warn" };
      }
    }
    const typeKey = `txTypes.${tx.type}` as const;
    return {
      label: t.has(typeKey) ? t(typeKey) : tx.type,
      tone: TONE[tx.type] ?? "neutral",
    };
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold">{t("txTitle")}</h3>
        <span className="text-[12px] text-muted">{t("txCount", { count: txs.length })}</span>
      </div>

      {txs.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Card className="p-3.5">
            <div className="text-[11px] text-faint">{t("txIn")}</div>
            <div className="font-mono text-[16px] font-semibold text-good tabular mt-0.5">
              +{formatBrowseMoney(txs.filter((x) => x.direction === "in").reduce((s, x) => s + x.amount, 0), { locale })}
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11px] text-faint">{t("txOut")}</div>
            <div className="font-mono text-[16px] font-semibold text-bad tabular mt-0.5">
              −{formatBrowseMoney(txs.filter((x) => x.direction === "out").reduce((s, x) => s + x.amount, 0), { locale })}
            </div>
          </Card>
        </div>
      )}
      <Card className="overflow-hidden">
        {txs.length === 0 ? (
          <p className="p-6 text-[13px] text-muted">{t("txEmpty")}</p>
        ) : (
          <div className="divide-y divide-line">
            {txs.map((tx) => {
              const sign = tx.direction === "in" ? "+" : tx.direction === "out" ? "−" : "•";
              const date = new Date(tx.created_at);
              const typeKey = `txTypes.${tx.type}` as const;
              const description = tx.description ?? (t.has(typeKey) ? t(typeKey) : tx.type);
              const status = describeTransaction(tx);
              return (
                <div key={tx.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className={cn(
                    "grid place-items-center h-9 w-9 shrink-0 rounded-lg text-[13px] font-bold",
                    tx.direction === "in" ? "bg-good-soft text-good"
                      : tx.direction === "out" ? "bg-bad-soft text-bad"
                      : "bg-raised text-faint",
                  )}>
                    {sign}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Tooltip text={description}>
                        <span className="min-w-0 text-[13px] font-medium truncate cursor-default">
                          {description}
                        </span>
                      </Tooltip>
                      <Tag tone={status.tone} className="shrink-0">{status.label}</Tag>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11.5px] text-faint">
                      <span>{date.toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                      <span>{date.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      {tx.reference_id && <span className="font-mono">Ref: {tx.reference_id}</span>}
                    </div>
                  </div>
                  <span className={cn(
                    "font-mono text-[14px] font-semibold tabular shrink-0 w-[112px] text-right",
                    tx.direction === "in" ? "text-good" : tx.direction === "out" ? "text-bad" : "text-faint",
                  )}>
                    {tx.direction === "neutral" ? "" : sign}{formatBrowseMoney(tx.amount, { locale })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
