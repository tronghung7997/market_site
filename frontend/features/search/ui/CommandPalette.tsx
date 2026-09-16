"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { categoryPath, productPath, sellerPath } from "@/lib/routes";
import { categoryCoverId } from "@/lib/product-covers";
import type { Category, SearchCategoryHit, SearchProductHit, SellerSummary } from "@/lib/types";
import * as Icons from "@/components/Icons";
import { Monogram } from "@/components/ui";
import { ProductCover } from "@/features/product-covers";
import { visibleActions, type QuickAction } from "../actions";
import {
  SEARCH_SCOPE_PREFIX,
  foldText,
  matchesLabel,
  parseCommand,
  pushRecentSearch,
  removeRecentSearch,
  sanitizeRecentSearches,
  searchPageHref,
  type SearchScope,
} from "../model";
import { useCategoryTree, useSearchSuggest } from "../data/useSearchSuggest";

const RECENT_STORAGE_KEY = "gmmo.recent-searches";
const MAX_ACTIONS_IN_MIXED_MODE = 3;
const MAX_BROWSE_CATEGORIES = 8;

type PaletteGroup = "goto" | "recent" | "actions" | "browse" | "categories" | "products" | "sellers" | "seeAll";

type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  sublabel?: string | null;
  trailing?: ReactNode;
  leading: ReactNode;
  href?: string;
  /** Runs instead of navigating (locale switch, sign out, recent-search fill-in). */
  run?: () => void;
  /** Term to remember in "recent searches" when this item is chosen. */
  remember?: string;
  /** Secondary control rendered at the trailing edge (remove recent). */
  aside?: ReactNode;
};

function readRecent(): string[] {
  try {
    return sanitizeRecentSearches(JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function writeRecent(list: string[]): void {
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Private mode / quota: recents are a convenience, never required.
  }
}

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-raised px-1 font-mono text-[10.5px] font-medium text-faint",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

function IconBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "iris" }) {
  return (
    <span
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg border",
        tone === "iris" ? "border-iris/20 bg-iris-soft text-iris" : "border-line bg-raised text-muted",
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("search");
  const ts = useTranslations("sellers");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { account, logout } = useAuth();
  const { formatBrowseMoney } = useMoney();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const [scope, setScope] = useState<SearchScope>("all");
  const [text, setText] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);

  const parsed = useMemo(() => parseCommand(text), [text]);
  const term = parsed.term;
  const remoteScope = scope === "all" || scope === "categories" || scope === "sellers";
  const suggest = useSearchSuggest(term, open && remoteScope && term.length > 0);
  const tree = useCategoryTree(open && term.length === 0 && (scope === "all" || scope === "categories"));

  // Reset per open; recents come from this device only.
  useEffect(() => {
    if (!open) return;
    setScope("all");
    setText("");
    setHighlight(0);
    setRecent(readRecent());
  }, [open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const remember = useCallback((value: string) => {
    setRecent((list) => {
      const next = pushRecentSearch(list, value);
      writeRecent(next);
      return next;
    });
  }, []);

  const forget = useCallback((value: string) => {
    setRecent((list) => {
      const next = removeRecentSearch(list, value);
      writeRecent(next);
      return next;
    });
  }, []);

  const switchLocale = useCallback(() => {
    const next = locale === "vi" ? "en" : "vi";
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;SameSite=Lax`;
    router.replace(pathname, { locale: next });
  }, [locale, pathname, router]);

  const actionItem = useCallback(
    (action: QuickAction): PaletteItem => {
      const Icon = Icons[action.icon];
      const base = {
        id: `action:${action.id}`,
        group: "actions" as const,
        label: t(`actions.${action.labelKey}`),
        leading: <IconBadge><Icon size={16} /></IconBadge>,
      };
      if (action.kind === "switchLocale") return { ...base, run: switchLocale };
      if (action.kind === "signOut") return { ...base, run: () => logout() };
      return { ...base, href: action.href };
    },
    [logout, switchLocale, t],
  );

  const productItem = useCallback(
    (hit: SearchProductHit): PaletteItem => ({
      id: `product:${hit.public_key}`,
      group: "products",
      label: hit.title,
      sublabel: [hit.category_name, hit.seller_name].filter(Boolean).join(" · "),
      leading: <ProductCover coverId={hit.cover_id} title={hit.title} className="h-9 w-9 shrink-0 rounded-lg" />,
      trailing: hit.price_from != null ? (
        <span className="font-mono text-[12.5px] font-medium tabular text-fg">{formatBrowseMoney(hit.price_from, { locale })}</span>
      ) : null,
      href: productPath(hit),
      remember: term,
    }),
    [formatBrowseMoney, locale, term],
  );

  const categoryItem = useCallback(
    (hit: SearchCategoryHit | Category, group: "categories" | "browse"): PaletteItem => ({
      id: `${group}:${hit.id}`,
      group,
      label: hit.name,
      sublabel: "parent_name" in hit && hit.parent_name ? hit.parent_name : null,
      leading: <ProductCover coverId={categoryCoverId(hit)} title={hit.name} className="h-9 w-9 shrink-0 rounded-lg" />,
      href: categoryPath(hit),
      remember: group === "categories" ? term : undefined,
    }),
    [term],
  );

  const sellerItem = useCallback(
    (seller: SellerSummary): PaletteItem => ({
      id: `seller:${seller.public_key}`,
      group: "sellers",
      label: seller.display_name,
      sublabel: [
        t("orderCount", { count: seller.completed_order_count }),
        seller.review_count > 0 ? t("reviewCount", { count: seller.review_count }) : null,
        ts(`tier_${seller.seller_tier}` as "tier_new"),
      ].filter(Boolean).join(" · "),
      leading: <Monogram text={seller.display_name} />,
      href: sellerPath(seller),
      remember: term,
    }),
    [t, term, ts],
  );

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    const actions = visibleActions(account ? { roles: account.roles } : null);
    const data = suggest.data;

    if (scope === "actions") {
      actions.filter((a) => matchesLabel(term, t(`actions.${a.labelKey}`), a.keywords)).forEach((a) => out.push(actionItem(a)));
      return out;
    }

    if (!term) {
      if (scope === "all") {
        recent.forEach((value) =>
          out.push({
            id: `recent:${foldText(value)}`,
            group: "recent",
            label: value,
            leading: <IconBadge><Icons.Clock size={16} /></IconBadge>,
            run: () => setText(value),
            aside: (
              <button
                type="button"
                aria-label={t("removeRecent", { q: value })}
                onClick={(event) => { event.stopPropagation(); forget(value); }}
                className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-raised hover:text-fg"
              >
                <Icons.X size={13} />
              </button>
            ),
          }),
        );
        actions.slice(0, 6).forEach((a) => out.push(actionItem(a)));
      }
      (tree.data ?? []).slice(0, MAX_BROWSE_CATEGORIES).forEach((c) => out.push(categoryItem(c, "browse")));
      return out;
    }

    if (parsed.direct) {
      out.push({
        id: `goto:${parsed.direct.href}`,
        group: "goto",
        label: parsed.direct.kind === "order"
          ? t("openOrder", { code: parsed.direct.code })
          : t("openPath", { path: parsed.direct.href }),
        leading: <IconBadge tone="iris">{parsed.direct.kind === "order" ? <Icons.Package size={16} /> : <Icons.ExternalLink size={16} />}</IconBadge>,
        href: parsed.direct.href,
      });
    }
    if (data) {
      if (scope === "all") data.products.forEach((p) => out.push(productItem(p)));
      if (scope !== "sellers") data.categories.forEach((c) => out.push(categoryItem(c, "categories")));
      if (scope !== "categories") data.sellers.forEach((s) => out.push(sellerItem(s)));
    }
    if (scope === "all") {
      actions
        .filter((a) => matchesLabel(term, t(`actions.${a.labelKey}`), a.keywords))
        .slice(0, MAX_ACTIONS_IN_MIXED_MODE)
        .forEach((a) => out.push(actionItem(a)));
      out.push({
        id: "see-all",
        group: "seeAll",
        label: t("seeAll", { q: term }),
        sublabel: t("seeAllHint"),
        leading: <IconBadge tone="iris"><Icons.Search size={16} /></IconBadge>,
        href: searchPageHref({ q: term }),
        remember: term,
      });
    }
    return out;
  }, [account, actionItem, categoryItem, forget, parsed.direct, productItem, recent, scope, sellerItem, suggest.data, t, term, tree.data]);

  // Keep the highlight on a real row whenever the list changes shape.
  const itemsKey = items.map((item) => item.id).join("|");
  useEffect(() => { setHighlight(0); }, [itemsKey]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
    const item = items[highlight];
    if (item?.href) router.prefetch(item.href);
  }, [highlight, items, router]);

  const activate = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) {
        if (term && scope === "all") {
          remember(term);
          close();
          router.push(searchPageHref({ q: term }));
        }
        return;
      }
      if (item.remember) remember(item.remember);
      if (item.run) {
        item.run();
        if (item.group !== "recent") close();
        return;
      }
      if (item.href) {
        close();
        router.push(item.href);
      }
    },
    [close, remember, router, scope, term],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlight((i) => (items.length ? (i + 1) % items.length : 0));
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlight((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
        break;
      case "Home":
        if (items.length) { event.preventDefault(); setHighlight(0); }
        break;
      case "End":
        if (items.length) { event.preventDefault(); setHighlight(items.length - 1); }
        break;
      case "Enter":
        event.preventDefault();
        activate(items[highlight]);
        break;
      case "Backspace":
        if (text === "" && scope !== "all") {
          event.preventDefault();
          setScope("all");
        }
        break;
    }
  };

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (scope === "all") {
      const first = value.charAt(0);
      const nextScope = (Object.keys(SEARCH_SCOPE_PREFIX) as Array<Exclude<SearchScope, "all">>)
        .find((key) => SEARCH_SCOPE_PREFIX[key] === first);
      if (nextScope) {
        setScope(nextScope);
        setText(value.slice(1));
        return;
      }
    }
    setText(value);
  };

  const placeholder = scope === "categories"
    ? t("inputPlaceholderCategories")
    : scope === "sellers"
      ? t("inputPlaceholderSellers")
      : scope === "actions"
        ? t("inputPlaceholderActions")
        : t("inputPlaceholder");

  const scopeLabel = scope === "categories" ? t("modeCategories") : scope === "sellers" ? t("modeSellers") : scope === "actions" ? t("modeActions") : null;

  const fetching = term.length > 0 && remoteScope && (suggest.isFetching || suggest.isStale);
  const hasHits = items.some((i) => i.group === "products" || i.group === "categories" || i.group === "sellers" || i.group === "goto" || i.group === "actions");
  const showEmpty = term.length > 0 && !hasHits && (remoteScope ? Boolean(suggest.data) && !fetching && !suggest.isError : true);

  const groupTitle: Record<PaletteGroup, string> = {
    goto: t("groupGoTo"),
    recent: t("groupRecent"),
    actions: t("groupActions"),
    browse: t("groupBrowse"),
    categories: t("groupCategories"),
    products: t("groupProducts"),
    sellers: t("groupSellers"),
    seeAll: "",
  };

  let lastGroup: PaletteGroup | null = null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-panel/45 backdrop-blur-[2px] animate-fade-in" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
          className={cn(
            "fixed inset-x-0 top-0 z-50 mx-auto flex h-dvh w-full flex-col bg-surface outline-none",
            "sm:top-[10vh] sm:h-auto sm:max-h-[min(72vh,640px)] sm:max-w-2xl sm:rounded-xl sm:border sm:border-line sm:shadow-card-lg",
            "animate-pop",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{t("dialogTitle")}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{t("dialogDescription")}</DialogPrimitive.Description>

          {/* Input row */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
            <span className="text-faint" aria-hidden>
              {fetching
                ? <span className="block h-4 w-4 rounded-full border-2 border-line-2 border-t-iris animate-spin" />
                : <Icons.Search size={18} />}
            </span>
            {scopeLabel && (
              <button
                type="button"
                onClick={() => { setScope("all"); inputRef.current?.focus(); }}
                aria-label={t("clearMode")}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-iris/20 bg-iris-soft px-2 text-[12px] font-medium text-iris hover:bg-iris/10"
              >
                {scopeLabel}
                <Icons.X size={12} />
              </button>
            )}
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-activedescendant={items[highlight] ? `${listboxId}-${highlight}` : undefined}
              aria-autocomplete="list"
              aria-label={t("dialogTitle")}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              value={text}
              onChange={onChange}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              maxLength={80}
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint"
            />
            <Kbd className="hidden sm:inline-flex">esc</Kbd>
            <DialogPrimitive.Close
              aria-label={t("hintClose")}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg sm:hidden"
            >
              <Icons.X size={18} />
            </DialogPrimitive.Close>
          </div>

          {/* Results */}
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={t("dialogTitle")}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
          >
            {suggest.isError && term.length > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-bad/20 bg-bad-soft px-3 py-2.5 text-[13px] text-bad">
                <span>{t("error")}</span>
                <button type="button" onClick={() => suggest.refetch()} className="font-medium underline-offset-2 hover:underline">{t("retry")}</button>
              </div>
            )}
            {term.length > 0 && suggest.isLoading && remoteScope && (
              <div className="space-y-1 px-1 py-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
                    <div className="h-9 w-9 rounded-lg bg-raised animate-pulse" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-2/5 rounded bg-raised animate-pulse" />
                      <div className="h-2.5 w-1/4 rounded bg-raised animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showEmpty && (
              <div className="px-3 py-6 text-center">
                <p className="text-[13.5px] font-medium text-fg">{t("noResults", { q: term })}</p>
                <p className="mt-1 text-[12.5px] text-muted">{t("noResultsHint")}</p>
              </div>
            )}
            {items.map((item, index) => {
              const heading = item.group !== lastGroup && item.group !== "seeAll" ? groupTitle[item.group] : null;
              lastGroup = item.group;
              const active = index === highlight;
              const isSeeAll = item.group === "seeAll";
              return (
                <div key={item.id} role="presentation">
                  {heading && (
                    <div className="px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint first:pt-1">
                      {heading}
                    </div>
                  )}
                  {isSeeAll && index > 0 && <div className="my-2 h-px bg-line" role="presentation" />}
                  <div
                    id={`${listboxId}-${index}`}
                    role="option"
                    aria-selected={active}
                    data-index={index}
                    onMouseMove={() => { if (highlight !== index) setHighlight(index); }}
                    onClick={() => activate(item)}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-150",
                      active ? "bg-iris-soft" : "hover:bg-raised",
                    )}
                  >
                    {item.leading}
                    <div className="min-w-0 flex-1">
                      <div className={cn("truncate text-[13.5px] font-medium", active ? "text-iris-hi" : "text-fg")}>{item.label}</div>
                      {item.sublabel && <div className="truncate text-[12px] text-muted">{item.sublabel}</div>}
                    </div>
                    {item.trailing}
                    {item.aside}
                    {active && !item.aside && (
                      <Kbd className="hidden sm:inline-flex"><Icons.CornerDownLeft size={11} /></Kbd>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer hints */}
          <div className="hidden shrink-0 items-center gap-4 border-t border-line px-4 py-2 text-[11.5px] text-faint sm:flex">
            <span className="inline-flex items-center gap-1.5"><Kbd><Icons.ArrowUp size={11} /></Kbd><Kbd><Icons.ArrowDown size={11} /></Kbd>{t("hintNavigate")}</span>
            <span className="inline-flex items-center gap-1.5"><Kbd><Icons.CornerDownLeft size={11} /></Kbd>{t("hintOpen")}</span>
            <span className="inline-flex items-center gap-1.5"><Kbd>esc</Kbd>{t("hintClose")}</span>
            <span className="ml-auto font-mono text-[11px]">{t("hintFilters")}</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
