"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Input } from "@/components/ui";
import {
  effectiveMoneyInputCurrency,
  moneyInputToVnd,
  useMoney,
  vndToMoneyInput,
} from "@/lib/money";

/** Displays the active site currency while keeping the API value in integer VND. */
export function DisplayCurrencyInput({
  amountVnd,
  onAmountVndChange,
  disabled,
  invalid,
  groupDigits,
}: {
  amountVnd: number;
  onAmountVndChange: (amountVnd: number) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Show "72.000" instead of "72000" while the field is not being edited. */
  groupDigits?: boolean;
}) {
  const locale = useLocale();
  const [focused, setFocused] = useState(false);
  const money = useMoney();
  const currency = effectiveMoneyInputCurrency(money.currency, money.fxRate);
  const [draft, setDraft] = useState(() => vndToMoneyInput(amountVnd, currency, money.fxRate));
  const lastEmittedVnd = useRef<number | null>(null);

  useEffect(() => {
    if (lastEmittedVnd.current === amountVnd) {
      lastEmittedVnd.current = null;
      return;
    }
    setDraft(vndToMoneyInput(amountVnd, currency, money.fxRate));
  }, [amountVnd, currency, money.fxRate]);

  const update = (raw: string) => {
    const normalized = raw.replace(",", ".");
    const accepted = currency === "USD"
      ? /^\d*(?:\.\d{0,6})?$/.test(normalized)
      : /^\d*$/.test(normalized);
    if (!accepted) return;
    const nextVnd = moneyInputToVnd(normalized, currency, money.fxRate);
    setDraft(normalized);
    lastEmittedVnd.current = nextVnd;
    onAmountVndChange(nextVnd);
  };

  return (
    <div className="relative">
      <Input
        type="text"
        inputMode={currency === "USD" ? "decimal" : "numeric"}
        autoComplete="off"
        value={groupDigits && !focused && currency === "VND" && /^\d+$/.test(draft)
          ? new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US").format(Number(draft))
          : draft}
        onChange={(event) => update(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setDraft(vndToMoneyInput(amountVnd, currency, money.fxRate)); }}
        placeholder="0"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="pr-14 font-mono tabular-nums"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-faint"
      >
        {currency}
      </span>
    </div>
  );
}
