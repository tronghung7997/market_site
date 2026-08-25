"use client";

import type { ProductLocale, ProductTranslation } from "@/lib/types";
import { Button, Card, Tag } from "@/components/ui";
import { Globe } from "@/components/Icons";
import { cn } from "@/lib/cn";
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
  primaryLocale,
  onChange,
  onPrimaryLocaleChange,
}: {
  interfaceLocale: ProductLocale;
  activeLocale: ProductLocale;
  translations?: Partial<Record<ProductLocale, ProductTranslation>> | null;
  requiredFields?: { specs?: boolean; pricingLabels?: boolean };
  dirty?: boolean;
  primaryLocale?: ProductLocale;
  onChange: (locale: ProductLocale) => void;
  onPrimaryLocaleChange?: (locale: ProductLocale) => void;
}) {
  const t = useTranslations("seller");
  const languageNames = LANGUAGE_NAMES[interfaceLocale];
  return (
    <Card className="border-iris/25">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-iris/20 bg-iris-soft text-iris-hi" aria-hidden="true">
            <Globe size={17} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-fg">{t("contentLanguageTitle")}</h3>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
              <span>{t("interfaceLanguage", { language: languageNames[interfaceLocale] })}</span>
              <span>{t("editingLanguage", { language: languageNames[activeLocale] })}</span>
              {primaryLocale && (
                <span>{t("primaryContentLanguage", { language: languageNames[primaryLocale] })}</span>
              )}
            </div>
          </div>
        </div>

        <div
          className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2"
          role="group"
          aria-label={t("chooseContentLanguage")}
        >
          {(["vi", "en"] as ProductLocale[]).map((locale) => {
            const state = translationState(translations?.[locale], t, requiredFields);
            const active = locale === activeLocale;
            const isOptionalMissing = primaryLocale != null
              && locale !== primaryLocale
              && state.tone === "neutral";
            const status = active && dirty
              ? { label: t("translationUnsaved"), tone: "warn" as const }
              : isOptionalMissing
                ? { label: t("translationOptional"), tone: "neutral" as const }
                : state;

            return (
              <button
                key={locale}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(locale)}
                className={cn(
                  "flex min-h-14 min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/35",
                  active
                    ? "border-iris bg-iris-soft/55 text-fg shadow-xs"
                    : "border-line bg-surface text-muted hover:border-line-2 hover:bg-raised/60 hover:text-fg",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-md border font-mono text-[11px] font-bold",
                    active ? "border-iris/25 bg-panel text-iris-hi" : "border-line bg-raised text-muted",
                  )}
                >
                  {locale.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {languageNames[locale]}
                </span>
                <Tag tone={status.tone} className="shrink-0">
                  {status.label}
                </Tag>
              </button>
            );
          })}
        </div>

        {primaryLocale && onPrimaryLocaleChange && activeLocale !== primaryLocale && (
          <div className="mt-3 flex justify-end border-t border-line pt-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onPrimaryLocaleChange(activeLocale)}
              className="max-sm:w-full"
            >
              {t("makePrimaryContentLanguage", { language: languageNames[activeLocale] })}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export const productLanguageName = (locale: ProductLocale, interfaceLocale: ProductLocale = "vi") => LANGUAGE_NAMES[interfaceLocale][locale];
