import { Link } from "@/i18n/navigation";
import { ArrowRight } from "@/components/Icons";

/** "Still stuck?" pointer to the help center, at the end of a post and in the
 *  blog list's right column. */
export function BlogHelpCard({ title, body, linkLabel }: { title: string; body: string; linkLabel: string }) {
  return (
    <aside className="rounded-card border border-line bg-surface p-5">
      <p className="text-[14px] font-medium">{title}</p>
      <p className="mt-1 text-[13px] text-muted">{body}</p>
      <Link href="/support" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-iris-hi hover:underline">
        {linkLabel} <ArrowRight size={13} />
      </Link>
    </aside>
  );
}
