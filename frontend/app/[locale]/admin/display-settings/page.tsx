"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { MailSettingsPanel } from "@/features/admin-mail";
import { SellerConfigPanel } from "@/features/admin-seller-config";
import { AffiliateSettingsPanel, AnalyticsSettingsPanel, AuthSettingsPanel, ContentFilterPanel, DepositRailsPanel, DisplaySettingsPanel } from "@/features/admin-site-settings";
import { SearchSettingsPanel } from "@/features/admin-search";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui";

const TABS = ["display", "accounts", "deposits", "mail", "seller", "affiliate", "contentFilter", "search", "analytics"] as const;
type SettingsTab = (typeof TABS)[number];

const PANELS: Record<SettingsTab, () => React.JSX.Element> = {
  display: DisplaySettingsPanel,
  accounts: AuthSettingsPanel,
  deposits: DepositRailsPanel,
  mail: MailSettingsPanel,
  seller: SellerConfigPanel,
  affiliate: AffiliateSettingsPanel,
  contentFilter: ContentFilterPanel,
  search: SearchSettingsPanel,
  analytics: AnalyticsSettingsPanel,
};

function parseTab(raw: string | null): SettingsTab {
  return (TABS as readonly string[]).includes(raw ?? "") ? (raw as SettingsTab) : "display";
}

function AdminSettingsTabs() {
  const t = useTranslations("adminSettings");
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const [visited, setVisited] = useState<Set<SettingsTab>>(() => new Set([tab]));
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const previous = useRef(tab);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);

  // replaceState keeps this a pure client-side switch: no RSC round-trip, no Suspense flash.
  const setTab = (next: SettingsTab) => {
    if (next === tab) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "display") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  };

  useEffect(() => {
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);

  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    const list = listRef.current;
    if (!el || !list) return;
    const measure = () => setIndicator({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(list);
    return () => ro.disconnect();
  }, [tab]);

  useEffect(() => {
    if (previous.current === tab) return;
    previous.current = tab;
    const el = panelRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
      { duration: 180, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
    );
  }, [tab]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length]
      : e.key === "ArrowLeft" ? TABS[(i - 1 + TABS.length) % TABS.length]
        : e.key === "Home" ? TABS[0]
          : e.key === "End" ? TABS[TABS.length - 1]
            : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="w-full space-y-4 pb-5">
      <div className="border-b border-line">
        <div
          ref={listRef}
          role="tablist"
          aria-label={t("tabsLabel")}
          onKeyDown={onKeyDown}
          className="relative -mb-px flex gap-1 overflow-x-auto"
        >
          {TABS.map((id) => {
            const active = tab === id;
            return (
              <button
                key={id}
                ref={(node) => { tabRefs.current[id] = node; }}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                aria-selected={active}
                aria-controls={`settings-panel-${id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(id)}
                className={cn(
                  "relative h-10 shrink-0 whitespace-nowrap rounded-t-md px-3 text-[13px] font-medium transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
                  active ? "text-fg" : "text-muted hover:text-fg",
                )}
              >
                {t(`tab.${id}`)}
              </button>
            );
          })}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-iris",
              "transition-[transform,width,opacity] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none",
              indicator ? "opacity-100" : "opacity-0",
            )}
            style={{ width: indicator?.w ?? 0, transform: `translateX(${indicator?.x ?? 0}px)` }}
          />
        </div>
      </div>

      <div ref={panelRef}>
        {TABS.filter((id) => visited.has(id)).map((id) => {
          const Panel = PANELS[id];
          return (
            <div
              key={id}
              role="tabpanel"
              id={`settings-panel-${id}`}
              aria-labelledby={`settings-tab-${id}`}
              hidden={id !== tab}
            >
              <Panel />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      }
    >
      <AdminSettingsTabs />
    </Suspense>
  );
}
