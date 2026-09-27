import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { MarkdownHeading } from "@/lib/heading-slug";
import type { SitePageLink } from "@/lib/types";
import { TableOfContents } from "@/components/patterns/TableOfContents";

/* Cột trái trang chính sách: danh sách trang + mục lục của trang đang xem
   (mục lục có scroll-spy, chỉ hiện từ lg). */
export function LegalSidebar({
  pages, current, headings, labels,
}: {
  pages: SitePageLink[];
  current: string;
  headings: MarkdownHeading[];
  labels: { pages: string; onThisPage: string };
}) {
  return (
    <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto space-y-6 text-[13px]">
      <nav aria-label={labels.pages}>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{labels.pages}</div>
        <ul className="space-y-0.5">
          {pages.map((p) => {
            const isCurrent = p.slug === current;
            return (
              <li key={p.slug}>
                <Link
                  href={`/legal/${p.slug}`}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-2.5 py-1.5 transition-colors",
                    isCurrent ? "bg-iris-soft font-medium text-iris-hi" : "text-muted hover:bg-raised hover:text-fg",
                  )}
                >
                  {p.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <TableOfContents headings={headings} label={labels.onThisPage} className="hidden lg:block" />
    </div>
  );
}
