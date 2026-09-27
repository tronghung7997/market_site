import { Link } from "@/i18n/navigation";
import { MediaImage } from "@/components/media/MediaImage";
import type { PostSummary } from "@/lib/types";

/** One post in the blog list: cover, category, title, excerpt, date. */
export function PostCard({ post, categoryLabel, date }: { post: PostSummary; categoryLabel: string; date: string }) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface">
      <Link href={`/blog/${post.slug}`} className="block aspect-[1.91] overflow-hidden bg-raised" tabIndex={-1} aria-hidden>
        {post.cover ? (
          <MediaImage image={post.cover} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
        ) : (
          <span className="grid h-full place-items-center font-serif text-[40px] text-line-2">GMMO</span>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-[12px] text-muted">{categoryLabel} · <time dateTime={post.published_at}>{date}</time></p>
        <h2 className="mt-1 font-serif text-[18px] font-semibold leading-snug tracking-tight">
          <Link href={`/blog/${post.slug}`} className="hover:underline">{post.title}</Link>
        </h2>
        {post.excerpt && <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-muted">{post.excerpt}</p>}
      </div>
    </article>
  );
}
