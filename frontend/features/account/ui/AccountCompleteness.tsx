"use client";

/** What is left to protect the account, each a jump to the right tab, and
 *  the one rule that stops most scams. */

import { useTranslations } from "next-intl";
import type { Account } from "@/lib/types";
import { cn } from "@/lib/cn";
import { CheckCircle2, ShieldCheck } from "@/components/Icons";
import { accountCompleteness } from "../model";

export function AccountCompleteness({ account, onOpen }: {
  account: Account;
  onOpen: (tab: "profile" | "security") => void;
}) {
  const t = useTranslations("account.completeness");
  const { items, percent } = accountCompleteness(account);
  const missing = items.filter((item) => !item.done);

  return (
    <section aria-labelledby="account-completeness" className="mb-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
      {missing.length > 0 && (
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="account-completeness" className="text-[13.5px] font-semibold text-fg">{t("title")}</h2>
            <span className="font-mono text-[12.5px] tabular text-muted">{percent}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
            <div className="h-full rounded-full bg-iris" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-[12px] text-muted">{t("hint")}</p>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.key}>
                {item.done ? (
                  <span className="flex items-center gap-2 text-[12.5px] text-muted">
                    <CheckCircle2 size={14} className="text-good" /> {t(`items.${item.key}`)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpen(item.tab)}
                    className="flex w-full items-center gap-2 rounded-lg text-left text-[12.5px] font-medium text-fg hover:text-iris-hi"
                  >
                    <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-line-2" />
                    {t(`items.${item.key}`)}
                    <span className="ml-auto text-[11.5px] text-iris-hi">{t(`actions.${item.key}`)}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={cn("rounded-card border border-good/20 bg-good-soft/60 p-4", missing.length === 0 && "lg:col-span-2")}>
        <p className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <ShieldCheck size={15} className="text-good" /> {t("safetyTitle")}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg/80">{t("safetyBody")}</p>
      </div>
    </section>
  );
}
