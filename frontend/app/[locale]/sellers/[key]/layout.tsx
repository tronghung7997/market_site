import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";
import { sellerPath } from "@/lib/routes";
import type { SellerProfile } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; key: string }>;
}) {
  const { locale, key } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  // Same call the page makes; fetchPublicJson dedupes it within the request.
  const seller = await fetchPublicJson<SellerProfile>(`/sellers/${encodeURIComponent(key)}`, locale);
  if (!seller) {
    return pageMetadata({
      title: t("title"),
      description: t("description"),
      locale,
      path: `/sellers/${key}`,
      index: false,
    });
  }
  return pageMetadata({
    title: t("sellerTitle", { name: seller.display_name }),
    description: seller.bio || t("sellerDescription", { name: seller.display_name }),
    locale,
    path: sellerPath(seller),
  });
}

export default function SellerKeyLayout({ children }: { children: ReactNode }) {
  return children;
}
