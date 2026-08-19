"use client";

import type { ProductLocale, ProductTranslation } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { useTranslations } from "next-intl";

const LANGUAGE_NAMES: Record<ProductLocale, Record<ProductLocale, string>> = {
  vi: { vi: "Tiếng Việt", en: "English" },
  en: { vi: "Vietnamese", en: "English" },
};

function translationState(
  translation: ProductTranslation | null | undefined,
  label: (key: string) => string,
  required: { specs?: boolean; pricingLabels?: boolean },
) {
  const hasAny = translation && Object.values(translation).some((value) => (
    Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim() : Boolean(value)
  ));
  if (!hasAny) return { label: label("translationMissing"), tone: "neutral" as const };
  const structuredComplete = (!required.specs || Boolean(translation?.specs && Object.keys(translation.specs).length > 0))
    && (!required.pricingLabels || Boolean(translation?.pricing_labels && Object.keys(translation.pricing_labels).length > 0));
  if (translation?.title?.trim() && translation?.description?.trim() && structuredComplete) {
    return { label: label("translationComplete"), tone: "good" as const };
  }
  return { label: label("translationIncomplete"), tone: "warn" as const };
}

export function ProductLanguageRail({
  interfaceLocale,
  activeLocale,
  translations,
  requiredFields = {},
  dirty = false,
  onChange,
}: {
  interfaceLocale: ProductLocale;
  activeLocale: ProductLocale;
  translations?: Partial<Record<ProductLocale, ProductTranslation>> | null;
  requiredFields?: { specs?: boolean; pricingLabels?: boolean };
  dirty?: boolean;
  onChange: (locale: ProductLocale) => void;
}) {
  const t = useTranslations("seller");
  const languageNames = LANGUAGE_NAMES[interfaceLocale];
  return (
    <Card className="overflow-hidden border-iris/25 border-l-4 border-l-iris">
      <div className="flex flex-col gap-3 bg-iris-soft/55 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iris-hi">
            {t("contentLanguageTitle")}
          </div>
          <div className="mt-1 text-[12px] text-muted">
            {t("interfaceLanguage", { language: languageNames[interfaceLocale] })} · {t("editingLanguage", { language: languageNames[activeLocale] })}
          </div>
        </div>
        <div className="flex w-full gap-1 rounded-lg border border-line bg-panel p-1 sm:w-auto" role="group" aria-label={t("chooseContentLanguage")}>
          {(["vi", "en"] as ProductLocale[]).map((locale) => {
            const state = translationState(translations?.[locale], t, requiredFields);
            const active = locale === activeLocale;
            return (
              <button
                key={locale}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(locale)}
                className={`flex min-w-0 flex-1 flex-col items-start justify-center gap-1.5 rounded-md px-3 py-2 text-left transition-colors sm:min-w-[172px] sm:flex-row sm:items-center sm:justify-between sm:gap-2 ${
                  active ? "bg-iris text-white shadow-sm" : "text-muted hover:bg-raised hover:text-fg"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`font-mono text-[11px] font-bold ${active ? "text-white" : "text-iris-hi"}`}>
                    {locale.toUpperCase()}
                  </span>
                  <span className="whitespace-nowrap text-[12.5px] font-medium">{languageNames[locale]}</span>
                </span>
                <Tag tone={active ? "neutral" : state.tone} className={active ? "border-white/30 bg-white/15 text-white" : undefined}>
                  {active && dirty ? t("translationUnsaved") : state.label}
                </Tag>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

export const productLanguageName = (locale: ProductLocale, interfaceLocale: ProductLocale = "vi") => LANGUAGE_NAMES[interfaceLocale][locale];
