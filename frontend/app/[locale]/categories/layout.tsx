import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return pageMetadata({
    title: t("categoriesTitle"),
    description: t("categoriesDescription"),
    locale,
    path: "/categories",
  });
}

export default function CategoriesLayout({ children }: { children: ReactNode }) {
  return children;
}
