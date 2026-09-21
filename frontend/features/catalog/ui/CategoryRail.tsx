"use client";

/** Category navigation for the catalog explorer: a sticky tree on desktop,
 *  a scrollable chip row on mobile. One component for the hub ("all") and
 *  every category page, so the user never loses their place in the tree. */

import { Link } from "@/i18n/navigation";
import { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { Category } from "@/lib/types";
import { categoryPath } from "@/lib/routes";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import { ChevronRight, Layers } from "@/components/Icons";

export type CategoryRailTotals = Record<number, { total: number; price_from: number | null }>;

/** Show every branch expanded while the tree is small; larger trees only
 *  expand the branch the user is in. */
const EXPAND_ALL_LIMIT = 14;

export function CategoryRail({
  cats,
  totals,
  activeId,
  allTotal,
}: {
  cats: Category[];
  totals: CategoryRailTotals;
  /** Id of the category page being viewed (top-level or child); null on the hub. */
  activeId: number | null;
  allTotal: number;
}) {
  const t = useTranslations("categories");
  const topCats = cats.filter((c) => c.parent_id == null);
  const rowCount = topCats.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0);
  const expandAll = rowCount <= EXPAND_ALL_LIMIT;
  const activeTop = topCats.find((c) => c.id === activeId || (c.children ?? []).some((s) => s.id === activeId)) ?? null;

  return (
    <>
      {/* Desktop: tree */}
      <nav aria-label={t("railLabel")} className="hidden lg:block">
        <ul className="space-y-0.5">
          <li>
            <RailRow href="/categories" active={activeId === null} count={allTotal}>
              <span className="grid h-6 w-6 place-items-center rounded-md border border-line bg-raised text-muted" aria-hidden="true">
                <Layers size={13} />
              </span>
              <span className="truncate font-medium">{t("allProducts")}</span>
            </RailRow>
          </li>
          {topCats.map((c) => {
            const isActive = c.id === activeId;
            const isOpen = expandAll || activeTop?.id === c.id;
            const children = c.children ?? [];
            const total = totals[c.id]?.total ?? 0;
            return (
              <li key={c.id}>
                <RailRow href={categoryPath(c)} active={isActive} count={total} muted={total === 0}>
                  <ProductCover coverId={categoryCoverId(c)} title={c.name} className="h-6 w-6 rounded-md border-0" />
                  <span className="truncate font-medium">{c.name}</span>
                </RailRow>
                {isOpen && children.length > 0 && (
                  <ul className="mt-0.5 mb-1 ml-[15px] border-l border-line pl-3 space-y-0.5">
                    {children.map((sub) => (
                      <li key={sub.id}>
                        <RailRow href={categoryPath(sub)} active={sub.id === activeId} small>
                          <span className="truncate">{sub.name}</span>
                        </RailRow>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Mobile: chips, with the open branch's children on a second row */}
      <nav aria-label={t("railLabel")} className="lg:hidden -mx-4 px-4 space-y-2">
        <ul className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <li className="shrink-0">
            <Chip href="/categories" active={activeId === null}>
              {t("allProducts")}
              <ChipCount>{allTotal}</ChipCount>
            </Chip>
          </li>
          {topCats.map((c) => {
            const total = totals[c.id]?.total ?? 0;
            const isActive = c.id === activeId || activeTop?.id === c.id;
            return (
              <li key={c.id} className="shrink-0">
                <Chip href={categoryPath(c)} active={isActive}>
                  <ProductCover coverId={categoryCoverId(c)} title={c.name} className="h-5 w-5 rounded border-0" />
                  {c.name}
                  <ChipCount>{total}</ChipCount>
                </Chip>
              </li>
            );
          })}
        </ul>
        {activeTop && (activeTop.children?.length ?? 0) > 0 && (
          <ul className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <li className="shrink-0 text-[12px] text-faint pl-1 pr-0.5" aria-hidden="true">
              <ChevronRight size={12} />
            </li>
            <li className="shrink-0">
              <Chip href={categoryPath(activeTop)} active={activeTop.id === activeId} small>
                {t("allOf", { name: activeTop.name })}
              </Chip>
            </li>
            {(activeTop.children ?? []).map((sub) => (
              <li key={sub.id} className="shrink-0">
                <Chip href={categoryPath(sub)} active={sub.id === activeId} small>
                  {sub.name}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </>
  );
}

function RailRow({
  href,
  active,
  count,
  muted,
  small,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  muted?: boolean;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg pr-2 transition-colors",
        small ? "h-8 pl-2 text-[13px]" : "h-9 pl-2 text-[13.5px]",
        active
          ? "bg-iris-soft text-iris-hi"
          : muted
            ? "text-faint hover:bg-raised hover:text-muted"
            : "text-muted hover:bg-raised hover:text-fg",
      )}
    >
      {children}
      <span className="ml-auto inline-flex items-center gap-1.5">
        <LinkPending />
        {count != null && (
          <span className={cn("font-mono tabular text-[11.5px]", active ? "text-iris-hi" : "text-faint")}>
            {count}
          </span>
        )}
      </span>
    </Link>
  );
}

function Chip({
  href,
  active,
  small,
  children,
}: {
  href: string;
  active: boolean;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border font-medium whitespace-nowrap transition-colors",
        small ? "h-8 px-2.5 text-[12.5px]" : "h-9 px-3 text-[13px]",
        active ? "border-iris bg-iris text-white" : "border-line bg-surface text-muted hover:text-fg hover:border-line-2",
      )}
    >
      {children}
      <LinkPending />
    </Link>
  );
}

/** Rail feedback while the next category page is on its way: the old page
 *  stays on screen (no loading boundary on `[slug]`), so the clicked row is
 *  the only thing that has to say "working". */
function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      aria-label="…"
      className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}

function ChipCount({ children }: { children: React.ReactNode }) {
  return <span className="font-mono tabular text-[11px] opacity-80">{children}</span>;
}
