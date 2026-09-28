import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { PostSummary } from "@/lib/types";
import { blogPostHref } from "../model";

/** Other posts of the same category, compact enough for the post page's
 *  240px right column: title and date, no excerpt or cover. */
export function RelatedPostList({ items, label, className }: {
  items: { post: PostSummary; date: string }[];
  label: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className={cn("text-[13px]", className)}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <ul className="space-y-0.5">
        {items.map(({ post, date }) => (
          <li key={post.slug}>
            <Link href={blogPostHref(post.slug)} className="group block rounded-md px-2.5 py-2 transition-colors hover:bg-raised">
              <span className="line-clamp-2 font-medium leading-snug text-fg group-hover:text-iris-hi">{post.title}</span>
              <time dateTime={post.published_at} className="mt-0.5 block text-[12px] text-muted">{date}</time>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
