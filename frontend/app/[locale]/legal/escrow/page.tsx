import { getTranslations } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  return pageMetadata({ title: t("escrowTitle"), description: t("escrowDesc"), locale, path: "/legal/escrow" });
}

export default async function EscrowPolicyPage() {
  const t = await getTranslations("legal");
  return (
    <article className="mx-auto w-full max-w-[720px] px-6 py-12">
      <h1 className="font-serif text-[32px] font-semibold tracking-tight">{t("escrowTitle")}</h1>
      <div className="mt-6 space-y-4 text-[14px] leading-relaxed text-muted">
        <p>{t("escrowP1")}</p>
        <p>{t("escrowP2")}</p>
        <p>{t("escrowP3")}</p>
      </div>
    </article>
  );
}
