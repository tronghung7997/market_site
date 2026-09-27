import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";
import type { PostList } from "@/lib/types";
import { PostCard, POST_CATEGORIES } from "@/features/blog";

type Category = (typeof POST_CATEGORIES)[number];

function readCategory(value: string | string[] | undefined): Category | null {
  return typeof value === "string" && (POST_CATEGORIES as readonly string[]).includes(value) ? (value as Category) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "blog" });
  return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), locale, path: "/blog" });
}

export default async function BlogPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const category = readCategory(query.category);
  const page = Math.max(1, Number(query.page) || 1);
  const t = await getTranslations({ locale, namespace: "blog" });
  const qs = new URLSearchParams({ page: String(page), ...(category ? { category } : {}) });
  const list = await fetchPublicJson<PostList>(`/public/posts?${qs}`, locale);
  const date = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium" });
  const pages = list ? Math.max(1, Math.ceil(list.total / list.per_page)) : 1;
  const href = (next: { category?: Category | null; page?: number }) => {
    const p = new URLSearchParams();
    const c = next.category === undefined ? category : next.category;
    if (c) p.set("category", c);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const s = p.toString();
    return s ? `/blog?${s}` : "/blog";
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-serif text-[32px] font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-1.5 max-w-[640px] text-[14px] text-muted">{t("lead")}</p>

      <nav aria-label={t("categoriesLabel")} className="mt-6 flex gap-1.5 overflow-x-auto pb-1">
        {[null, ...POST_CATEGORIES].map((c) => (
          <Link
            key={c ?? "all"}
            href={href({ category: c, page: 1 })}
            aria-current={category === c ? "page" : undefined}
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-lg border px-3 text-[12.5px] font-medium",
              category === c ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:text-fg",
            )}
          >
            {c ? t(`categories.${c}`) : t("all")}
          </Link>
        ))}
      </nav>

      {!list ? (
        <p className="mt-10 text-[14px] text-bad">{t("loadFailed")}</p>
      ) : list.items.length === 0 ? (
        <div className="mt-10 rounded-card border border-line bg-surface px-6 py-12 text-center">
          <p className="text-[14px] font-medium">{t("empty")}</p>
          <p className="mt-1 text-[13px] text-muted">{t("emptyHint")}</p>
          <Link href="/support" className="mt-4 inline-block text-[13px] font-medium text-iris-hi hover:underline">{t("helpCenter")}</Link>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.items.map((post) => (
            <li key={post.slug}>
              <PostCard post={post} categoryLabel={t(`categories.${post.category}`)} date={date.format(new Date(post.published_at))} />
            </li>
          ))}
        </ul>
      )}

      {list && pages > 1 && (
        <nav aria-label={t("pagination")} className="mt-8 flex items-center justify-between text-[13px]">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="font-medium text-iris-hi hover:underline">{t("newer")}</Link> : <span />}
          <span className="font-mono text-[12px] text-faint">{page}/{pages}</span>
          {page < pages ? <Link href={href({ page: page + 1 })} className="font-medium text-iris-hi hover:underline">{t("older")}</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
