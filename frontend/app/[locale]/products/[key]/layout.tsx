import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { permanentRedirect } from "@/i18n/navigation";
import { fetchPublicJson, localePath, pageMetadata, siteOrigin } from "@/lib/seo";
import { productParamIsCanonical, productPath } from "@/lib/routes";
import { productStockState } from "@/lib/stock";

type PublicProduct = {
  id: number;
  slug: string;
  public_key: string;
  canonical_path?: string | null;
  title: string;
  highlight_text?: string | null;
  variants?: { price: number; delivery_mode?: string; stock_state?: string | null; is_active?: boolean }[];
};

/** Same route param the page receives; `fetchPublicJson` dedupes the call per request. */
function loadProduct(key: string, locale: string) {
  return fetchPublicJson<PublicProduct>(`/products/${encodeURIComponent(key)}`, locale);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; key: string }>;
}) {
  const { locale, key } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  const product = await loadProduct(key, locale);
  if (!product) {
    return pageMetadata({
      title: t("title"),
      description: t("description"),
      locale,
      path: `/products/${key}`,
      index: false,
    });
  }
  return pageMetadata({
    title: t("productTitle", { title: product.title }),
    description: product.highlight_text || t("productDescription", { title: product.title }),
    locale,
    path: productPath(product),
  });
}

export default async function ProductLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; key: string }>;
}) {
  const { locale, key } = await params;
  const product = await loadProduct(key, locale);
  // Old `/products/12` links and stale slugs resolve, then land on the one
  // canonical URL. This runs in the layout, above the `loading.tsx` Suspense
  // boundary, so it is a real 308 rather than a client-side hop after the
  // shell has streamed.
  if (product && !productParamIsCanonical(key, product)) {
    permanentRedirect({ href: productPath(product), locale });
  }
  const low = product?.variants?.reduce((min, variant) => (
    variant.price > 0 && (min === 0 || variant.price < min) ? variant.price : min
  ), 0) ?? 0;
  const stock = productStockState(product?.variants);
  const jsonLd = product
    ? {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.title,
      description: product.highlight_text || product.title,
      sku: product.public_key,
      url: `${siteOrigin()}${localePath(locale, productPath(product))}`,
      offers: {
        "@type": "Offer",
        priceCurrency: "VND",
        price: low || undefined,
        availability: stock === "out"
          ? "https://schema.org/OutOfStock"
          : stock === "low"
            ? "https://schema.org/LimitedAvailability"
            : "https://schema.org/InStock",
        url: `${siteOrigin()}${localePath(locale, productPath(product))}`,
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
