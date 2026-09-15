import type { Metadata } from "next";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { signedBackendFetch } from "./bff-request-signing";
import { CATALOG_CACHE_TAG, PUBLIC_CACHE_SECONDS } from "./bff-cache";
import { isGoogleIndexingEnabled } from "./search-indexing";

export { isGoogleIndexingEnabled } from "./search-indexing";

export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function localePath(locale: string, path = "/"): string {
  const suffix = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${suffix}`;
}

type PublicJsonResult = { status: number; body: unknown };

/**
 * One signed round-trip to the backend. Runs only on a cache miss: the HMAC
 * headers carry a per-second timestamp, so Next's fetch Data Cache can never
 * hit on its own — the caching lives in the `unstable_cache` wrapper below,
 * keyed by path + locale instead of by headers.
 *
 * 404 is a legitimate cacheable answer (unknown product/category); anything
 * else non-2xx is thrown so a backend hiccup is never cached for a minute.
 */
async function fetchPublicJsonOrigin(path: string, locale: string): Promise<PublicJsonResult> {
  const res = await signedBackendFetch(path, {
    headers: { "Accept-Language": locale },
    cache: "no-store",
  });
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new Error(`Public fetch ${path} failed with ${res.status}`);
  return { status: res.status, body: await res.json() };
}

const fetchPublicJsonCached = unstable_cache(fetchPublicJsonOrigin, ["public-json-v1"], {
  revalidate: PUBLIC_CACHE_SECONDS,
  tags: [CATALOG_CACHE_TAG],
});

/**
 * Public catalog read for server components, metadata and the sitemap.
 *
 * - shared across requests for `PUBLIC_CACHE_SECONDS` (tag `catalog`, busted
 *   by the BFF after a successful catalog write);
 * - deduped inside one request with `React.cache`, so a layout's
 *   `generateMetadata`, the layout body and the page share a single fetch.
 *
 * Returns null on 404 and on transient failure; callers already treat null
 * as "not available".
 */
export const fetchPublicJson = cache(async <T,>(path: string, locale: string): Promise<T | null> => {
  try {
    const result = await fetchPublicJsonCached(path, locale);
    return (result.body as T | null) ?? null;
  } catch {
    return null;
  }
});

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
