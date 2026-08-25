"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui";
import { useMoney } from "@/lib/money";
import {
  effectivePriceInputCurrency,
  priceInputToVnd,
  vndToPriceInput,
  type PriceInputCurrency,
} from "./logic";

export function useSellerPriceCurrency(): {
  currency: PriceInputCurrency;
  fxRate: number | null;
} {
  const { currency, fxRate } = useMoney();
  return {
    currency: effectivePriceInputCurrency(currency, fxRate),
    fxRate,
  };
}

/**
 * Accepts the site's effective display currency but reports integer VND so the
 * product/pricing API and ledger contract remain unchanged.
 */
export function SellerPriceInput({
  amountVnd,
  onAmountVndChange,
}: {
  amountVnd: number;
  onAmountVndChange: (amountVnd: number) => void;
}) {
  const { currency, fxRate } = useSellerPriceCurrency();
  const [draft, setDraft] = useState(() => vndToPriceInput(amountVnd, currency, fxRate));

  // Re-denominate the visible value when the site's currency or FX rate changes.
  // amountVnd remains the source of truth and is never converted twice.
  useEffect(() => {
    setDraft(vndToPriceInput(amountVnd, currency, fxRate));
  }, [currency, fxRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (raw: string) => {
    const normalized = raw.replace(",", ".");
    const accepted = currency === "USD"
      ? /^\d*(?:\.\d{0,6})?$/.test(normalized)
      : /^\d*$/.test(normalized);
    if (!accepted) return;
    setDraft(normalized);
    onAmountVndChange(priceInputToVnd(normalized, currency, fxRate));
  };

  return (
    <div className="relative">
      <Input
        type="text"
        inputMode={currency === "USD" ? "decimal" : "numeric"}
        autoComplete="off"
        value={draft}
        onChange={(event) => update(event.target.value)}
        onBlur={() => setDraft(vndToPriceInput(amountVnd, currency, fxRate))}
        placeholder="0"
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
