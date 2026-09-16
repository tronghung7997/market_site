import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";
import { extractHeadings } from "@/lib/heading-slug";
import { MarkdownContent } from "@/components/MarkdownContent";
import type { SitePageLink, SitePagePublic } from "@/lib/types";
import { LegalSidebar } from "./LegalSidebar";

/* Footer/legal pages are admin-edited markdown (site_pages). One fetch per
   request is shared between metadata and body via fetchPublicJson's dedupe;
   the BFF busts the shared cache after an admin write. */
function loadPage(slug: string, locale: string) {
  return fetchPublicJson<SitePagePublic>(`/public/site-pages/${encodeURIComponent(slug)}`, locale);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const page = await loadPage(slug, locale);
  if (!page) {
    const t = await getTranslations({ locale, namespace: "metadata" });
    return pageMetadata({ title: t("title"), description: t("description"), locale, path: `/legal/${slug}`, index: false });
  }
  const description = page.body.replace(/[#*_`>\-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return pageMetadata({ title: page.title, description, locale, path: `/legal/${slug}` });
}

export default async function SitePage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const [page, pages] = await Promise.all([
    loadPage(slug, locale),
    fetchPublicJson<SitePageLink[]>("/public/site-pages", locale),
  ]);
  if (!page) notFound();
  const t = await getTranslations({ locale, namespace: "legal" });
  const headings = extractHeadings(page.body);
  const updated = page.updated_at
    ? new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium" }).format(new Date(page.updated_at))
    : null;
  // Trang đang xem bị ẩn khỏi footer vẫn phải có mặt trong mục lục bên trái.
  const navPages = pages?.some((p) => p.slug === slug)
    ? pages
    : [...(pages ?? []), { slug, title: page.title }];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-10 grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside>
        <LegalSidebar
          pages={navPages}
          current={slug}
          headings={headings}
          labels={{ pages: t("navPages"), onThisPage: t("onThisPage") }}
        />
      </aside>
      <article className="min-w-0">
        <h1 className="font-serif text-[32px] font-semibold tracking-tight">{page.title}</h1>
        {updated && <p className="mt-2 text-[12px] text-faint">{t("updatedAt", { date: updated })}</p>}
        <MarkdownContent className="mt-6 text-[14px] leading-relaxed [&_h2]:scroll-mt-24 [&_h3]:scroll-mt-24">
          {page.body}
        </MarkdownContent>
      </article>
    </div>
  );
}
