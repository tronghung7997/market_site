"use client";

import { usePathname } from "@/i18n/navigation";
import type { ReactNode } from "react";

/** Renders the marketplace chrome (TopNav, footer, helpdesk) everywhere EXCEPT
 *  the admin console and the API docs, which ship their own full-screen shells.
 *  `fallback` is what those routes get instead (e.g. the page itself, un-gated). */
function hasOwnShell(pathname: string | null): boolean {
  return !!pathname && (pathname.startsWith("/admin") || pathname === "/docs/api" || pathname.startsWith("/docs/api/"));
}

export default function ChromeGate({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const pathname = usePathname();
  if (hasOwnShell(pathname)) return <>{fallback}</>;
  return <>{children}</>;
}
