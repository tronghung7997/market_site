import type { PostCategory, PostDetail } from "@/lib/types";

export const POST_CATEGORIES = ["guide", "news"] as const satisfies readonly PostCategory[];

/** Syllables (vi) / words (en) read per minute — one rate for both locales. */
const WORDS_PER_MINUTE = 230;

/** "x phút đọc" of a markdown body: code blocks, link targets and markdown
 *  punctuation do not count as words. Never less than one minute. */
export function readingMinutes(markdown: string): number {
  const words = markdown
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** The admin re-saved the post a day or more after publishing — worth an
 *  "Updated …" next to the publish date. Same-day typo fixes are not. */
export function isMeaningfulUpdate(publishedAt: string, updatedAt: string): boolean {
  return new Date(updatedAt).getTime() - new Date(publishedAt).getTime() >= 24 * 60 * 60 * 1000;
}

export function readPostCategory(value: string | string[] | undefined): PostCategory | null {
  return typeof value === "string" && (POST_CATEGORIES as readonly string[]).includes(value) ? (value as PostCategory) : null;
}

/** Locale-less blog list URL; page 1 and "all" stay off the query string so
 *  every list view has exactly one canonical spelling. */
export function blogListHref({ category, page }: { category: PostCategory | null; page: number }): string {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/blog?${qs}` : "/blog";
}

export function blogPostHref(slug: string): string {
  return `/blog/${slug}`;
}

/**
 * schema.org BlogPosting + BreadcrumbList for one post, as one @graph.
 * URLs are absolute (built from `origin`); the author and publisher are the
 * marketplace itself — posts are written by the GMMO team, not a named person.
 */
export function postJsonLd({ post, origin, url, siteName, homeUrl, blogUrl, blogName, section }: {
  post: Pick<PostDetail, "title" | "excerpt" | "cover" | "published_at" | "updated_at">;
  origin: string;
  url: string;
  siteName: string;
  homeUrl: string;
  blogUrl: string;
  blogName: string;
  section: string;
}) {
  const organization = { "@type": "Organization", name: siteName, url: origin };
  const image = post.cover?.url ? new URL(post.cover.url, origin).toString() : undefined;
  const article = {
    "@type": "BlogPosting",
    headline: post.title,
    ...(post.excerpt ? { description: post.excerpt } : {}),
    ...(image ? { image: [image] } : {}),
    datePublished: post.published_at,
    dateModified: post.updated_at,
    articleSection: section,
    url,
    mainEntityOfPage: url,
    author: organization,
    publisher: organization,
  };
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: siteName, item: homeUrl },
      { "@type": "ListItem", position: 2, name: blogName, item: blogUrl },
      { "@type": "ListItem", position: 3, name: post.title, item: url },
    ],
  };
  const graph: [typeof article, typeof breadcrumb] = [article, breadcrumb];
  return { "@context": "https://schema.org", "@graph": graph };
}
