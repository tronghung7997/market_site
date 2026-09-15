"use client";

import { useTranslations } from "next-intl";
import { Field, Textarea } from "@/components/ui";
import type { ProductFormCore } from "../useProductFormCore";
import { DescriptionField } from "./DescriptionField";
import { LocaleTag } from "./BasicsFields";

/** Section 3 — the long description plus the optional feature / spec /
 *  warranty blocks that the storefront renders under it. */
export function ContentFields({ core }: { core: ProductFormCore }) {
  const t = useTranslations("sellerProductForm.content");
  const c = core.activeContent;
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label htmlFor="product-description" className="text-[12.5px] font-medium text-fg">{t("description")}</label>
          {core.contentLocale !== core.primaryLocale && <LocaleTag locale={core.contentLocale} />}
        </div>
        <DescriptionField id="product-description" value={c.description} onChange={(v) => core.updateContent("description", v)} locale={core.contentLocale} placeholder={t("descriptionPlaceholder")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("features")} hint={t("featuresHint")}>
          <Textarea rows={5} value={c.featuresText} onChange={(e) => core.updateContent("featuresText", e.target.value)} placeholder={t("featuresPlaceholder")} />
        </Field>
        <Field label={t("specs")} hint={t("specsHint")}>
          <Textarea rows={5} value={c.specsText} onChange={(e) => core.updateContent("specsText", e.target.value)} placeholder={t("specsPlaceholder")} className="font-mono text-xs" />
        </Field>
      </div>
      <Field label={t("warranty")} hint={t("warrantyHint")}>
        <Textarea rows={4} value={c.warrantyText} onChange={(e) => core.updateContent("warrantyText", e.target.value)} placeholder={t("warrantyPlaceholder")} />
      </Field>
    </div>
  );
}
