import { loadProductPage } from "@/features/catalog";
import ProductView from "./ProductView";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; key: string }>;
}) {
  const { locale, key } = await params;
  // Canonical-URL redirects for legacy ids / stale slugs live in layout.tsx.
  const initial = await loadProductPage(locale, key);
  return <ProductView initial={initial} productRef={key} />;
}
