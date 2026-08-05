import "../globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Newsreader, Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/lib/query-provider";
import TopNav from "@/components/TopNav";
import SiteFooter from "@/components/SiteFooter";
import ChromeGate from "@/components/ChromeGate";
import RouteProgress from "@/components/RouteProgress";
import ReferralCapture from "@/components/ReferralCapture";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routing } from "@/i18n/routing";

const newsreader = Newsreader({
  subsets: ["latin", "vietnamese"], style: ["normal", "italic"], variable: "--font-newsreader", display: "swap",
});
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700"], variable: "--font-bvp", display: "swap",
});
const jbMono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jbmono", display: "swap",
});

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "metadata" });
  const localePath = locale === routing.defaultLocale ? "" : `/${locale}`;

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: localePath || "/",
      languages: { en: "/", vi: "/vi", "x-default": "/" },
    },
  };
}

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${newsreader.variable} ${beVietnam.variable} ${jbMono.variable}`}>
      <body className="min-h-screen flex flex-col">
        <NextIntlClientProvider>
          <AuthProvider>
            <QueryProvider>
              <TooltipProvider>
                <RouteProgress />
                <Suspense fallback={null}><ReferralCapture /></Suspense>
                <ChromeGate><TopNav /></ChromeGate>
                <main className="flex-1 flex flex-col">{children}</main>
                <ChromeGate><SiteFooter /></ChromeGate>
              </TooltipProvider>
            </QueryProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
