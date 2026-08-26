import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";

type PublicProduct = {
  id: number;
  title: string;
  highlight_text?: string | null;
  variants?: { price: number }[];
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  const product = await fetchPublicJson<PublicProduct>(`/products/${id}`, locale);
  if (!product) {
    return pageMetadata({
      title: t("title"),
      description: t("description"),
      locale,
      path: `/products/${id}`,
    });
  }
  return pageMetadata({
    title: t("productTitle", { title: product.title }),
    description: product.highlight_text || t("productDescription", { title: product.title }),
    locale,
    path: `/products/${id}`,
  });
}

export default async function ProductLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const product = await fetchPublicJson<PublicProduct>(`/products/${id}`, locale);
  const low = product?.variants?.reduce((min, variant) => (
    variant.price > 0 && (min === 0 || variant.price < min) ? variant.price : min
  ), 0) ?? 0;
  const jsonLd = product
    ? {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.title,
      description: product.highlight_text || product.title,
      offers: {
        "@type": "Offer",
        priceCurrency: "VND",
        price: low || undefined,
        availability: "https://schema.org/InStock",
        url: `/products/${product.id}`,
      },
    }
    : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
