"use client";

/** Promo code state for one order confirmation: what the buyer typed, the
 *  quote it produced and the code to send with the order. A quote belongs to
 *  the body it priced (`promoQuoteKey`), so a different package, option or
 *  quantity drops it without an effect. */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import type { OrderQuote, OrderRequestBody } from "@/lib/types";
import { normalizePromoCode, payableTotal, promoQuoteKey } from "./model";

export interface PromoCodeState {
  input: string;
  setInput: (value: string) => void;
  /** The quote while it applies to the current body. */
  applied: OrderQuote | null;
  checking: boolean;
  error: string | null;
  apply: () => Promise<void>;
  remove: () => void;
  /** Clears everything (the confirmation closed). */
  reset: () => void;
  /** Code to send with the order, or null. */
  code: string | null;
  /** What the buyer pays for a list `total`. */
  payable: (total: number) => number;
}

export function usePromoCode(body: OrderRequestBody | null): PromoCodeState {
  const t = useTranslations("products.promo");
  const apiErrorMessage = useApiErrorMessage();
  const { formatCheckoutMoney } = useMoney();
  const locale = useLocale();
  const [input, setInputRaw] = useState("");
  const [quote, setQuote] = useState<(OrderQuote & { key: string }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The confirmation closed (no body): forget the code, so reopening starts
  // clean however it was closed (button, backdrop, Escape).
  const [active, setActive] = useState(body != null);
  if ((body != null) !== active) {
    setActive(body != null);
    if (body == null) { setInputRaw(""); setQuote(null); setError(null); }
  }

  const key = promoQuoteKey(body as Record<string, unknown> | null);
  const applied = quote && key && quote.key === key ? quote : null;

  const apply = async () => {
    const code = normalizePromoCode(input);
    if (!body || !key) return;
    if (!code) { setError(t("empty")); return; }
    setChecking(true); setError(null);
    try {
      const result = await api.quoteOrder({ ...body, promo_code: code });
      setQuote({ ...result, key });
      setInputRaw(code);
    } catch (e) {
      setQuote(null);
      if (e instanceof ApiError && e.errorCode === "PROMO_MIN_ORDER" && typeof e.params?.min === "number") {
        setError(t("minOrder", { amount: formatCheckoutMoney(e.params.min, { locale }) }));
      } else {
        setError(apiErrorMessage(e, t("checkFailed")));
      }
    } finally {
      setChecking(false);
    }
  };

  // The body changed under an applied code (the price moved and the product
  // reloaded, another package, another quantity): price the same code again
  // instead of dropping it silently and charging the list price.
  const stale = quote != null && key != null && quote.key !== key;
  useEffect(() => {
    if (stale && !checking) void apply();
    // Re-quote once per new body; `apply` reads the current input and body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, key]);

  const reset = () => { setInputRaw(""); setQuote(null); setError(null); };

  return {
    input,
    setInput: (value) => { setInputRaw(value); setError(null); },
    applied,
    checking: checking || stale,
    error,
    apply,
    remove: reset,
    reset,
    code: applied?.promo_code ?? null,
    payable: (total) => payableTotal(total, quote, key),
  };
}
