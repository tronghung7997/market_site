import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { pageMetadata } from "@/lib/seo";
import { SERVER_API_BASE } from "@/lib/server-api";
import ScalarReference from "./ScalarReference";

/* Public documentation of the buyer sales API (/v1, marketplace-svc
   src/public_api). A short hand-written quickstart, then the Scalar
   reference rendered from the backend's curated GET /v1/openapi.json.
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

const code = (chunks: ReactNode) => <code className="rounded bg-raised px-1 py-0.5 font-mono text-[12.5px] text-fg">{chunks}</code>;

const ERROR_SHAPE = `{ "error": { "code": "insufficient_balance", "message": "Your wallet balance is too low for this order." } }`;

export default async function ApiDocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "apiDocs" });
  const spec = await loadSpec();
  const base = publicBase(spec);
  const resolved = spec ? { ...spec, servers: [{ url: base }] } : null;
  const link = (chunks: ReactNode) => <Link href="/account?tab=api" className="font-medium text-iris-hi hover:underline">{chunks}</Link>;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="max-w-3xl">
        <h1 className="font-serif text-[30px] font-semibold tracking-tight text-fg">{t("title")}</h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-muted">{t("intro")}</p>
        <p className="mt-3 text-[13px] text-muted">{t("baseUrl")} <code className="font-mono text-fg">{base}/v1</code></p>
      </header>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-card p-5">
          <h2 className="text-[15px] font-semibold text-fg">{t("quickstart")}</h2>
          <ol className="mt-3 space-y-2.5 text-[13.5px] leading-relaxed text-muted">
            {(["step1", "step2", "step3", "step4"] as const).map((key, i) => (
              <li key={key} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-iris-soft text-[11.5px] font-semibold text-iris-hi tabular-nums">{i + 1}</span>
                <span>{t.rich(key, { code, link })}</span>
              </li>
            ))}
          </ol>
        </section>
        <div className="space-y-4">
          <section className="rounded-card border border-line bg-card p-5">
            <h2 className="text-[15px] font-semibold text-fg">{t("idemTitle")}</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t("idemBody")}</p>
          </section>
          <section className="rounded-card border border-line bg-card p-5">
            <h2 className="text-[15px] font-semibold text-fg">{t("errorsTitle")}</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t("errorsBody")}</p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-raised px-3 py-2 font-mono text-[12px] text-fg"><code>{ERROR_SHAPE}</code></pre>
          </section>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="font-serif text-[22px] font-semibold tracking-tight text-fg">{t("referenceTitle")}</h2>
        <p className="mt-1 mb-4 text-[13px] text-muted">{t("referenceHint")}</p>
        {resolved ? (
          <ScalarReference spec={resolved} />
        ) : (
          <p className="rounded-card border border-line bg-card px-4 py-6 text-[13.5px] text-muted">{t("unavailable")}</p>
        )}
      </section>
    </div>
  );
}
