"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Bolt, Logo, Plus, Wallet } from "./Icons";
import { Button } from "./ui";

const LINKS: { href: string; label: string; auth?: boolean; role?: string }[] = [
  { href: "/", label: "Chợ" },
  { href: "/orders", label: "Đơn hàng", auth: true },
  { href: "/wallet", label: "Ví", auth: true },
  { href: "/affiliate", label: "Affiliate", auth: true },
  { href: "/seller", label: "Gian hàng", role: "seller" },
  { href: "/admin", label: "Admin", role: "admin" },
];

export default function TopNav() {
  const { account, logout } = useAuth();
  const pathname = usePathname();
  const [balance, setBalance] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    let active = true;
    if (account) api.wallet().then((w) => active && setBalance(w.balance)).catch(() => {});
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
        <div className="mx-auto max-w-[1200px] px-6 h-16 flex items-center gap-6">
          <Link href="/" aria-label="Proxora"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-0.5 shrink-0">
            {LINKS.filter((l) => (!l.auth || account) && (!l.role || account?.roles.includes(l.role))).map((l) => {
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
              <Link href="/wallet"><Button size="md"><Plus size={15} /> Nạp tiền</Button></Link>
              <div className="relative">
                <button onClick={() => setMenuOpen((v) => !v)} title="Tài khoản" aria-haspopup="menu" aria-expanded={menuOpen}
                  className="grid place-items-center h-9 w-9 rounded-lg border border-line bg-surface text-muted hover:text-fg hover:border-line-2 transition-colors text-[12px] font-semibold uppercase">
                  {account.email.slice(0, 2)}
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 mt-2 w-56 z-50 rounded-xl border border-line bg-surface shadow-card-lg overflow-hidden">
                      <div className="px-4 py-3 border-b border-line">
                        <div className="text-[11px] text-faint">Đăng nhập với</div>
                        <div className="text-[13px] font-medium truncate">{account.email}</div>
                      </div>
                      <div className="py-1">
                        <Link href="/orders" className="block px-4 py-2 text-[13px] text-muted hover:text-fg hover:bg-raised transition-colors">Đơn hàng</Link>
                        <Link href="/wallet" className="block px-4 py-2 text-[13px] text-muted hover:text-fg hover:bg-raised transition-colors">Ví</Link>
                        <Link href="/affiliate" className="block px-4 py-2 text-[13px] text-muted hover:text-fg hover:bg-raised transition-colors">Affiliate</Link>
                        {account.roles.includes("seller") && (
                          <Link href="/seller" className="block px-4 py-2 text-[13px] text-muted hover:text-fg hover:bg-raised transition-colors">Gian hàng</Link>
                        )}
                        {account.roles.includes("admin") && (
                          <Link href="/admin" className="block px-4 py-2 text-[13px] text-muted hover:text-fg hover:bg-raised transition-colors">Quản trị</Link>
                        )}
                      </div>
                      <button onClick={() => { setMenuOpen(false); logout(); }}
                        className="w-full text-left px-4 py-2.5 text-[13px] font-medium text-bad hover:bg-bad-soft border-t border-line transition-colors">
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
      </header>
    </>
  );
}
