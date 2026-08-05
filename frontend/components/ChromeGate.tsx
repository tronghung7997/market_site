"use client";

import { usePathname } from "@/i18n/navigation";
import type { ReactNode } from "react";

/** Renders the marketplace chrome (TopNav, footer) everywhere EXCEPT the
 *  admin console, which ships its own full-screen shell. */
export default function ChromeGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return <>{children}</>;
}
