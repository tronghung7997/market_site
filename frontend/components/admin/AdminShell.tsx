"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ActionItem } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  ArrowRight, BarChart, Bell, ChevronLeft, Inbox, Layers, LogOut, Menu, MessageCircle,
  Package, Sliders, Users, Wallet,
} from "@/components/Icons";
import NotificationBell from "@/components/NotificationBell";
import { SystemStatusBanner } from "@/features/admin-site-settings";

type NavTab = { href: string; label: string };
type NavHub = {
  key: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  tabs: NavTab[];
};

// 20 trang gộp thành 9 mục theo việc admin cần làm. Mỗi mục là một "hub":
// sidebar trỏ tới tab đầu, các trang cùng hub hiện thành thanh tab ở đầu
// trang. URL từng trang giữ nguyên — link cũ, bookmark, thông báo vẫn đúng.
const HUBS: NavHub[] = [
  {
    key: "overview", label: "Tổng quan", icon: BarChart, tabs: [
      { href: "/admin", label: "Tổng quan" },
      { href: "/admin/analytics", label: "Phân tích kinh doanh" },
    ],
  },
  {
    key: "orders", label: "Đơn hàng", icon: Inbox, tabs: [
      { href: "/admin/orders", label: "Đơn hàng & giao dịch" },
      { href: "/admin/disputes", label: "Khiếu nại" },
      { href: "/admin/tasks", label: "Tác vụ giao hàng" },
    ],
  },
  { key: "support", label: "Chat hỗ trợ", icon: MessageCircle, tabs: [{ href: "/admin/support", label: "Chat hỗ trợ" }] },
  {
    key: "catalog", label: "Sản phẩm", icon: Package, tabs: [
      { href: "/admin/products", label: "Sản phẩm" },
      { href: "/admin/categories", label: "Danh mục" },
    ],
  },
  {
    key: "supply", label: "Nguồn hàng", icon: Layers, tabs: [
      { href: "/admin/sources", label: "Nguồn cung" },
      { href: "/admin/providers", label: "Kết nối API" },
      { href: "/admin/resources", label: "Kho tài nguyên" },
    ],
  },
  {
    key: "people", label: "Người dùng", icon: Users, tabs: [
      { href: "/admin/accounts", label: "Tài khoản" },
      { href: "/admin/seller-applications", label: "Đăng ký bán hàng" },
      { href: "/admin/affiliates", label: "Affiliate" },
    ],
  },
  {
    key: "money", label: "Tài chính", icon: Wallet, tabs: [
      { href: "/admin/deposits", label: "Nạp tiền" },
      { href: "/admin/withdrawals", label: "Rút tiền" },
      { href: "/admin/reports", label: "Báo cáo" },
    ],
  },
  {
    key: "alerts", label: "Cảnh báo & nhật ký", icon: Bell, tabs: [
      { href: "/admin/alerts", label: "Cảnh báo" },
      { href: "/admin/logs", label: "Nhật ký" },
    ],
  },
  {
    key: "settings", label: "Cài đặt", icon: Sliders, tabs: [
      { href: "/admin/display-settings", label: "Cài đặt hệ thống" },
      { href: "/admin/site-pages", label: "Trang nội dung" },
    ],
  },
];

// Hai mục cuối là cấu hình/giám sát ít dùng hằng ngày — tách bằng một vạch.
const SYSTEM_HUBS = new Set(["alerts", "settings"]);

// Số việc đang chờ trên từng tab — cùng nguồn với "Việc cần xử lý" ở Tổng quan.
const BADGE_KEYS: Record<string, string> = {
  "/admin/disputes": "admin_open_disputes",
  "/admin/support": "admin_marketplace_review",
  "/admin/tasks": "admin_pending_tasks",
  "/admin/seller-applications": "admin_pending_applications",
  "/admin/withdrawals": "admin_pending_withdrawals",
};

function tabBadges(items: ActionItem[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!items) return out;
  for (const [href, key] of Object.entries(BADGE_KEYS)) {
    const count = items.find((i) => i.key === key)?.count ?? 0;
    if (count > 0) out[href] = count;
  }
  const alerts = items.filter((i) => i.alert_id != null).length;
  if (alerts > 0) out["/admin/alerts"] = alerts;
  return out;
}

function badgeText(count: number) {
  return count > 99 ? "99+" : String(count);
}

function matches(href: string, pathname: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

function currentPlace(pathname: string) {
  for (const hub of HUBS) {
    const tab = hub.tabs.find((t) => matches(t.href, pathname));
    if (tab) return { hub, tab, exact: tab.href === pathname };
  }
  return { hub: null, tab: null, exact: false };
}

const STORAGE_KEY = "admin_sidebar_collapsed";

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { account, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const actionQ = useQuery({
    queryKey: ["admin", "action-items"],
    queryFn: () => api.adminActionItems(),
    refetchInterval: 60_000,
  });
  const badges = tabBadges(actionQ.data);
  const hubBadge = (hub: NavHub) => hub.tabs.reduce((sum, t) => sum + (badges[t.href] ?? 0), 0);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Trình duyệt chặn storage: dùng mặc định.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Không lưu được thì chỉ nhớ trong phiên này.
      }
      return next;
    });
  };

  const initials = (account?.email ?? "AD").slice(0, 2).toUpperCase();
  const { hub: activeHub, tab: activeTab, exact } = currentPlace(pathname);
  // Trang chi tiết (sản phẩm #, nguồn #…) tự có tiêu đề riêng; tiêu đề hub
  // và thanh tab chỉ hiện ở trang gốc của từng tab.
  const showHubHeader = exact || activeHub == null;

  const renderHub = (hub: NavHub) => {
    const active = hub === activeHub;
    const badge = hubBadge(hub);
    return (
      <Link
        key={hub.key}
        href={hub.tabs[0].href}
        prefetch={false}
        title={collapsed ? (badge ? `${hub.label} (${badge})` : hub.label) : undefined}
        className={cn(
          "group relative flex items-center rounded-lg text-[13.5px] font-medium transition-colors",
          collapsed ? "justify-center h-10 w-11 mx-auto" : "gap-3 px-3 h-10",
          active
            ? "bg-[var(--side-accent-soft)] text-white"
            : "text-[var(--side-muted)] hover:text-white hover:bg-white/5",
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-[var(--side-accent)]" />
        )}
        <span className={cn("shrink-0", active ? "text-[var(--side-accent)]" : "")}>
          <hub.icon size={18} />
        </span>
        {!collapsed && <span className="min-w-0 flex-1 truncate">{hub.label}</span>}
        {badge > 0 && (
          collapsed ? (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--side-accent)]" />
          ) : (
            <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-px text-[11px] font-semibold tabular-nums text-white">
              {badgeText(badge)}
            </span>
          )
        )}
      </Link>
    );
  };

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
          "w-[232px]",
          collapsed ? "lg:w-[72px]" : "lg:w-[232px]",
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
              <div className="font-serif text-[18px] font-semibold leading-none tracking-tight">GMMO</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--side-accent)]">
                Admin Console
              </div>
            </div>
          )}
        </div>

        <div className="h-px mx-3 bg-[var(--side-line)]" />

        <nav className="flex-1 py-3 px-3 space-y-1" aria-label="Quản trị">
          {HUBS.filter((h) => !SYSTEM_HUBS.has(h.key)).map(renderHub)}
          <div className="my-3 h-px bg-[var(--side-line)]" />
          {HUBS.filter((h) => SYSTEM_HUBS.has(h.key)).map(renderHub)}
        </nav>

        {/* Footer block */}
        <div className="mt-auto p-3 border-t border-[var(--side-line)] space-y-1">
          <Link
            href="/"
            prefetch={false}
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
        {/* Topbar — the red "something is switched off" strip rides above it */}
        <div className="sticky top-0 z-30 shrink-0">
        <SystemStatusBanner />
        <header className="h-14 bg-surface/85 backdrop-blur-md border-b border-line">
          <div className="h-full px-4 sm:px-6 flex items-center gap-3">
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
            <nav className="flex items-center gap-1.5 text-[13px] min-w-0" aria-label="Vị trí">
              {activeHub && activeTab && activeHub.tabs.length > 1 && activeTab.label !== activeHub.label ? (
                <>
                  <Link href={activeHub.tabs[0].href} prefetch={false} className="text-faint hover:text-fg">{activeHub.label}</Link>
                  <span className="text-faint">/</span>
                  <span className="font-medium text-fg min-w-0 truncate">{activeTab?.label}</span>
                </>
              ) : (
                <span className="font-medium text-fg min-w-0 truncate">{activeHub?.label ?? "Quản trị"}</span>
              )}
            </nav>

            <div className="flex-1" />

            <NotificationBell endpoint="admin" />

            <span className="hidden md:block text-[12px] text-faint tabular">
              {new Date().toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </span>
          </div>
        </header>
        </div>

        {/* Page header + content */}
        <main className="flex-1 px-4 py-5 sm:px-6">
          {showHubHeader && (
            <div className="mb-5">
              <h1 className="font-serif text-[24px] font-semibold tracking-tight">{activeHub?.label ?? "Quản trị"}</h1>
              {activeHub && activeHub.tabs.length > 1 && (
                <div className="mt-3 -mb-px flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label={activeHub.label}>
                  {activeHub.tabs.map((tab) => {
                    const on = tab === activeTab;
                    const badge = badges[tab.href];
                    return (
                      <Link
                        key={tab.href}
                        href={tab.href}
                        prefetch={false}
                        role="tab"
                        aria-selected={on}
                        className={cn(
                          "relative inline-flex shrink-0 items-center gap-1.5 px-3 pb-2.5 pt-1 text-[13.5px] font-medium transition-colors",
                          on ? "text-fg" : "text-muted hover:text-fg",
                        )}
                      >
                        {tab.label}
                        {badge != null && (
                          <span className="rounded-full bg-bad-soft px-1.5 py-px text-[11px] font-semibold tabular-nums text-bad">
                            {badgeText(badge)}
                          </span>
                        )}
                        {on && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-iris" />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="animate-rise">{children}</div>
        </main>
      </div>
    </div>
  );
}
