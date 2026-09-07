import type { MetadataRoute } from "next";
import { isGoogleIndexingEnabled, siteOrigin } from "@/lib/seo";

const PRIVATE = [
  "/admin",
  "/seller",
  "/orders",
  "/wallet",
  "/messages",
  "/transactions",
  "/api",
  "/prototype",
];

export default function robots(): MetadataRoute.Robots {
  if (!isGoogleIndexingEnabled()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  const disallow = ["en", "vi"].flatMap((locale) =>
    PRIVATE.map((path) => `/${locale}${path}`),
  );
  return {
    rules: [{ userAgent: "*", allow: "/", disallow }],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
