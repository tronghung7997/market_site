"use client";

/** "Danh mục" on the home page. One card per top-level category with its
 *  sub-categories as pills, so the tree reads at a glance and ten or thirty
 *  categories take the same two rows; the rest is a link to /categories. */

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import type { Category } from "@/lib/types";
import { categoryPath } from "@/lib/routes";
import { categoryCoverId } from "@/lib/product-covers";
import { ProductCover } from "@/components/products/ProductCover";
import { ArrowRight } from "@/components/Icons";
import { SectionHead } from "./SectionHead";

const MAX_PARENTS = 6;

export function CategoriesSection({ cats, countFor, onBrowse }: {
  cats: Category[];
  countFor: (id: number) => number | null;
  /** Filter the shelf below instead of leaving the page. */
  onBrowse: (id: number) => void;
}) {
  const t = useTranslations("home");
  const common = useTranslations("common");
  const parents = cats.filter((c) => (countFor(c.id) ?? 1) > 0);
  if (parents.length === 0) return null;
  const shown = parents.slice(0, MAX_PARENTS);
  const hidden = parents.length - shown.length;

  return (
    <section className="w-full mx-auto max-w-[1200px] px-6 py-6 lg:py-8">
      <div className="flex items-end justify-between gap-4">
        <SectionHead title={t("categories")} sub={t("categoriesSub")} />
        <Link href="/categories" className="mb-4 hidden items-center gap-1 text-[13px] font-medium text-iris hover:text-iris-hi sm:inline-flex">
          {t("allCategoriesLink", { count: parents.length })} <ArrowRight size={14} />
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => {
          const count = countFor(c.id);
          const children = (c.children ?? []).filter((child) => (countFor(child.id) ?? 1) > 0);
          return (
            <div key={c.id} className="group rounded-xl border border-line bg-surface p-4 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-card-lg">
              <div className="flex items-center gap-3">
                <ProductCover coverId={categoryCoverId(c)} title={c.name} className="h-10 w-10 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <Link href={categoryPath(c)} className="block truncate text-[15px] font-medium text-fg hover:text-iris">{c.name}</Link>
                  {count != null && <div className="text-[12px] text-muted">{common("products", { count })}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => onBrowse(c.id)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-iris-soft hover:text-iris"
                  aria-label={t("browseCategory", { name: c.name })}
                  title={t("browseCategory", { name: c.name })}
                >
                  <ArrowRight size={15} />
                </button>
              </div>
              {children.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                  {children.map((child) => {
                    const childCount = countFor(child.id);
                    return (
                      <Link key={child.id} href={categoryPath(child)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-raised/50 px-2.5 text-[12px] text-muted transition-colors hover:border-iris/40 hover:bg-iris-soft hover:text-iris-hi">
                        <ProductCover coverId={categoryCoverId(child)} title={child.name} className="h-3.5 w-3.5 rounded-sm" />
                        {child.name}
                        {childCount != null && <span className="font-mono text-[10.5px] text-faint">{childCount}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {hidden > 0 && (
        <div className="mt-4 text-center">
          <Link href="/categories" className="inline-flex items-center gap-1 text-[13px] font-medium text-iris hover:text-iris-hi">
            {t("moreCategories", { count: hidden })} <ArrowRight size={14} />
          </Link>
        </div>
      )}
    </section>
  );
}
