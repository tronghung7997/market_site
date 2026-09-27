import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { PostCategory } from "@/lib/types";
import { POST_CATEGORIES, blogListHref } from "../model";

/** Category filter of the blog list: a row of chips above the list on small
 *  screens, a vertical list in the right column from lg. */
export function BlogCategoryNav({ current, label, names, variant, className }: {
  current: PostCategory | null;
  label: string;
  names: Record<PostCategory | "all", string>;
  variant: "chips" | "list";
  className?: string;
}) {
  const items = [null, ...POST_CATEGORIES] as const;
  if (variant === "chips") {
    return (
      <nav aria-label={label} className={cn("flex gap-1.5 overflow-x-auto pb-1", className)}>
        {items.map((c) => (
          <Link
            key={c ?? "all"}
            href={blogListHref({ category: c, page: 1 })}
            aria-current={current === c ? "page" : undefined}
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-lg border px-3 text-[13px] font-medium",
              current === c ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:text-fg",
            )}
          >
            {names[c ?? "all"]}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav aria-label={label} className={cn("text-[13px]", className)}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <ul className="space-y-0.5">
        {items.map((c) => (
          <li key={c ?? "all"}>
            <Link
              href={blogListHref({ category: c, page: 1 })}
              aria-current={current === c ? "page" : undefined}
              className={cn(
                "block rounded-md px-2.5 py-1.5 transition-colors",
                current === c ? "bg-iris-soft font-medium text-iris-hi" : "text-muted hover:bg-raised hover:text-fg",
              )}
            >
              {names[c ?? "all"]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
