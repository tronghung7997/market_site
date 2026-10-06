"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { useWalletBalance } from "@/hooks/use-wallet";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
  ArrowLeftRight,
  Bolt,
  ChevronRight,
  Globe,
  Logo,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  Percent,
  Plus,
  Shield,
  Store,
  User,
  Wallet,
  X,
} from "./Icons";
import { AccountBell } from "@/features/notifications";
import { AnnouncementBar, useSiteStatus } from "@/features/site-status";
import MessageShortcut from "./chat/MessageShortcut";
import CurrencyToggle from "./CurrencyToggle";
import { Button } from "./ui";
import { HeaderSearch, SearchProvider } from "@/features/search";
import { MediaImage } from "@/components/media/MediaImage";

function LocaleSwitcher({
  locale,
  onChange,
  label,
  className,
}: {
  locale: string;
  onChange: (locale: "en" | "vi") => void;
  label: string;
  className?: string;
}) {
  const languages = [
    { code: "en" as const, shortLabel: "EN", label: "English" },
    { code: "vi" as const, shortLabel: "VI", label: "Tiếng Việt" },
  ];

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)} role="group" aria-label={label}>
      <span className="grid h-7 w-7 place-items-center rounded-md text-iris-hi" aria-hidden>
        <Globe size={15} />
      </span>
      <span className="inline-flex items-center rounded-lg border border-line bg-raised/75 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
        {languages.map((language) => {
          const active = locale === language.code;
          return (
            <button
              key={language.code}
              type="button"
              onClick={() => onChange(language.code)}
              aria-pressed={active}
              aria-label={language.label}
              title={language.label}
              className={cn(
                "min-w-9 rounded-md px-2 py-1.5 text-[11px] font-bold tracking-[0.12em]",
                "transition-[background-color,color,box-shadow] duration-200",
                active
                  ? "bg-iris text-white shadow-[0_1px_2px_rgba(67,56,202,0.32)]"
                  : "text-faint hover:bg-surface hover:text-fg"
              )}
            >
              {language.shortLabel}
            </button>
          );
        })}
      </span>
    </div>
  );
}

export default function TopNav() {
  return (
    <SearchProvider>
      <TopNavBar />
    </SearchProvider>
  );
}

function TopNavBar() {
  const { account, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("nav");
  const tc = useTranslations("currency");
  const languageLabel = t("language");
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  // Main pages, one row under the brand row. Append new sections here.
  // Guests asking for their orders go through sign-in and come back.
  const navLinks = [
    { href: "/", label: t("home") },
    { href: "/categories", label: t("categories") },
    { href: account ? "/orders" : "/login?next=%2Forders", label: t("orders"), match: "/orders" },
    { href: "/blog", label: t("blog") },
    { href: "/solutions", label: t("solutions") },
    { href: "/support", label: t("support") },
  ];
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const accountRoleLabel = account?.roles.includes("admin")
    ? t("admin")
    : account?.roles.includes("seller")
      ? t("sellerRole")
      : t("buyerRole");

  // Ordered by what people open most: the workspace they came for (shop /
  // console) on top, then the buyer activity they check daily, then the
  // occasional settings-type links. Only the workspace row carries a second
  // line; the wallet is reached through the balance row in the header card.
  const accountLinks: { href: string; label: string; desc?: string; icon: typeof Store; role?: string; auth?: boolean; hideIfRole?: string; group: string }[] = [
    { href: "/seller", label: t("seller"), desc: t("menuDesc.seller"), icon: Store, role: "seller", group: "workspace" },
    { href: "/admin", label: t("admin"), desc: t("menuDesc.admin"), icon: Shield, role: "admin", group: "workspace" },
    { href: "/orders", label: t("orders"), icon: Package, auth: true, group: "activity" },
    { href: "/proxies", label: t("proxies"), icon: Globe, auth: true, group: "activity" },
    { href: "/messages", label: t("messages"), icon: MessageCircle, auth: true, group: "activity" },
    { href: "/transactions", label: t("transactions"), icon: ArrowLeftRight, auth: true, group: "activity" },
    { href: "/account", label: t("account"), icon: User, auth: true, group: "settings" },
    { href: "/affiliate", label: t("affiliate"), icon: Percent, auth: true, group: "settings" },
    { href: "/sell", label: t("becomeSeller"), icon: Store, auth: true, hideIfRole: "seller", group: "settings" },
  ];
  // Số dư đọc từ query cache dùng chung với trang Ví — mua hàng/nạp/rút ở
  // bất kỳ đâu invalidate ["wallet"] là con số này tự nhảy, không cần đổi
  // trang như bản cũ (trước đây refetch theo pathname để chữa stale).
  const { data: wallet } = useWalletBalance(!!account);
  const { data: siteStatus } = useSiteStatus();
  const announcementLive = Boolean(siteStatus?.announcement);
  const balance = account ? wallet?.available_balance ?? null : null;
  const { formatBrowseMoney, allowLocaleToggle, allowToggle } = useMoney();
  const [menuOpen, setMenuOpen] = useState(false);
  // Same cache as the orders page; fetched once the menu is first opened.
  const orderStats = useQuery({
    queryKey: queryKeys.orderStats(account?.id),
    queryFn: api.orderStats,
    enabled: !!account && menuOpen,
    staleTime: 30_000,
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMenuOpen(false); setMobileNavOpen(false); }, [pathname]);

  // Click outside & Escape key listeners
  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileNavOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [mobileNavOpen]);

  const changeLocale = (nextLocale: "en" | "vi") => {
    document.cookie = `NEXT_LOCALE=${nextLocale};path=/;max-age=31536000;SameSite=Lax`;
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <>
      {/* Promo strip — yields to an admin announcement when one is live */}
      {!announcementLive && (
        <div className="hidden sm:block bg-iris-soft text-iris-hi text-[12.5px] border-b border-iris/10">
          <div className="mx-auto max-w-[1200px] px-6 h-8 flex items-center gap-2">
            <Bolt size={13} className="shrink-0" />
            <span className="truncate">{t("promo")}</span>
          </div>
        </div>
      )}

      {/* Nav — the announcement sticks together with it so it never scrolls away */}
      <div className="sticky top-0 z-40">
      <AnnouncementBar />
      <header className="bg-surface/85 backdrop-blur-md border-b border-line">
        {/* px/gap hẹp lại ở màn nhỏ: logo + nút Nạp tiền + avatar vốn đã sát mép,
            giữ nguyên px-6/gap-6 thì tràn vài px và kéo cả trang trôi ngang. */}
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 h-14 md:h-[60px] flex items-center gap-3 sm:gap-6">
          {/* Nút menu đứng ngoài cùng bên trái, trước logo: bên phải đã có ví +
              Nạp tiền + avatar, nhét thêm vào đó thì chật và nút menu nằm lọt giữa
              hai thứ không liên quan. */}
          <button onClick={() => setMobileNavOpen((v) => !v)} title={t("menu")} aria-label={t("menu")} aria-expanded={mobileNavOpen} aria-controls="mobile-nav"
            className="md:hidden grid place-items-center h-9 w-9 -ml-1 rounded-lg text-muted hover:text-fg hover:bg-raised transition-colors shrink-0">
            <Menu size={18} />
          </button>
          <Link href="/" aria-label="GMMO" className="shrink-0"><Logo /></Link>
          {/* Global search: a field-shaped trigger on md+, an icon below. The
              palette itself (⌘K) is mounted once by SearchProvider. */}
          <div className="flex min-w-0 flex-1 items-center justify-end md:justify-start lg:ml-2 md:[&>*]:w-full md:[&>*]:max-w-[400px] lg:[&>*]:max-w-[440px] xl:[&>*]:max-w-[480px]">
            <HeaderSearch />
          </div>
          {/* Language / currency live under Tài khoản › Hồ sơ once signed in;
              the header keeps them only for visitors who have nowhere else. */}
          {!isAdminRoute && !account && allowLocaleToggle && (
            <LocaleSwitcher
              locale={locale}
              onChange={changeLocale}
              label={languageLabel}
              className="hidden lg:inline-flex"
            />
          )}
          {!account && <CurrencyToggle className="hidden lg:inline-flex" />}
          {account ? (
            <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
              <Link href="/wallet" title={t("walletBalance")}
                className="hidden lg:flex items-center gap-2 h-9 rounded-lg border border-line bg-surface px-3 hover:border-line-2 transition-colors">
                <Wallet size={15} className="text-muted" />
                <span className="font-mono text-[13px] font-medium tabular whitespace-nowrap">
                  {balance === null ? "—" : formatBrowseMoney(balance, { locale })}
                </span>
              </Link>
              <MessageShortcut />
              <AccountBell />
              {/* ≤375px: only menu/logo/bell/avatar in chrome — Top up lives in account menu */}
              <Link href="/wallet" className="hidden min-[400px]:block">
                <Button size="md"><Plus size={15} /><span className="hidden sm:inline">{t("topUp")}</span></Button>
              </Link>
              <div className="relative" ref={menuRef}>
                <button onClick={() => setMenuOpen((v) => !v)} title={t("accountMenu")} aria-haspopup="menu" aria-expanded={menuOpen}
                  className="grid place-items-center h-9 w-9 overflow-hidden rounded-full border-2 border-iris/30 bg-iris-soft text-iris hover:border-iris/60 transition-colors text-[12px] font-bold uppercase">
                  {account.avatar
                    ? <MediaImage image={account.avatar} alt="" className="h-full w-full" fallback={account.email.slice(0, 2)} />
                    : account.email.slice(0, 2)}
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    aria-label={t("accountMenu")}
                    className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-24px)] z-50 rounded-xl border border-line bg-surface shadow-card-lg overflow-hidden animate-rise max-h-[calc(100dvh-5rem)] overflow-y-auto"
                  >
                    {/* Header Dark Card */}
                    <div className="p-3 bg-ink-panel">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="grid place-items-center h-7 w-7 shrink-0 overflow-hidden rounded-lg bg-surface/10 border border-line/20 text-iris-soft text-[11px] font-bold uppercase">
                            {account.avatar
                              ? <MediaImage image={account.avatar} alt="" className="h-full w-full" fallback={account.email.slice(0, 2)} />
                              : account.email.slice(0, 2)}
                          </span>
                          <span className="min-w-0 truncate text-[13px] font-semibold text-white/95">
                            {account.display_name?.trim() || t("yourProfile")}
                          </span>
                        </div>
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-iris-soft/80 bg-surface/10 px-2 py-0.5 rounded-md border border-line/20">
                          {accountRoleLabel}
                        </span>
                      </div>

                      <div className="text-[12px] font-mono text-iris-soft/90 break-all leading-snug mb-2.5 px-0.5">
                        {account.email}
                      </div>

                      {/* The balance gets a full-width row so the amount is never
                          clipped; it is also the menu's way into the wallet. */}
                      <Link
                        href="/wallet"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 rounded-lg border border-line/15 bg-surface/5 px-2.5 py-2 transition-colors hover:bg-surface/10 group/wallet"
                      >
                        <Wallet size={14} className="shrink-0 text-iris-soft/70" />
                        <span className="text-[11px] text-iris-soft/70">{t("walletBalance")}</span>
                        <span className="ml-auto whitespace-nowrap font-mono text-[13px] font-bold tabular text-white/95">
                          {balance === null ? "—" : formatBrowseMoney(balance, { locale })}
                        </span>
                        <ChevronRight size={13} className="shrink-0 text-iris-soft/50 group-hover/wallet:text-iris-soft" />
                      </Link>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        {[
                          { href: "/orders?status=active", label: t("menuStats.active"), value: orderStats.data ? orderStats.data.active.toLocaleString(locale) : "—" },
                          { href: "/orders", label: t("menuStats.spent"), value: orderStats.data ? formatBrowseMoney(orderStats.data.total_spend, { locale }) : "—" },
                        ].map((stat) => (
                          <Link
                            key={stat.href}
                            href={stat.href}
                            onClick={() => setMenuOpen(false)}
                            className="min-w-0 rounded-lg border border-line/15 bg-surface/5 px-2 py-1.5 transition-colors hover:bg-surface/10"
                          >
                            <span className="block truncate text-[10.5px] text-iris-soft/70">{stat.label}</span>
                            <span className="block whitespace-nowrap font-mono text-[12px] font-bold tabular text-iris-soft">{stat.value}</span>
                          </Link>
                        ))}
                      </div>
                    </div>

                    {/* Menu items with compact spacing */}
                    <div className="p-1.5 space-y-0.5">
                      {accountLinks
                        .filter(
                          (l) =>
                            (!l.auth || account) &&
                            (!l.role || account?.roles.includes(l.role)) &&
                            (!l.hideIfRole || !account?.roles.includes(l.hideIfRole))
                        )
                        .map((l, idx, visible) => {
                          const IconComp = l.icon;
                          // The workspace link is the one a seller/admin opens
                          // the menu for — it gets the emphasis, the rest stay quiet.
                          const isWorkspace = l.group === "workspace";
                          const startsGroup = idx > 0 && visible[idx - 1].group !== l.group;
                          return (
                            <Link
                              key={l.href}
                              href={l.href}
                              onClick={() => setMenuOpen(false)}
                              className={cn(
                                "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors group",
                                startsGroup && "mt-1.5 border-t border-line pt-2.5 rounded-t-none",
                                isWorkspace
                                  ? "text-fg bg-raised/70 hover:bg-raised"
                                  : "text-muted hover:text-fg hover:bg-raised"
                              )}
                            >
                              <span
                                className={cn(
                                  "grid place-items-center h-6 w-6 rounded-md transition-colors shrink-0",
                                  isWorkspace
                                    ? "bg-iris-soft text-iris"
                                    : "text-faint group-hover:text-fg"
                                )}
                              >
                                <IconComp size={15} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{l.label}</span>
                                {l.desc && <span className="block truncate text-[11px] font-normal text-faint">{l.desc}</span>}
                              </span>
                              {isWorkspace && <ChevronRight size={13} className="text-faint group-hover:text-fg" />}
                            </Link>
                          );
                        })}
                    </div>

                    <div className="h-px bg-line mx-2.5" />

                    {/* Logout button */}
                    <div className="p-1.5">
                      <button onClick={() => { setMenuOpen(false); router.push("/"); void logout(); }}
                        className="w-full flex items-center px-2.5 py-1.5 text-[12.5px] font-medium text-bad rounded-lg hover:bg-bad-soft transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="grid place-items-center h-6 w-6 rounded-md text-bad shrink-0">
                            <LogOut size={15} />
                          </span>
                          <span className="font-semibold">{t("signOut")}</span>
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Dưới 480px không đủ chỗ cho cả hai hành động bên cạnh menu và logo
               (màn 390px vẫn tràn) → gộp về một nút Đăng nhập; trang login
               đã có link "Đăng ký" nên không mất đường vào. */
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/login" className="hidden min-[480px]:block text-[14px] font-medium text-fg hover:text-iris px-2 transition-colors">{t("signIn")}</Link>
              <Link href="/register" className="hidden min-[480px]:block"><Button size="md">{t("openAccount")}</Button></Link>
              <Link href="/login" className="min-[480px]:hidden"><Button size="md">{t("signIn")}</Button></Link>
            </div>
          )}
        </div>
        {/* Row 2 — main pages. On phones it scrolls sideways (edge fade hints
            at more); the full list also lives in the drawer. */}
        <nav aria-label={t("mainNav")} className="hidden md:block border-t border-line/70">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 flex h-11 items-stretch gap-7">
            {navLinks.map((l) => {
              const active = isActive(l.match ?? l.href);
              return (
                <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
                  className={cn("relative flex shrink-0 items-center text-[14px] font-medium whitespace-nowrap transition-colors",
                    "after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-t-full after:bg-iris after:transition-transform after:duration-300 after:origin-center",
                    active ? "text-iris font-semibold after:scale-x-100" : "text-faint hover:text-fg after:scale-x-0")}>
                  {l.label}
                </Link>
              );
            })}
            {!account?.roles.includes("seller") && (
              <Link href="/sell" className="ml-auto flex shrink-0 items-center gap-1 text-[13px] font-medium text-faint hover:text-iris transition-colors whitespace-nowrap">
                {t("becomeSeller")} <ChevronRight size={14} />
              </Link>
            )}
          </div>
        </nav>
      </header>
      </div>
      <MobileDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} closeLabel={t("closeMenu")}>
        {navLinks.map((l, i) => {
          const active = isActive(l.match ?? l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} onClick={() => setMobileNavOpen(false)}
              style={{ transitionDelay: mobileNavOpen ? `${80 + i * 35}ms` : "0ms" }}
              className={cn("flex items-center justify-between rounded-xl px-3 py-3 text-[15px] font-medium",
                "transition-[opacity,transform,background-color] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none",
                mobileNavOpen ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0",
                active ? "bg-iris-soft/70 text-iris font-semibold" : "text-fg hover:bg-raised")}>
              {l.label}
              <ChevronRight size={16} className={active ? "text-iris" : "text-faint"} />
            </Link>
          );
        })}
        {!isAdminRoute && !account && allowLocaleToggle && (
          <div className="mt-3 flex items-center justify-between border-t border-line pt-4 px-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{languageLabel}</span>
            <LocaleSwitcher locale={locale} onChange={changeLocale} label={languageLabel} />
          </div>
        )}
        {!account && allowToggle && (
          <>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-4 px-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{tc("label")}</span>
              <CurrencyToggle compact />
            </div>
            <p className="px-3 pb-2 text-[11px] text-faint leading-snug">{tc("tooltip")}</p>
          </>
        )}
        {!account && (
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
            <Link href="/login" onClick={() => setMobileNavOpen(false)}
              className="flex h-11 items-center justify-center rounded-xl border border-line text-[14px] font-medium hover:bg-raised transition-colors">{t("signIn")}</Link>
            <Link href="/register" onClick={() => setMobileNavOpen(false)}
              className="flex h-11 items-center justify-center rounded-xl bg-iris text-[14px] font-semibold text-white hover:bg-iris-hi transition-colors">{t("openAccount")}</Link>
          </div>
        )}
      </MobileDrawer>
    </>
  );
}

/** Left sheet for phones: backdrop fades, panel slides in, links stagger.
 *  Stays mounted so the close animates too; `inert` keeps it out of tab order. */
function MobileDrawer({ open, onClose, closeLabel, children }: {
  open: boolean; onClose: () => void; closeLabel: string; children: React.ReactNode;
}) {
  return (
    <div className="md:hidden fixed inset-0 z-50" inert={!open} aria-hidden={!open} style={{ pointerEvents: open ? "auto" : "none" }}>
      <div onClick={onClose}
        className={cn("absolute inset-0 bg-ink-panel/45 backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0")} />
      <div id="mobile-nav" role="dialog" aria-modal="true"
        className={cn("absolute inset-y-0 left-0 flex w-[min(320px,86vw)] flex-col bg-surface shadow-card-lg",
          "transition-transform duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-16 items-center justify-between border-b border-line px-4">
          <Link href="/" onClick={onClose} aria-label="GMMO"><Logo /></Link>
          <button type="button" onClick={onClose} aria-label={closeLabel}
            className="grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">{children}</div>
      </div>
    </div>
  );
}
