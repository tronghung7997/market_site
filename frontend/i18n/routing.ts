import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "vi"],
  defaultLocale: "en",
  // Next 16 canonicalizes the default `/en` path back to `/`. With
  // `as-needed`, that clashes with next-intl's internal `/` -> `/en` rewrite
  // and results in a redirect loop on the homepage. Keep both locales
  // explicit so `/` redirects once to `/en` and each localized route renders
  // directly.
  localePrefix: "always",
  localeDetection: true,
});

export type AppLocale = (typeof routing.locales)[number];
