import { Link } from "@/i18n/navigation";
import { MediaImage } from "@/components/media/MediaImage";
import type { PostSummary } from "@/lib/types";
import { blogPostHref } from "../model";

/** One post as a reading-list row: meta, title, two-line excerpt and — only
 *  when the post has one — a cover thumbnail on the right. */
export function PostRow({ post, categoryLabel, date, headingLevel = 2 }: {
  post: PostSummary;
  categoryLabel: string;
  date: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const href = blogPostHref(post.slug);
  return (
    <article className="group flex items-start gap-5 py-6 sm:gap-8">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-muted">
          {categoryLabel} · <time dateTime={post.published_at}>{date}</time>
        </p>
        <Heading className="mt-1.5 font-serif text-[19px] font-semibold leading-snug tracking-tight sm:text-[22px]">
          <Link href={href} className="rounded-sm decoration-line-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iris">
            {post.title}
          </Link>
        </Heading>
        {post.excerpt && (
          <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-muted sm:text-[15px]">{post.excerpt}</p>
        )}
      </div>
      {post.cover && (
        <Link href={href} tabIndex={-1} aria-hidden className="mt-1 block w-[96px] shrink-0 overflow-hidden rounded-lg border border-line bg-raised sm:w-[160px]">
          <MediaImage image={post.cover} alt="" className="aspect-[1.91] w-full transition-transform duration-300 group-hover:scale-[1.02]" />
        </Link>
      )}
    </article>
  );
}
