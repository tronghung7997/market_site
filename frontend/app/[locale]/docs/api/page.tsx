import { getTranslations } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";
import { SERVER_API_BASE } from "@/lib/server-api";
import DocsTopBar from "./DocsTopBar";
import ScalarReference from "./ScalarReference";

/* Public documentation of the buyer sales API (/v1, marketplace-svc
   src/public_api) in its own full-width shell (ChromeGate drops the
   storefront chrome here): a slim top bar, then Scalar rendering the
   backend's curated GET /v1/openapi.json — the guide lives in its
   info.description, so it shares the sidebar with the endpoints.
   The API itself is served by the backend host (never the website BFF);
   `PUBLIC_API_BASE_URL` names that host for examples and "Test Request". */
type Spec = Record<string, unknown> & { servers?: { url: string }[] };

async function loadSpec(): Promise<Spec | null> {
  try {
    const res = await fetch(`${SERVER_API_BASE}/v1/openapi.json`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as Spec;
  } catch {
    return null;
  }
}

function publicBase(spec: Spec | null): string {
  const configured = process.env.PUBLIC_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  // Dev: the backend the site talks to is also the one scripts reach.
  if (process.env.NODE_ENV !== "production") return SERVER_API_BASE;
  return (spec?.servers?.[0]?.url || "https://<api-host>").replace(/\/$/, "");
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "apiDocs" });
  return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), locale, path: "/docs/api" });
}

export default async function ApiDocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "apiDocs" });
  const spec = await loadSpec();
  const resolved = spec ? { ...spec, servers: [{ url: publicBase(spec) }] } : null;

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <DocsTopBar locale={locale} labels={{
        docs: t("docsLabel"), getKey: t("getKey"), backToSite: t("backToSite"), language: t("languageLabel"),
      }} />
      {resolved ? (
        <ScalarReference spec={resolved} />
      ) : (
        <p className="mx-auto mt-16 max-w-md rounded-card border border-line bg-card px-4 py-6 text-center text-[13.5px] text-muted">
          {t("unavailable")}
        </p>
      )}
    </div>
  );
}
