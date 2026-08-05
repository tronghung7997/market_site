"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useWalletBalance } from "@/hooks/use-wallet";
import { Bolt, Logo, Menu, Plus, Wallet, X } from "./Icons";
import NotificationBell from "./NotificationBell";
import { Button } from "./ui";

const localeSwitcherEnabled = process.env.NEXT_PUBLIC_ENABLE_VI === "true";

export default function TopNav() {
  const { account, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("nav");
  const navLinks = [{ href: "/", label: t("marketplace") }, { href: "/categories", label: t("categories") }];
  const accountLinks = [
    { href: "/orders", label: t("orders"), auth: true }, { href: "/wallet", label: t("wallet"), auth: true },
    { href: "/affiliate", label: t("affiliate"), auth: true }, { href: "/seller", label: t("seller"), role: "seller" },
    { href: "/seller/apply", label: t("becomeSeller"), auth: true, hideIfRole: "seller" }, { href: "/admin", label: t("admin"), role: "admin" },
  ];
  // Số dư đọc từ query cache dùng chung với trang Ví — mua hàng/nạp/rút ở
  // bất kỳ đâu invalidate ["wallet"] là con số này tự nhảy, không cần đổi
  // trang như bản cũ (trước đây refetch theo pathname để chữa stale).
  const { data: wallet } = useWalletBalance(!!account);
  const balance = account ? wallet?.available_balance ?? null : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => { setMenuOpen(false); setMobileNavOpen(false); }, [pathname]);

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
            className="md:hidden grid place-items-center h-9 w-9 -ml-1 rounded-lg text-muted hover:text-fg hover:bg-raised transition-colors shrink-0">
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link href="/" aria-label="Proxora"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-0.5 shrink-0">
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
          {localeSwitcherEnabled && <div className="hidden sm:flex items-center gap-1 text-[12px] font-semibold text-muted">
            <button type="button" onClick={() => changeLocale("en")} aria-pressed={locale === "en"} className={cn("px-1 hover:text-fg", locale === "en" && "text-fg")}>EN</button>
            <span className="text-faint">/</span>
            <button type="button" onClick={() => changeLocale("vi")} aria-pressed={locale === "vi"} className={cn("px-1 hover:text-fg", locale === "vi" && "text-fg")}>VI</button>
          </div>}
          {account ? (
            <div className="flex items-center gap-2.5">
              <Link href="/wallet" title={t("walletBalance")}
                className="hidden sm:flex items-center gap-2 h-9 rounded-lg border border-line bg-surface px-3 hover:border-line-2 transition-colors">
                <Wallet size={15} className="text-muted" />
                <span className="font-mono text-[13px] font-medium tabular whitespace-nowrap">{balance === null ? "—" : vnd(balance, locale)}</span>
              </Link>
              <NotificationBell endpoint="buyer" />
              {/* Dưới 400px cụm chuông + nút + avatar tràn khỏi màn (đo được
                  tràn 28px ở 375) → thu nút về icon-only, chữ hiện lại từ 400px. */}
              <Link href="/wallet"><Button size="md"><Plus size={15} /><span className="hidden min-[400px]:inline">{t("topUp")}</span></Button></Link>
              <div className="relative">
                <button onClick={() => setMenuOpen((v) => !v)} title={t("accountMenu")} aria-haspopup="menu" aria-expanded={menuOpen}
                  className="grid place-items-center h-9 w-9 rounded-full border-2 border-iris/30 bg-iris-soft text-iris hover:border-iris/60 transition-colors text-[12px] font-bold uppercase">
                  {account.email.slice(0, 2)}
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 mt-2 w-64 z-50 rounded-xl border border-line bg-surface shadow-card-lg overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line bg-raised/50">
                        <span className="grid place-items-center h-10 w-10 shrink-0 rounded-full border-2 border-iris/30 bg-iris-soft text-iris text-[13px] font-bold uppercase">
                          {account.email.slice(0, 2)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[11.5px] font-semibold text-iris uppercase tracking-wide">{t("yourProfile")}</div>
                          <div className="text-[13.5px] font-medium text-fg truncate">{account.email}</div>
                        </div>
                      </div>
                      <div className="py-1 border-b border-line">
                        {accountLinks.filter((l) => (!l.auth || account) && (!l.role || account?.roles.includes(l.role)) && (!l.hideIfRole || !account?.roles.includes(l.hideIfRole))).map((l) => (
                          <Link key={l.href} href={l.href}
                            className="block px-4 py-2 text-[13px] text-muted hover:text-fg hover:bg-raised transition-colors">
                            {l.label}
                          </Link>
                        ))}
                      </div>
                      <button onClick={() => { setMenuOpen(false); logout(); }}
                        className="w-full text-left px-4 py-2.5 text-[13px] font-medium text-bad hover:bg-bad-soft transition-colors">
                        {t("signOut")}
                      </button>
                    </div>
                  </>
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
            {localeSwitcherEnabled && <div className="mt-1 flex items-center gap-1 border-t border-line pt-2 px-2.5">
              <button type="button" onClick={() => changeLocale("en")} aria-pressed={locale === "en"} className={cn("text-xs font-medium", locale === "en" ? "text-fg" : "text-muted")}>EN</button>
              <span className="text-faint">/</span>
              <button type="button" onClick={() => changeLocale("vi")} aria-pressed={locale === "vi"} className={cn("text-xs font-medium", locale === "vi" ? "text-fg" : "text-muted")}>VI</button>
            </div>}
          </nav>
        )}
      </header>
    </>
  );
}
