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

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isProduction ? "" : " ws: http://localhost:8001"}`,
].join("; ");

const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
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
      {
        source: "/favicon.ico",
        destination: "/icon.svg",
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
    return [{ source: "/:path*", headers }];
  },
};

export default withNextIntl(nextConfig);
