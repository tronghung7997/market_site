"use client";

import { useTranslations } from "next-intl";
import type { ProductLocale } from "@/lib/types";
import { Field, Input, Select, Tag } from "@/components/ui";
import { SellerCoverPicker } from "@/features/seller-workbench/SellerCoverPicker";
import type { ProductFormCore } from "../useProductFormCore";
import { protectionOptions } from "../model";

/** Section 1 — name, category (parent › child), cover, highlight and the
 *  buyer-protection window. Everything else is a later section. */
export function BasicsFields({ core, categoriesDisabled }: { core: ProductFormCore; categoriesDisabled?: boolean }) {
  const t = useTranslations("sellerProductForm.basics");
  const localeTag = core.contentLocale !== core.primaryLocale ? <LocaleTag locale={core.contentLocale} /> : null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("name")} hint={t("nameHint")}>
        <div className="relative">
          <Input id="product-title" value={core.activeContent.title} onChange={(e) => core.updateContent("title", e.target.value)} placeholder={t("namePlaceholder")} maxLength={255} />
          {localeTag && <span className="absolute right-2 top-1/2 -translate-y-1/2">{localeTag}</span>}
        </div>
      </Field>
      <Field label={t("category")} hint={t("categoryHint")}>
        <Select id="product-category" value={core.categoryId} onChange={(e) => core.setCategoryId(Number(e.target.value))} disabled={categoriesDisabled || core.catOptions.length === 0}>
          {core.categoryId === 0 && <option value={0}>{t("categoryPlaceholder")}</option>}
          {core.catOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <SellerCoverPicker selectedCoverId={core.coverId} onChange={core.setCoverId} />
      </div>
      <Field label={t("highlight")} hint={t("highlightHint")}>
        <Input value={core.activeContent.highlightText} onChange={(e) => core.updateContent("highlightText", e.target.value)} placeholder={t("highlightPlaceholder")} maxLength={160} />
      </Field>
      <Field label={t("protection")} hint={t("protectionHint")}>
        <Select id="product-protection" value={core.escrowDays} onChange={(e) => core.setEscrowDays(Number(e.target.value))}>
          {protectionOptions(core.escrowDays).map((days) => <option key={days} value={days}>{t("protectionDays", { days })}</option>)}
        </Select>
      </Field>
    </div>
  );
}

export function LocaleTag({ locale }: { locale: ProductLocale }) {
  const t = useTranslations("sellerProductForm.languages");
  return <Tag tone="iris">{t("editing", { language: t(`name.${locale}`) })}</Tag>;
}
