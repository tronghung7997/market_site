import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui";
import { ArrowRight, Search } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import { fetchPublicJson } from "@/lib/seo";
import { categoryPath } from "@/lib/routes";
import type { Category } from "@/lib/types";

/** 404 for an unknown category slug (raised by `[slug]/layout.tsx`): says
 *  so plainly and offers the categories that do exist, not an empty card. */
export default async function CategoryNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "categories" });
  const tree = await fetchPublicJson<Category[]>("/categories", locale);
  const topCats = (tree ?? []).filter((c) => c.parent_id == null);

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-12 sm:px-6 sm:py-16">
      <Card className="p-6 sm:p-8">
        <p className="text-[12px] font-medium uppercase tracking-wider text-faint">404</p>
        <h1 className="mt-2 font-serif text-[26px] font-semibold tracking-tight">{t("notFound")}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">{t("notFoundHint")}</p>
        {topCats.length > 0 && (
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {topCats.map((c) => (
              <li key={c.id}>
                <Link
                  href={categoryPath(c)}
                  className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13.5px] font-medium text-fg transition-colors hover:border-line-2 hover:bg-raised"
                >
                  <ProductCover coverId={categoryCoverId(c)} image={c.image} title={c.name} className="h-6 w-6 rounded-md border-0" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <ArrowRight size={13} className="text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] font-medium">
          <Link href="/categories" className="text-iris-hi hover:underline">{t("backToAll")}</Link>
          <Link href="/search" className="inline-flex items-center gap-1.5 text-muted hover:text-fg">
            <Search size={13} /> {t("searchEverywhere")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
