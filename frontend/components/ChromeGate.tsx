"use client";

import { usePathname } from "@/i18n/navigation";
import type { ReactNode } from "react";

/** Renders the marketplace chrome (TopNav, footer) everywhere EXCEPT the
 *  admin console, which ships its own full-screen shell. `fallback` is what
 *  the admin console gets instead (e.g. the page itself, un-gated). */
export default function ChromeGate({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return <>{fallback}</>;
  return <>{children}</>;
}
