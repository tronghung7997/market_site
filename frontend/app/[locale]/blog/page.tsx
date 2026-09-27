import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";
import type { PostCategory, PostList } from "@/lib/types";
import {
  BlogCategoryNav, BlogHelpCard, FeaturedPost, PostRow, blogListHref, readPostCategory,
} from "@/features/blog";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readListQuery(query: Record<string, string | string[] | undefined>) {
  return { category: readPostCategory(query.category), page: Math.max(1, Math.floor(Number(query.page)) || 1) };
}

/* One cached fetch per list view, shared by generateMetadata and the page. */
function loadList(category: PostCategory | null, page: number, locale: string) {
  const qs = new URLSearchParams({ page: String(page), ...(category ? { category } : {}) });
  return fetchPublicJson<PostList>(`/public/posts?${qs}`, locale);
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SearchParams }) {
  const { locale } = await params;
  const { category, page } = readListQuery(await searchParams);
  const t = await getTranslations({ locale, namespace: "blog" });
  const list = await loadList(category, page, locale);
  // Each list view (category, page) is its own canonical URL so posts deeper
  // than page 1 stay reachable; a page past the end is not worth indexing.
  const title = [category ? t(`categories.${category}`) : null, page > 1 ? t("pageLabel", { page }) : null, t("metaTitle")]
    .filter(Boolean)
    .join(" · ");
  return pageMetadata({
    title,
    description: t("metaDescription"),
    locale,
    path: blogListHref({ category, page }),
    index: !(list && list.items.length === 0 && page > 1),
  });
}

export default async function BlogPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SearchParams }) {
  const { locale } = await params;
  const { category, page } = readListQuery(await searchParams);
  const t = await getTranslations({ locale, namespace: "blog" });
  const list = await loadList(category, page, locale);
  const date = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium" });
  const pages = list ? Math.max(1, Math.ceil(list.total / list.per_page)) : 1;
  const items = list?.items ?? [];
  const featured = page === 1 ? (items[0] ?? null) : null;
  const rest = featured ? items.slice(1) : items;

  const categoryNames = { all: t("all"), guide: t("categories.guide"), news: t("categories.news") };

  // Same frame as a post page: the list column starts at the header's left
  // edge, categories and help sit in a right column ending at its right edge.
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 sm:py-12 lg:grid lg:grid-cols-[minmax(0,760px)_240px] lg:justify-between lg:gap-12">
      <div className="min-w-0">
        <h1 className="font-serif text-[32px] font-semibold tracking-tight sm:text-[40px]">{t("title")}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-muted">{t("lead")}</p>

        <BlogCategoryNav variant="chips" current={category} label={t("categoriesLabel")} names={categoryNames} className="mt-6 lg:hidden" />

        {!list ? (
          <p role="alert" className="mt-10 text-[14px] text-bad">{t("loadFailed")}</p>
        ) : list.items.length === 0 ? (
          <div className="mt-10 rounded-card border border-line bg-surface px-6 py-12 text-center">
            <p className="text-[14px] font-medium">{t("empty")}</p>
            <p className="mt-1 text-[13px] text-muted">{t("emptyHint")}</p>
            <Link href="/support" className="mt-4 inline-block text-[13px] font-medium text-iris-hi hover:underline">{t("helpCenter")}</Link>
          </div>
        ) : (
          <div className="mt-8">
            {featured && (
              <FeaturedPost post={featured} categoryLabel={t(`categories.${featured.category}`)} date={date.format(new Date(featured.published_at))} />
            )}
            {rest.length > 0 && (
              <ul className={cn("divide-y divide-line", featured && "border-t border-line")}>
                {rest.map((post) => (
                  <li key={post.slug}>
                    <PostRow post={post} categoryLabel={t(`categories.${post.category}`)} date={date.format(new Date(post.published_at))} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {list && pages > 1 && (
          <nav aria-label={t("pagination")} className="mt-8 flex items-center justify-between border-t border-line pt-6 text-[13px]">
            {page > 1 ? <Link href={blogListHref({ category, page: page - 1 })} className="font-medium text-iris-hi hover:underline">{t("newer")}</Link> : <span />}
            <span className="font-mono text-[12px] text-faint">{page}/{pages}</span>
            {page < pages ? <Link href={blogListHref({ category, page: page + 1 })} className="font-medium text-iris-hi hover:underline">{t("older")}</Link> : <span />}
          </nav>
        )}
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-24 space-y-8 pt-4">
          <BlogCategoryNav variant="list" current={category} label={t("categoriesLabel")} names={categoryNames} />
          <BlogHelpCard title={t("helpTitle")} body={t("helpBody")} linkLabel={t("helpCenter")} />
        </div>
      </aside>
    </div>
  );
}
