"use client";

import { useTranslations } from "next-intl";
import type { ProductLocale } from "@/lib/types";
import { Field, Input, Select, Tag } from "@/components/ui";
import { useLocale } from "next-intl";
import { CoverChooser } from "@/features/product-covers";
import { ImageUploader } from "@/components/media/ImageUploader";
import type { ProductFormCore } from "../useProductFormCore";
import { PRODUCT_GALLERY_MAX, protectionOptions } from "../model";
import { ContactWarning } from "./ContactWarning";
import { useHoldLabel } from "@/lib/hold";

/** Section 1 — name, category (parent › child), cover, highlight and the
 *  buyer-protection window. Everything else is a later section. */
export function BasicsFields({ core, categoriesDisabled }: { core: ProductFormCore; categoriesDisabled?: boolean }) {
  const t = useTranslations("sellerProductForm.basics");
  const holdLabel = useHoldLabel();
  const locale = useLocale() === "en" ? "en" : "vi";
  const localeTag = core.contentLocale !== core.primaryLocale ? <LocaleTag locale={core.contentLocale} /> : null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("name")} hint={t("nameHint")}>
        <div className="relative">
          <Input id="product-title" value={core.activeContent.title} onChange={(e) => core.updateContent("title", e.target.value)} placeholder={t("namePlaceholder")} maxLength={255} />
          {localeTag && <span className="absolute right-2 top-1/2 -translate-y-1/2">{localeTag}</span>}
        </div>
        <ContactWarning text={core.activeContent.title} />
      </Field>
      <Field label={t("category")} hint={t("categoryHint")}>
        <Select id="product-category" value={core.categoryId} onChange={(e) => core.setCategoryId(Number(e.target.value))} disabled={categoriesDisabled || core.catOptions.length === 0}>
          {core.categoryId === 0 && <option value={0}>{t("categoryPlaceholder")}</option>}
          {core.catOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <ImageUploader
          purpose="product_image"
          value={core.gallery}
          onChange={core.setGallery}
          max={PRODUCT_GALLERY_MAX}
          markCover
          label={t("gallery")}
          hint={t("galleryHint")}
        />
      </div>
      <div className="sm:col-span-2">
        <CoverChooser
          coverId={core.coverId}
          source={core.coverSource}
          photo={core.gallery[0]}
          locale={locale}
          onChange={({ source, coverId }) => { core.setCoverSource(source); if (coverId) core.setCoverId(coverId); }}
        />
      </div>
      <Field label={t("highlight")} hint={t("highlightHint")}>
        <Input value={core.activeContent.highlightText} onChange={(e) => core.updateContent("highlightText", e.target.value)} placeholder={t("highlightPlaceholder")} maxLength={160} />
        <ContactWarning text={core.activeContent.highlightText} />
      </Field>
      <Field label={t("protection")} hint={t("protectionHint")}>
        <Select id="product-protection" value={core.escrowHours} onChange={(e) => core.setEscrowHours(Number(e.target.value))}>
          {protectionOptions(core.escrowHours, core.escrowFloorHours).map((hours) => <option key={hours} value={hours}>{t("protectionDays", { hold: holdLabel(hours) })}</option>)}
        </Select>
      </Field>
    </div>
  );
}

export function LocaleTag({ locale }: { locale: ProductLocale }) {
  const t = useTranslations("sellerProductForm.languages");
  return <Tag tone="iris">{t("editing", { language: t(`name.${locale}`) })}</Tag>;
}
