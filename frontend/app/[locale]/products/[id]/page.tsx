import { getLocale } from "next-intl/server";
import { loadProductPage } from "@/features/catalog";
import ProductView from "./ProductView";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const initial = await loadProductPage(locale, Number(id));
  return <ProductView initial={initial} />;
}
