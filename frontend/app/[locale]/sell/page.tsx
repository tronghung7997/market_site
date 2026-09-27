import { getTranslations } from "next-intl/server";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";
import { SellLanding } from "@/features/seller-join";
import type { FeeConfigPublic, SellerTierRule } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return pageMetadata({ title: t("sellTitle"), description: t("sellDescription"), locale, path: "/sell" });
}

export default async function SellPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const [fees, tiers] = await Promise.all([
    fetchPublicJson<FeeConfigPublic>("/public/fee-config", locale),
    fetchPublicJson<{ tiers: SellerTierRule[] }>("/public/seller-tiers", locale),
  ]);
  return <SellLanding fees={fees} tiers={tiers?.tiers ?? []} />;
}
