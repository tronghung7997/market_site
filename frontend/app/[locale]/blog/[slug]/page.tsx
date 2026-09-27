import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";
import { MarkdownContent } from "@/components/MarkdownContent";
import { MediaImage } from "@/components/media/MediaImage";
import type { PostDetail } from "@/lib/types";
import { ArrowRight, ChevronLeft } from "@/components/Icons";

function loadPost(slug: string, locale: string) {
  return fetchPublicJson<PostDetail>(`/public/posts/${encodeURIComponent(slug)}`, locale);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const post = await loadPost(slug, locale);
  if (!post) {
    const t = await getTranslations({ locale, namespace: "blog" });
    return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), locale, path: `/blog/${slug}`, index: false });
  }
  const description = (post.excerpt || post.body.replace(/[#*_`>\-]+/g, " ")).replace(/\s+/g, " ").trim().slice(0, 160);
  return pageMetadata({ title: post.title, description, locale, path: `/blog/${slug}`, image: post.cover?.url ?? undefined });
}

export default async function BlogPostPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const post = await loadPost(slug, locale);
  if (!post) notFound();
  const t = await getTranslations({ locale, namespace: "blog" });
  const date = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "long" }).format(new Date(post.published_at));

  return (
    <article className="mx-auto w-full max-w-[760px] px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/blog" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <ChevronLeft size={14} /> {t("back")}
      </Link>
      <p className="mt-5 text-[12.5px] text-muted">
        <Link href={`/blog?category=${post.category}`} className="font-medium text-iris-hi hover:underline">{t(`categories.${post.category}`)}</Link>
        {" · "}<time dateTime={post.published_at}>{date}</time>
      </p>
      <h1 className="mt-2 font-serif text-[30px] font-semibold leading-tight tracking-tight sm:text-[36px]">{post.title}</h1>
      {post.excerpt && <p className="mt-3 text-[16px] leading-relaxed text-muted">{post.excerpt}</p>}
      {post.cover && (
        <MediaImage image={post.cover} alt="" className="mt-6 aspect-[1.91] w-full rounded-card border border-line object-cover" />
      )}
      <MarkdownContent className="mt-8 text-[15px] leading-relaxed [&_h2]:scroll-mt-24 [&_h3]:scroll-mt-24">{post.body}</MarkdownContent>
      <aside className="mt-10 rounded-card border border-line bg-surface p-5">
        <p className="text-[14px] font-medium">{t("helpTitle")}</p>
        <p className="mt-1 text-[13px] text-muted">{t("helpBody")}</p>
        <Link href="/support" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-iris-hi hover:underline">
          {t("helpCenter")} <ArrowRight size={13} />
        </Link>
      </aside>
    </article>
  );
}
