"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Bolt, Logo, Menu, Plus, Wallet, X } from "./Icons";
import NotificationBell from "./NotificationBell";
import { Button } from "./ui";

const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Chợ" },
  { href: "/categories", label: "Danh mục" },
];

const ACCOUNT_LINKS: { href: string; label: string; auth?: boolean; role?: string; hideIfRole?: string }[] = [
  { href: "/orders", label: "Đơn hàng", auth: true },
  { href: "/wallet", label: "Ví", auth: true },
  { href: "/affiliate", label: "Affiliate", auth: true },
  { href: "/seller", label: "Gian hàng", role: "seller" },
  { href: "/seller/apply", label: "Đăng ký làm người bán", auth: true, hideIfRole: "seller" },
  { href: "/admin", label: "Admin", role: "admin" },
];

export default function TopNav() {
  const { account, logout } = useAuth();
  const pathname = usePathname();
  const [balance, setBalance] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => { setMenuOpen(false); setMobileNavOpen(false); }, [pathname]);

  useEffect(() => {
    let active = true;
    if (account) api.wallet().then((w) => active && setBalance(w.available_balance)).catch(() => {});
    else setBalance(null);
    return () => { active = false; };
  }, [account, pathname]);

  return (
    <>
      {/* Promo strip */}
      <div className="bg-ink-panel text-white/85 text-[12.5px]">
        <div className="mx-auto max-w-[1200px] px-6 h-9 flex items-center gap-2 justify-center sm:justify-start">
          <Bolt size={13} className="text-iris-hi" />
          <span>Nguồn tài khoản &amp; proxy đã xác minh · 195+ quốc gia · giao ngay, ký quỹ bảo vệ người mua</span>
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
          <button onClick={() => setMobileNavOpen((v) => !v)} title="Menu" aria-label="Menu" aria-expanded={mobileNavOpen}
            className="md:hidden grid place-items-center h-9 w-9 -ml-1 rounded-lg text-muted hover:text-fg hover:bg-raised transition-colors shrink-0">
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link href="/" aria-label="Proxora"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-0.5 shrink-0">
            {NAV_LINKS.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href}
                  className={cn("px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap",
                    active ? "text-fg bg-raised" : "text-muted hover:text-fg hover:bg-raised")}>
                  {l.label}
                </Link>
              );
            })}
            <Link href="/solutions" className="px-2.5 py-1.5 rounded-lg text-[13px] font-medium text-muted hover:text-fg hover:bg-raised transition-colors whitespace-nowrap">Giải pháp</Link>
          </nav>
          <div className="flex-1" />
          {account ? (
            <div className="flex items-center gap-2.5">
              <Link href="/wallet" title="Số dư ví"
                className="hidden sm:flex items-center gap-2 h-9 rounded-lg border border-line bg-surface px-3 hover:border-line-2 transition-colors">
                <Wallet size={15} className="text-muted" />
                <span className="font-mono text-[13px] font-medium tabular whitespace-nowrap">{balance === null ? "—" : vnd(balance)}</span>
              </Link>
              <NotificationBell endpoint="buyer" />
              <Link href="/wallet"><Button size="md"><Plus size={15} /> Nạp tiền</Button></Link>
              <div className="relative">
                <button onClick={() => setMenuOpen((v) => !v)} title="Hồ sơ tài khoản" aria-haspopup="menu" aria-expanded={menuOpen}
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
                          <div className="text-[11.5px] font-semibold text-iris uppercase tracking-wide">Hồ sơ của bạn</div>
                          <div className="text-[13.5px] font-medium text-fg truncate">{account.email}</div>
                        </div>
                      </div>
                      <div className="py-1 border-b border-line">
                        {ACCOUNT_LINKS.filter((l) => (!l.auth || account) && (!l.role || account?.roles.includes(l.role)) && (!l.hideIfRole || !account?.roles.includes(l.hideIfRole))).map((l) => (
                          <Link key={l.href} href={l.href}
                            className="block px-4 py-2 text-[13px] text-muted hover:text-fg hover:bg-raised transition-colors">
                            {l.label}
                          </Link>
                        ))}
                      </div>
                      <button onClick={() => { setMenuOpen(false); logout(); }}
                        className="w-full text-left px-4 py-2.5 text-[13px] font-medium text-bad hover:bg-bad-soft transition-colors">
                        Đăng xuất
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className="text-[13px] font-medium text-muted hover:text-fg px-2 transition-colors">Đăng nhập</Link>
              <Link href="/register"><Button size="md">Mở tài khoản</Button></Link>
            </div>
          )}
        </div>
        {mobileNavOpen && (
          <nav className="md:hidden border-t border-line bg-surface px-4 py-2">
            {NAV_LINKS.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href}
                  className={cn("block px-2.5 py-2.5 rounded-lg text-[14px] font-medium transition-colors",
                    active ? "text-fg bg-raised" : "text-muted hover:text-fg hover:bg-raised")}>
                  {l.label}
                </Link>
              );
            })}
            <Link href="/solutions" className="block px-2.5 py-2.5 rounded-lg text-[14px] font-medium text-muted hover:text-fg hover:bg-raised transition-colors">Giải pháp</Link>
          </nav>
        )}
      </header>
    </>
  );
}
