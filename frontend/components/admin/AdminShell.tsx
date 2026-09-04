"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  Activity, ArrowRight, BarChart, Bell, ChevronLeft, ClipboardList, FileText,
  Grid, Inbox, LogOut, Menu, MessageCircle, Package, Plus, Receipt, Shield, Sliders, TrendingUp, Users, Verified, Wallet,
} from "@/components/Icons";
import NotificationBell from "@/components/NotificationBell";

type NavItem = { href: string; label: string; icon: (p: { size?: number }) => ReactNode };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Giám sát",
    items: [
      { href: "/admin", label: "Tổng quan", icon: BarChart },
      { href: "/admin/orders", label: "Đơn hàng & Giao dịch", icon: Inbox },
      { href: "/admin/products", label: "Sản phẩm", icon: Package },
      { href: "/admin/categories", label: "Danh mục", icon: Grid },
      { href: "/admin/disputes", label: "Khiếu nại", icon: Shield },
      { href: "/admin/support", label: "Chat Marketplace", icon: MessageCircle },
      { href: "/admin/affiliates", label: "Affiliate", icon: TrendingUp },
    ],
  },
  {
    label: "Hệ thống",
    items: [
      { href: "/admin/accounts", label: "Tài khoản", icon: Users },
      { href: "/admin/seller-applications", label: "Đơn đăng ký bán", icon: Verified },
      { href: "/admin/deposits", label: "Nạp tiền", icon: Plus },
      { href: "/admin/withdrawals", label: "Rút tiền", icon: Wallet },
      { href: "/admin/display-settings", label: "Cài đặt", icon: Sliders },
      { href: "/admin/providers", label: "Nhà cung cấp", icon: Activity },
      { href: "/admin/tasks", label: "Tác vụ", icon: ClipboardList },
      { href: "/admin/alerts", label: "Cảnh báo", icon: Bell },
      { href: "/admin/reports", label: "Báo cáo", icon: FileText },
      { href: "/admin/resources", label: "Tài nguyên", icon: Package },
      { href: "/admin/logs", label: "Nhật ký", icon: Receipt },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function isActive(href: string, pathname: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function currentTitle(pathname: string) {
  const match = [...ALL_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => isActive(i.href, pathname));
  return match?.label ?? "Quản trị";
}

const STORAGE_KEY = "admin_sidebar_collapsed";

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { account, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    setReady(true);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const initials = (account?.email ?? "AD").slice(0, 2).toUpperCase();
  const title = currentTitle(pathname);

  return (
    <div className="flex min-h-screen admin-canvas">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ============ SIDEBAR ============ */}
      <aside
        className={cn(
          "admin-sidebar fixed lg:sticky top-0 z-50 lg:z-auto h-screen shrink-0 flex flex-col overflow-y-auto overflow-x-hidden",
          "border-r border-[var(--side-line)] transition-transform lg:transition-[width] duration-300 ease-out",
          "w-[248px]",
          collapsed ? "lg:w-[72px]" : "lg:w-[248px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
        style={{ color: "var(--side-fg)" }}
      >
        {/* Brand */}
        <div className={cn("flex items-center h-16 shrink-0", collapsed ? "justify-center px-0" : "px-5")}>
          <span className="grid place-items-center h-9 w-9 shrink-0 rounded-[9px] bg-[var(--side-accent-soft)] border border-[var(--side-accent)]/30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7Z" stroke="var(--side-accent)" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M12 8 16 10.2v3.6L12 16l-4-2.2v-3.6Z" fill="var(--side-accent)" opacity="0.9" />
            </svg>
          </span>
          {!collapsed && (
            <div className="ml-2.5 min-w-0 animate-rise">
              <div className="font-serif text-[18px] font-semibold leading-none tracking-tight">Marketplace</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--side-accent)]">
                Admin Console
              </div>
            </div>
          )}
        </div>

        <div className="h-px mx-3 bg-[var(--side-line)]" />

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              {!collapsed && (
                <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--side-faint)]">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const active = isActive(item.href, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "group relative flex items-center rounded-lg text-[13.5px] font-medium transition-colors",
                      collapsed ? "justify-center h-11 w-11 mx-auto" : "gap-3 px-3 h-10",
                      active
                        ? "bg-[var(--side-accent-soft)] text-white"
                        : "text-[var(--side-muted)] hover:text-white hover:bg-white/5",
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-[var(--side-accent)]" />
                    )}
                    <span className={cn("shrink-0", active ? "text-[var(--side-accent)]" : "")}>
                      <item.icon size={18} />
                    </span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer block */}
        <div className="mt-auto p-3 border-t border-[var(--side-line)] space-y-1">
          <Link
            href="/"
            title={collapsed ? "Về Chợ" : undefined}
            className={cn(
              "flex items-center rounded-lg text-[13px] font-medium text-[var(--side-muted)] hover:text-white hover:bg-white/5 transition-colors",
              collapsed ? "justify-center h-11 w-11 mx-auto" : "gap-3 px-3 h-10",
            )}
          >
            <ArrowRight size={17} className="rotate-180 shrink-0" />
            {!collapsed && <span>Về Chợ</span>}
          </Link>

          <div
            className={cn(
              "flex items-center rounded-lg",
              collapsed ? "justify-center py-2" : "gap-2.5 px-2 py-2",
            )}
          >
            <span className="grid place-items-center h-8 w-8 shrink-0 rounded-full bg-[var(--side-accent-soft)] border border-[var(--side-accent)]/30 text-[11px] font-bold text-white">
              {initials}
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 text-[12px] text-[var(--side-muted)] truncate">
                  {account?.email}
                </span>
                <button
                  onClick={logout}
                  title="Đăng xuất"
                  className="grid place-items-center h-7 w-7 shrink-0 rounded-md text-[var(--side-faint)] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <LogOut size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ============ MAIN COLUMN ============ */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 h-16 shrink-0 bg-surface/85 backdrop-blur-md border-b border-line">
          <div className="h-full px-6 flex items-center gap-4">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Mở menu"
              className="lg:hidden grid place-items-center h-9 w-9 rounded-lg border border-line bg-surface text-muted hover:text-fg hover:border-line-2 transition-colors cursor-pointer"
            >
              <Menu size={17} />
            </button>
            <button
              onClick={toggle}
              aria-label="Thu gọn menu"
              className="hidden lg:grid place-items-center h-9 w-9 rounded-lg border border-line bg-surface text-muted hover:text-fg hover:border-line-2 transition-colors cursor-pointer"
            >
              {ready && collapsed ? <Menu size={17} /> : <ChevronLeft size={17} />}
            </button>

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-[13px] min-w-0">
              <span className="text-faint">Quản trị</span>
              <span className="text-faint">/</span>
              <span className="font-medium text-fg truncate">{title}</span>
            </nav>

            <div className="flex-1" />

            <NotificationBell endpoint="admin" />

            {/* Live status */}
            <span className="hidden sm:flex items-center gap-2 h-8 px-3 rounded-full border border-good/25 bg-good-soft text-[12px] font-medium text-good">
              <span className="admin-live-dot h-1.5 w-1.5 rounded-full bg-good" />
              Hệ thống hoạt động
            </span>

            <span className="hidden md:block text-[12px] text-faint tabular">
              {new Date().toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </span>
          </div>
        </header>

        {/* Page header + content */}
        <main className="flex-1 px-6 py-6">
          <div className="mb-5">
            <h1 className="font-serif text-[24px] font-semibold tracking-tight">{title}</h1>
          </div>
          <div className="animate-rise">{children}</div>
        </main>
      </div>
    </div>
  );
}
