/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === "production";
const apiTarget = process.env.API_URL ?? "http://localhost:8001";
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

export default nextConfig;
