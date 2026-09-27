import { Link } from "@/i18n/navigation";
import { MediaImage } from "@/components/media/MediaImage";
import type { PostSummary } from "@/lib/types";
import { blogPostHref } from "../model";

/** The newest post at the top of the blog list: full-width cover (when there
 *  is one — it is the page's LCP), larger title and the whole excerpt. */
export function FeaturedPost({ post, categoryLabel, date }: { post: PostSummary; categoryLabel: string; date: string }) {
  const href = blogPostHref(post.slug);
  return (
    <article className="group pb-8">
      {post.cover && (
        <Link href={href} tabIndex={-1} aria-hidden className="mb-5 block overflow-hidden rounded-card border border-line bg-raised">
          <MediaImage image={post.cover} variant="full" priority alt="" className="aspect-[1.91] w-full transition-transform duration-300 group-hover:scale-[1.01]" />
        </Link>
      )}
      <p className="text-[12.5px] text-muted">
        {categoryLabel} · <time dateTime={post.published_at}>{date}</time>
      </p>
      <h2 className="mt-2 font-serif text-[26px] font-semibold leading-tight tracking-tight sm:text-[32px]">
        <Link href={href} className="rounded-sm decoration-line-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iris">
          {post.title}
        </Link>
      </h2>
      {post.excerpt && <p className="mt-3 text-[16px] leading-relaxed text-muted sm:text-[17px]">{post.excerpt}</p>}
    </article>
  );
}
