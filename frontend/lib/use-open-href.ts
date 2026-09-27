"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";

/** Follow a notification's href. On the page it already points at, pages
 *  that listen for `app:notification-click` re-open their target (an order
 *  modal) without a navigation. */
export function useOpenHref(): (href: string) => void {
  const pathname = usePathname();
  const router = useRouter();
  return useCallback((href: string) => {
    const destination = new URL(href, window.location.origin);
    const destPath = destination.pathname.replace(/^\/(?:en|vi)(?=\/|$)/, "") || "/";
    window.dispatchEvent(new CustomEvent("app:notification-click", { detail: { href } }));
    if (destPath === pathname && destination.search) {
      window.history.replaceState(null, "", href);
      return;
    }
    router.push(href);
  }, [pathname, router]);
}
