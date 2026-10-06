"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useMoney } from "@/lib/money";
import { txNote, txOrderHref } from "@/lib/tx-kind";
import { txLabelKey, txState } from "@/features/wallet-ledger/model";
import { cn } from "@/lib/cn";
import type { Transaction } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";

export default function TransactionList({ txs, showHeader = true }: { txs: Transaction[]; showHeader?: boolean }) {
  const t = useTranslations("wallet");
  const tl = useTranslations("transactions");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const signed = (sign: string, amount: number) => `${amount > 0 ? sign : ""}${formatBrowseMoney(amount, { locale })}`;
  const loc = locale === "vi" ? "vi-VN" : "en-US";

  return (
    <div className="min-w-0">
      {showHeader && <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold">{t("txTitle")}</h3>
        <span className="text-[12px] text-muted">{t("txCount", { count: txs.length })}</span>
      </div>}

      {txs.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Card className="p-3.5">
            <div className="text-[11px] text-faint">{t("txInShown", { count: txs.length })}</div>
            <div className="font-mono text-[16px] font-semibold text-good tabular mt-0.5">
              {signed("+", txs.filter((x) => x.direction === "in").reduce((s, x) => s + x.amount, 0))}
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11px] text-faint">{t("txOutShown", { count: txs.length })}</div>
            <div className="font-mono text-[16px] font-semibold text-bad tabular mt-0.5">
              {signed("−", txs.filter((x) => x.direction === "out").reduce((s, x) => s + x.amount, 0))}
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
              // Same names and states as /transactions.
              const label = tl(`label.${txLabelKey(tx)}`);
              const note = txNote(tx.description);
              const description = note ? `${label} · ${note}` : label;
              const status = { label: tl(`state.${txState(tx).key}`), tone: txState(tx).tone };
              const orderHref = txOrderHref(tx);
              return (
                <div
                  key={tx.id}
                  className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3.5 sm:flex sm:gap-4 sm:px-5"
                >
                  <div className={cn(
                    "row-span-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[13px] font-bold",
                    tx.direction === "in" ? "bg-good-soft text-good"
                      : tx.direction === "out" ? "bg-bad-soft text-bad"
                      : "bg-raised text-faint",
                  )}>
                    {sign}
                  </div>
                  <div className="min-w-0 sm:flex-1">
                    <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                      <Tooltip text={description}>
                        <span className="min-w-0 text-[13px] font-medium truncate cursor-default">
                          {description}
                        </span>
                      </Tooltip>
                      <Tag tone={status.tone} className="shrink-0">{status.label}</Tag>
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint sm:gap-3 sm:text-[11.5px]">
                      <span>{date.toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                      <span>{date.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}</span>
                      {tx.reference_label && (orderHref ? (
                        <Link href={orderHref} className="basis-full min-w-0 truncate font-mono text-iris-hi hover:underline sm:basis-auto">
                          {tx.reference_label}
                        </Link>
                      ) : (
                        <span className="basis-full min-w-0 truncate font-mono sm:basis-auto">
                          {tx.reference_label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className={cn(
                    "shrink-0 self-start pt-0.5 text-right font-mono text-[14px] font-semibold tabular sm:w-[112px]",
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
