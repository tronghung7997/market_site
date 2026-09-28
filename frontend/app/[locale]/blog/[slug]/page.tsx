import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { fetchPublicJson, localePath, pageMetadata, siteOrigin } from "@/lib/seo";
import { extractHeadings } from "@/lib/heading-slug";
import { jsonLdHtml } from "@/lib/json-ld";
import { MarkdownContent } from "@/components/MarkdownContent";
import { MediaImage } from "@/components/media/MediaImage";
import { TableOfContents } from "@/components/patterns/TableOfContents";
import type { PostDetail, PostList } from "@/lib/types";
import { ChevronLeft } from "@/components/Icons";
import {
  BlogCategoryNav, BlogHelpCard, PostRow, RelatedPostList, SharePost, blogListHref, blogPostHref,
  isMeaningfulUpdate, postJsonLd, readingMinutes,
} from "@/features/blog";

function loadPost(slug: string, locale: string) {
  return fetchPublicJson<PostDetail>(`/public/posts/${encodeURIComponent(slug)}`, locale);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const post = await loadPost(slug, locale);
  const t = await getTranslations({ locale, namespace: "blog" });
  if (!post) {
    return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), locale, path: blogPostHref(slug), index: false });
  }
  const description = (post.excerpt || post.body.replace(/[#*_`>\-]+/g, " ")).replace(/\s+/g, " ").trim().slice(0, 160);
  return pageMetadata({
    title: t("postTitle", { title: post.title }),
    description,
    locale,
    path: blogPostHref(slug),
    image: post.cover?.url ?? undefined,
    article: {
      publishedTime: post.published_at,
      modifiedTime: post.updated_at,
      section: t(`categories.${post.category}`),
    },
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const post = await loadPost(slug, locale);
  if (!post) notFound();
  const t = await getTranslations({ locale, namespace: "blog" });
  const related = await fetchPublicJson<PostList>(
    `/public/posts?${new URLSearchParams({ category: post.category, per_page: "4" })}`,
    locale,
  );
  const more = (related?.items ?? []).filter((p) => p.slug !== post.slug).slice(0, 3);
  const dateFormat = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "long" });
  const shortDate = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium" });
  const headings = extractHeadings(post.body);
  const hasToc = headings.length >= 2;
  const section = t(`categories.${post.category}`);
  const origin = siteOrigin();
  const url = `${origin}${localePath(locale, blogPostHref(slug))}`;
  const categoryNames = { all: t("all"), guide: t("categories.guide"), news: t("categories.news") };
  const shareLabels = { heading: t("share"), copy: t("copyLink"), copied: t("linkCopied"), shareVia: t("shareVia") };
  const jsonLd = postJsonLd({
    post,
    origin,
    url,
    siteName: "GMMO",
    homeUrl: `${origin}${localePath(locale)}`,
    blogUrl: `${origin}${localePath(locale, "/blog")}`,
    blogName: t("title"),
    section,
  });

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 sm:py-12 lg:grid lg:grid-cols-[minmax(0,760px)_240px] lg:justify-between lg:gap-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <article className="min-w-0">
        <Link href="/blog" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
          <ChevronLeft size={14} /> {t("back")}
        </Link>
        <header className="mt-6">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted">
            <Link href={blogListHref({ category: post.category, page: 1 })} className="font-medium text-iris-hi hover:underline">{section}</Link>
            <span aria-hidden>·</span>
            <time dateTime={post.published_at}>{dateFormat.format(new Date(post.published_at))}</time>
            <span aria-hidden>·</span>
            <span>{t("readingTime", { minutes: readingMinutes(post.body) })}</span>
            {isMeaningfulUpdate(post.published_at, post.updated_at) && (
              <>
                <span aria-hidden>·</span>
                <span>{t("updatedAt", { date: dateFormat.format(new Date(post.updated_at)) })}</span>
              </>
            )}
          </p>
          <h1 className="mt-3 font-serif text-[32px] font-semibold leading-[1.15] tracking-tight sm:text-[40px]">{post.title}</h1>
          {post.excerpt && <p className="mt-4 text-[18px] leading-relaxed text-muted sm:text-[20px]">{post.excerpt}</p>}
        </header>
        {post.cover && (
          <MediaImage
            image={post.cover}
            variant="full"
            priority
            alt={post.title}
            className="mt-8 aspect-[1.91] w-full rounded-card border border-line"
          />
        )}
        {hasToc && (
          <details className="group mt-8 rounded-card border border-line bg-surface lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] font-medium [&::-webkit-details-marker]:hidden">
              {t("onThisPage")}
              <ChevronLeft size={16} className="-rotate-90 text-muted transition-transform group-open:rotate-90" />
            </summary>
            <TableOfContents headings={headings} label={t("onThisPage")} labelHidden className="px-4 pb-4" />
          </details>
        )}
        <MarkdownContent variant="article" className="mt-10">{post.body}</MarkdownContent>

        {more.length > 0 && (
          // Without a table of contents the right column already lists these from lg.
          <section aria-labelledby="keep-reading" className={cn("mt-14 border-t border-line pt-8", !hasToc && "lg:hidden")}>
            <h2 id="keep-reading" className="font-serif text-[22px] font-semibold tracking-tight">{t("keepReading")}</h2>
            <ul className="mt-2 divide-y divide-line">
              {more.map((p) => (
                <li key={p.slug}>
                  <PostRow post={p} headingLevel={3} categoryLabel={t(`categories.${p.category}`)} date={shortDate.format(new Date(p.published_at))} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <SharePost url={url} title={post.title} labels={shareLabels} className="mt-10 lg:hidden" />
        <div className="mt-10">
          <BlogHelpCard title={t("helpTitle")} body={t("helpBody")} linkLabel={t("helpCenter")} />
        </div>
      </article>
      {/* The right column is always there, so the reading column keeps the
          header's left edge; a post too short for a table of contents gets
          related posts and the categories instead. */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] space-y-8 overflow-y-auto pt-12">
          {hasToc ? (
            <TableOfContents headings={headings} label={t("onThisPage")} />
          ) : (
            <>
              <RelatedPostList
                label={t("related")}
                items={more.map((p) => ({ post: p, date: shortDate.format(new Date(p.published_at)) }))}
              />
              <BlogCategoryNav variant="list" current={post.category} label={t("categoriesLabel")} names={categoryNames} />
            </>
          )}
          <SharePost url={url} title={post.title} labels={shareLabels} compact />
        </div>
      </aside>
    </div>
  );
}
