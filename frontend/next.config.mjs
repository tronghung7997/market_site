import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === "production";
const apiTarget = process.env.API_URL ?? "http://localhost:8001";
// Demo top-up is opt-in in development and always disabled in production.
// Keeping this as a public build flag lets the wallet hide the control instead
// of exposing a button that the backend will reject with 403.
const enableDemoTopup = !isProduction && process.env.NEXT_PUBLIC_ENABLE_DEMO_TOPUP === "true";
const parsedApiTarget = new URL(apiTarget);

if (!["http:", "https:"].includes(parsedApiTarget.protocol)) {
  throw new Error("API_URL must use http or https");
}
if (
  isProduction
  && ["localhost", "127.0.0.1", "::1"].includes(parsedApiTarget.hostname)
) {
  throw new Error("Production API_URL must not target localhost");
}

// Microsoft Clarity load-balances across *.clarity.ms and beacons to c.bing.com.
const clarityOrigins = "https://*.clarity.ms https://c.bing.com";
// Google Analytics 4: gtag.js from googletagmanager, hits to *.google-analytics.com.
const gaScriptOrigin = "https://www.googletagmanager.com";
const gaConnectOrigins = "https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com";
// Cloudflare Turnstile (sign-up / sign-in captcha) renders in an iframe from this origin.
const turnstileOrigin = "https://challenges.cloudflare.com";

// The /docs/api "Test Request" console calls the public buyer API from the
// browser. Only that page may connect to it, and only under /v1/ (CSP path
// match), so the rest of the site keeps a same-origin connect-src.
const publicApiV1 = `${new URL(
  process.env.PUBLIC_API_BASE_URL?.trim() || (isProduction ? "https://api.gmmo.info" : apiTarget),
).origin}/v1/`;

const cspDirectives = (extraConnect = "") => [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline' ${clarityOrigins} ${gaScriptOrigin} ${turnstileOrigin}${isProduction ? "" : " 'unsafe-eval'"}`,
  `frame-src ${turnstileOrigin}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${clarityOrigins} ${gaConnectOrigins} ${turnstileOrigin}${isProduction ? "" : " ws: http://localhost:8001"}${extraConnect}`,
].join("; ");
const contentSecurityPolicy = cspDirectives();
const apiDocsContentSecurityPolicy = cspDirectives(` ${publicApiV1}`);

const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // `npm run build` runs `tsc --noEmit` first (incremental, info file under
  // .next/cache), so Next skips its own type check. Inside `next build` that
  // check overlaps the still-running Turbopack process and pushes peak RSS
  // to about 4 GB; run separately it is cached and the peak stays near 3.4 GB.
  typescript: { ignoreBuildErrors: true },
  experimental: {
    // Production builds use Turbopack. Its persistent cache lives in
    // .next/cache, which the Docker build keeps in a BuildKit cache mount:
    // a one-file change rebuilds in seconds instead of a full compile.
    turbopackFileSystemCacheForBuild: true,
  },
  // The Docker image historically receives API_URL only in the builder
  // stage. Preserve that deployment contract for the server-side API route.
  // This must remain distinct from API_URL because standalone also copies the
  // local .env file, which may contain a development-only localhost target.
  env: {
    BUILT_API_URL: apiTarget,
    NEXT_PUBLIC_ENABLE_DEMO_TOPUP: enableDemoTopup ? "true" : "false",
  },
  // Edge redirect so old bookmarks keep working even if a page route is stale
  // in the dev server (App Router page redirect alone was returning 200 empty).
  async redirects() {
    return [
      {
        source: "/:locale(en|vi)/admin/money",
        destination: "/:locale/admin/display-settings",
        permanent: false,
      },
      {
        source: "/:locale(en|vi)/admin/deposit-rails",
        destination: "/:locale/admin/display-settings",
        permanent: false,
      },
    ];
  },
  async headers() {
    const headers = [
      { key: "Content-Security-Policy", value: contentSecurityPolicy },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];
    if (isProduction) {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }
    // Static brand assets under `public/` otherwise ship `max-age=0`, which
    // made the CDN revalidate every cover image and the favicon against the
    // origin on each page view.
    const staticAssetCache = {
      key: "Cache-Control",
      value: "public, max-age=86400, stale-while-revalidate=604800",
    };
    return [
      { source: "/:path*", headers },
      // Overrides the site-wide CSP (last matching header wins in Next).
      {
        source: "/:locale(en|vi)/docs/api",
        headers: [{ key: "Content-Security-Policy", value: apiDocsContentSecurityPolicy }],
      },
      { source: "/covers/:path*", headers: [staticAssetCache] },
      { source: "/favicon.ico", headers: [staticAssetCache] },
    ];
  },
};

export default withNextIntl(nextConfig);
