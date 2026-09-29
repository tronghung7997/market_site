"use client";

/** Promo code row of an order confirmation: a quiet "have a code?" link,
 *  then a code field, then the applied discount with a way to remove it. */

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { Button, Input, Tag } from "@/components/ui";
import { Tag as TagIcon, X } from "@/components/Icons";
import type { PromoCodeState } from "../usePromoCode";

export function PromoCodeField({ promo, disabled }: { promo: PromoCodeState; disabled?: boolean }) {
  const t = useTranslations("products.promo");
  const locale = useLocale();
  const { formatCheckoutMoney } = useMoney();
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const errorId = useId();

  if (promo.applied) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-muted">
          {t("discountLabel")}
          <Tag tone="good"><TagIcon size={11} />{promo.applied.promo_code}</Tag>
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono font-medium tabular text-good">
            −{formatCheckoutMoney(promo.applied.discount_amount, { locale })}
          </span>
          <button
            type="button"
            onClick={() => { promo.remove(); setOpen(true); }}
            disabled={disabled}
            aria-label={t("remove", { code: promo.applied.promo_code ?? "" })}
            className="-my-2 -mr-2 grid h-10 w-10 place-items-center rounded-md text-faint transition-colors hover:bg-raised hover:text-fg disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </span>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-iris-hi hover:underline disabled:opacity-50"
      >
        <TagIcon size={13} /> {t("haveCode")}
      </button>
    );
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => { e.preventDefault(); void promo.apply(); }}
    >
      <label htmlFor={inputId} className="text-[12.5px] font-medium text-muted">{t("label")}</label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={promo.input}
          onChange={(e) => promo.setInput(e.target.value)}
          placeholder={t("placeholder")}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          autoFocus
          disabled={disabled}
          aria-invalid={promo.error ? true : undefined}
          aria-describedby={promo.error ? errorId : undefined}
          className="font-mono uppercase placeholder:normal-case placeholder:font-sans"
        />
        <Button type="submit" variant="secondary" className="h-10 shrink-0" loading={promo.checking} disabled={disabled || !promo.input.trim()}>
          {t("apply")}
        </Button>
      </div>
      {promo.error && <p id={errorId} role="alert" className="text-[12px] text-bad">{promo.error}</p>}
    </form>
  );
}
