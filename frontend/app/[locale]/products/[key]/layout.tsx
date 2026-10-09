import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { permanentRedirect } from "@/i18n/navigation";
import { fetchPublicJson, localePath, pageMetadata, siteOrigin } from "@/lib/seo";
import { jsonLdHtml } from "@/lib/json-ld";
import { productParamIsCanonical, productPath } from "@/lib/routes";
import { productJsonLd, type ProductLike } from "@/lib/structured-data";

type PublicProduct = ProductLike & {
  id: number;
  slug: string;
  canonical_path?: string | null;
  seller_path?: string | null;
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
  // Product, or SoftwareApplication for tools/APIs; ratings from real buyers only.
  const jsonLd = product
    ? productJsonLd({
      product,
      url: `${siteOrigin()}${localePath(locale, productPath(product))}`,
      origin: siteOrigin(),
      sellerUrl: product.seller_path ? `${siteOrigin()}${localePath(locale, product.seller_path)}` : null,
      now: new Date(),
    })
    : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
