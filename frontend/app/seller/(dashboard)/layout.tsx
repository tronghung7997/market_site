"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { BarChart, Edit2, Inbox, Package, Store } from "@/components/Icons";
import { Spinner } from "@/components/ui";
import type { ReactNode } from "react";

const NAV = [
  { href: "/seller", label: "Tổng quan", icon: BarChart },
  { href: "/seller/products", label: "Sản phẩm", icon: Package },
  { href: "/seller/orders", label: "Đơn hàng", icon: Inbox },
];

export default function SellerLayout({ children }: { children: ReactNode }) {
  const { account, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!account) {
      router.push("/login?next=/seller");
    } else if (!account.roles.includes("seller")) {
      router.push("/seller/apply");
    }
  }, [account, loading, router]);

  if (loading) return <div className="py-20"><Spinner /></div>;
  if (!account || !account.roles.includes("seller")) return null;

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-6">
      <div className="flex items-center gap-3 mb-6">
        <span className="grid place-items-center h-9 w-9 rounded-lg bg-iris/10 border border-iris/20">
          <Store size={18} className="text-iris-hi" />
        </span>
        <div>
          <h1 className="text-[18px] font-serif font-semibold">Quản lý gian hàng</h1>
          <p className="text-[12px] text-muted">{account.email}</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-line pb-px">
        {NAV.map((n) => {
          const active = n.href === "/seller" ? pathname === "/seller" : pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-[13.5px] font-medium -mb-px border-b-2 transition-colors",
                active ? "border-iris text-fg" : "border-transparent text-muted hover:text-fg",
              )}>
              <n.icon size={15} />
              {n.label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
