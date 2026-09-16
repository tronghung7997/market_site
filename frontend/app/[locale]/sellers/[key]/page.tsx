import { permanentRedirect } from "@/i18n/navigation";
import { loadSellerPage } from "@/features/catalog";
import { sellerParamIsCanonical, sellerPath } from "@/lib/routes";
import SellerProfileView from "./SellerProfileView";

export default async function SellerPage({
  params,
}: {
  params: Promise<{ locale: string; key: string }>;
}) {
  const { locale, key } = await params;
  const initial = await loadSellerPage(locale, key);
  // Legacy `/sellers/12` links and renamed shops land on the canonical URL.
  if (initial.seller && !sellerParamIsCanonical(key, initial.seller)) {
    permanentRedirect({ href: sellerPath(initial.seller), locale });
  }
  return <SellerProfileView initial={initial} />;
}
