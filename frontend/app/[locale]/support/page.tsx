import { getTranslations } from "next-intl/server";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";
import { SupportCenter } from "@/features/support-center";
import type { SitePageLink } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return pageMetadata({ title: t("supportTitle"), description: t("supportDescription"), locale, path: "/support" });
}

export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const pages = await fetchPublicJson<SitePageLink[]>("/public/site-pages", locale);
  return <SupportCenter pages={pages ?? []} />;
}
