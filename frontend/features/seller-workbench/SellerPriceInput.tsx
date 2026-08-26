"use client";

import { DisplayCurrencyInput } from "@/components/DisplayCurrencyInput";
import {
  effectiveMoneyInputCurrency,
  useMoney,
  type DisplayCurrency,
} from "@/lib/money";

export function useSellerPriceCurrency(): {
  currency: DisplayCurrency;
  fxRate: number | null;
} {
  const { currency, fxRate } = useMoney();
  return {
    currency: effectiveMoneyInputCurrency(currency, fxRate),
    fxRate,
  };
}

/** Product-facing alias that keeps product API prices in integer VND. */
export function SellerPriceInput({
  amountVnd,
  onAmountVndChange,
}: {
  amountVnd: number;
  onAmountVndChange: (amountVnd: number) => void;
}) {
  return (
    <DisplayCurrencyInput
      amountVnd={amountVnd}
      onAmountVndChange={onAmountVndChange}
    />
  );
}
