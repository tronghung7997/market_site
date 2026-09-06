"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { useWalletBalance } from "@/hooks/use-wallet";
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
  Wallet,
  X,
} from "./Icons";
import NotificationBell from "./NotificationBell";
import MessageShortcut from "./chat/MessageShortcut";
import CurrencyToggle from "./CurrencyToggle";
import { Button } from "./ui";

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
  const { account, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("nav");
  const tc = useTranslations("currency");
  const languageLabel = t("language");
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const navLinks = [{ href: "/", label: t("marketplace") }, { href: "/categories", label: t("categories") }];
  const accountRoleLabel = account?.roles.includes("admin")
    ? t("admin")
    : account?.roles.includes("seller")
      ? t("sellerRole")
      : t("buyerRole");

  const accountLinks = [
    { href: "/messages", label: t("messages"), icon: MessageCircle, auth: true },
    { href: "/orders", label: t("orders"), icon: Package, auth: true },
    { href: "/transactions", label: t("transactions"), icon: ArrowLeftRight, auth: true },
    { href: "/affiliate", label: t("affiliate"), icon: Percent, auth: true },
    { href: "/seller", label: t("seller"), icon: Store, role: "seller" },
    { href: "/seller/apply", label: t("becomeSeller"), icon: Store, auth: true, hideIfRole: "seller" },
    { href: "/admin", label: t("admin"), icon: Shield, role: "admin" },
  ];
  // Số dư đọc từ query cache dùng chung với trang Ví — mua hàng/nạp/rút ở
  // bất kỳ đâu invalidate ["wallet"] là con số này tự nhảy, không cần đổi
  // trang như bản cũ (trước đây refetch theo pathname để chữa stale).
  const { data: wallet } = useWalletBalance(!!account);
  const balance = account ? wallet?.available_balance ?? null : null;
  const { formatBrowseMoney, allowLocaleToggle, allowToggle } = useMoney();
  const [menuOpen, setMenuOpen] = useState(false);
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

  const changeLocale = (nextLocale: "en" | "vi") => {
    document.cookie = `NEXT_LOCALE=${nextLocale};path=/;max-age=31536000;SameSite=Lax`;
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <>
      {/* Promo strip */}
      <div className="bg-ink-panel text-white/85 text-[12.5px]">
        <div className="mx-auto max-w-[1200px] px-6 min-h-9 py-1.5 flex items-center gap-2 justify-center sm:justify-start">
          <Bolt size={13} className="text-iris-hi" />
          <span>{t("promo")}</span>
        </div>
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-40 bg-surface/85 backdrop-blur-md border-b border-line">
        {/* px/gap hẹp lại ở màn nhỏ: logo + nút Nạp tiền + avatar vốn đã sát mép,
            giữ nguyên px-6/gap-6 thì tràn vài px và kéo cả trang trôi ngang. */}
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 h-16 flex items-center gap-3 sm:gap-6">
          {/* Nút menu đứng ngoài cùng bên trái, trước logo: bên phải đã có ví +
              Nạp tiền + avatar, nhét thêm vào đó thì chật và nút menu nằm lọt giữa
              hai thứ không liên quan. */}
          <button onClick={() => setMobileNavOpen((v) => !v)} title={t("menu")} aria-label={t("menu")} aria-expanded={mobileNavOpen}
            className="lg:hidden grid place-items-center h-9 w-9 -ml-1 rounded-lg text-muted hover:text-fg hover:bg-raised transition-colors shrink-0">
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link href="/" aria-label="Marketplace"><Logo /></Link>
          <nav className="hidden lg:flex items-center gap-0.5 shrink-0">
            {navLinks.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href}
                  className={cn("px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap",
                    active ? "text-fg bg-raised" : "text-muted hover:text-fg hover:bg-raised")}>
                  {l.label}
                </Link>
              );
            })}
            <Link href="/solutions" className="px-2.5 py-1.5 rounded-lg text-[13px] font-medium text-muted hover:text-fg hover:bg-raised transition-colors whitespace-nowrap">{t("solutions")}</Link>
          </nav>
          <div className="flex-1" />
          {!isAdminRoute && allowLocaleToggle && (
            <LocaleSwitcher
              locale={locale}
              onChange={changeLocale}
              label={languageLabel}
              className="hidden lg:inline-flex"
            />
          )}
          {/* Currency independent of locale — shown when admin enables toggle. */}
          <CurrencyToggle className="hidden lg:inline-flex" />
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
              <NotificationBell endpoint="account" />
              {/* ≤375px: only menu/logo/bell/avatar in chrome — Top up lives in account menu */}
              <Link href="/wallet" className="hidden min-[400px]:block">
                <Button size="md"><Plus size={15} /><span className="hidden sm:inline">{t("topUp")}</span></Button>
              </Link>
              <div className="relative" ref={menuRef}>
                <button onClick={() => setMenuOpen((v) => !v)} title={t("accountMenu")} aria-haspopup="menu" aria-expanded={menuOpen}
                  className="grid place-items-center h-9 w-9 rounded-full border-2 border-iris/30 bg-iris-soft text-iris hover:border-iris/60 transition-colors text-[12px] font-bold uppercase">
                  {account.email.slice(0, 2)}
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    aria-label={t("accountMenu")}
                    className="absolute right-0 mt-2 w-64 z-50 rounded-xl border border-line bg-surface shadow-card-lg overflow-hidden animate-rise"
                  >
                    {/* Header Dark Card */}
                    <div className="p-3 bg-ink-panel">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="grid place-items-center h-7 w-7 shrink-0 rounded-lg bg-surface/10 border border-line/20 text-iris-soft text-[11px] font-bold uppercase">
                            {account.email.slice(0, 2)}
                          </span>
                          <span className="text-[10.5px] font-semibold text-iris-soft uppercase tracking-wider">
                            {t("yourProfile")}
                          </span>
                        </div>
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-iris-soft/80 bg-surface/10 px-2 py-0.5 rounded-md border border-line/20">
                          {accountRoleLabel}
                        </span>
                      </div>

                      <div className="text-[12px] font-mono text-iris-soft/90 break-all leading-snug mb-2.5 px-0.5">
                        {account.email}
                      </div>

                      {/* Clickable Wallet Snapshot inside Header */}
                      <Link
                        href="/wallet"
                        onClick={() => setMenuOpen(false)}
                        title={t("walletBalance")}
                        className="bg-surface/5 hover:bg-surface/10 rounded-lg px-2.5 py-1.5 flex items-center justify-between border border-line/15 transition-colors group cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-iris-soft">
                            <Wallet size={14} />
                          </span>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[10px] text-iris-soft/60 uppercase tracking-wider font-medium">
                              {t("walletBalance")}:
                            </span>
                            <span className="text-[12.5px] font-mono font-bold text-iris-soft">
                              {balance === null ? "—" : formatBrowseMoney(balance, { locale })}
                            </span>
                          </div>
                        </div>
                        <ChevronRight size={13} className="text-iris-soft/50 group-hover:text-iris-soft group-hover:translate-x-0.5 transition-all" />
                      </Link>
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
                        .map((l) => {
                          const IconComp = l.icon;
                          const isTransactions = l.href === "/transactions";
                          return (
                            <Link
                              key={l.href}
                              href={l.href}
                              onClick={() => setMenuOpen(false)}
                              className={cn(
                                "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors group",
                                isTransactions
                                  ? "text-fg bg-raised/70 hover:bg-raised"
                                  : "text-muted hover:text-fg hover:bg-raised"
                              )}
                            >
                              <span
                                className={cn(
                                  "grid place-items-center h-6 w-6 rounded-md transition-colors shrink-0",
                                  isTransactions
                                    ? "bg-iris-soft text-iris"
                                    : "text-faint group-hover:text-fg"
                                )}
                              >
                                <IconComp size={15} />
                              </span>
                              <span className="flex-1 truncate">{l.label}</span>
                              {isTransactions && (
                                <span className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-iris bg-iris-soft px-1.5 py-0.5 rounded">
                                  {t("logBadge")}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                    </div>

                    <div className="h-px bg-line mx-2.5" />

                    {/* Logout button */}
                    <div className="p-1.5">
                      <button onClick={() => { setMenuOpen(false); logout(); }}
                        className="w-full flex items-center justify-between px-2.5 py-1.5 text-[12.5px] font-medium text-bad rounded-lg hover:bg-bad-soft transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="grid place-items-center h-6 w-6 rounded-md text-bad shrink-0">
                            <LogOut size={15} />
                          </span>
                          <span className="font-semibold">{t("signOut")}</span>
                        </div>
                        <span className="text-[10px] text-faint font-mono">ESC</span>
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
              <Link href="/login" className="hidden min-[480px]:block text-[13px] font-medium text-muted hover:text-fg px-2 transition-colors">{t("signIn")}</Link>
              <Link href="/register" className="hidden min-[480px]:block"><Button size="md">{t("openAccount")}</Button></Link>
              <Link href="/login" className="min-[480px]:hidden"><Button size="md">{t("signIn")}</Button></Link>
            </div>
          )}
        </div>
        {mobileNavOpen && (
          <nav className="md:hidden border-t border-line bg-surface px-4 py-2">
            {navLinks.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href}
                  className={cn("block px-2.5 py-2.5 rounded-lg text-[14px] font-medium transition-colors",
                    active ? "text-fg bg-raised" : "text-muted hover:text-fg hover:bg-raised")}>
                  {l.label}
                </Link>
              );
            })}
            <Link href="/solutions" className="block px-2.5 py-2.5 rounded-lg text-[14px] font-medium text-muted hover:text-fg hover:bg-raised transition-colors">{t("solutions")}</Link>
            {!isAdminRoute && allowLocaleToggle && (
              <div className="mt-1 flex items-center justify-between border-t border-line pt-3 px-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{languageLabel}</span>
                <LocaleSwitcher locale={locale} onChange={changeLocale} label={languageLabel} />
              </div>
            )}
            {allowToggle && (
              <>
                <div className="mt-1 flex items-center justify-between border-t border-line pt-3 px-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{tc("label")}</span>
                  <CurrencyToggle compact />
                </div>
                <p className="px-2.5 pb-2 text-[11px] text-faint leading-snug">{tc("tooltip")}</p>
              </>
            )}
          </nav>
        )}
      </header>
    </>
  );
}
