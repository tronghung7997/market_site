import type { Metadata } from "next";
import { signedBackendFetch } from "./bff-request-signing";
import { isGoogleIndexingEnabled } from "./search-indexing";

export { isGoogleIndexingEnabled } from "./search-indexing";

export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function localePath(locale: string, path = "/"): string {
  const suffix = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${suffix}`;
}

export async function fetchPublicJson<T>(path: string, locale: string): Promise<T | null> {
  try {
    const res = await signedBackendFetch(path, {
      headers: { "Accept-Language": locale },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function pageMetadata({
  title,
  description,
  locale,
  path,
  index = true,
}: {
  title: string;
  description: string;
  locale: string;
  path: string;
  index?: boolean;
}): Metadata {
  const url = `${siteOrigin()}${localePath(locale, path)}`;
  return {
    title,
    description,
    alternates: {
      canonical: localePath(locale, path),
      languages: {
        en: localePath("en", path),
        vi: localePath("vi", path),
        "x-default": localePath("en", path),
      },
    },
    openGraph: {
      title,
      description,
      url,
      locale: locale === "vi" ? "vi_VN" : "en_US",
      type: "website",
      siteName: "GMMO",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots:
      index && isGoogleIndexingEnabled()
        ? { index: true, follow: true }
        : { index: false, follow: false },
  };
}

export const PRIVATE_ROBOTS: Metadata = {
  robots: { index: false, follow: false },
};
