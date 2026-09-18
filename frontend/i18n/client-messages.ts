import type { AbstractIntlMessages } from "next-intl";

/**
 * Which message namespaces reach the browser.
 *
 * `NextIntlClientProvider` ships whatever it is given into every page's RSC
 * payload; left to its default it ships the whole catalog — ~200 KB of which
 * ~45 % is seller/admin copy a storefront visitor never renders. Each route
 * area therefore provides only the namespaces its client components use:
 *
 * - storefront + buyer routes: everything except seller/admin namespaces;
 * - seller routes: storefront + seller namespaces;
 * - admin routes: the full catalog.
 *
 * `scripts/check-i18n.mjs` fails the build when a client component outside
 * the seller/admin trees reaches for a scoped namespace, so a missing key
 * surfaces in CI rather than as a raw key on production.
 */
export const SELLER_NAMESPACES = [
  "seller", "sellerDashboard", "sellerInventory", "sellerOrders", "sellerProductForm", "sellerProducts",
] as const;

export const ADMIN_NAMESPACE_PREFIX = "admin";

export function isSellerNamespace(namespace: string): boolean {
  return (SELLER_NAMESPACES as readonly string[]).includes(namespace);
}

export function isAdminNamespace(namespace: string): boolean {
  return namespace.startsWith(ADMIN_NAMESPACE_PREFIX);
}

function without(messages: AbstractIntlMessages, drop: (namespace: string) => boolean): AbstractIntlMessages {
  return Object.fromEntries(Object.entries(messages).filter(([namespace]) => !drop(namespace)));
}

/** Storefront and buyer pages. */
export function storefrontMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return without(messages, (ns) => isSellerNamespace(ns) || isAdminNamespace(ns));
}

/** Seller console: storefront copy plus the seller namespaces. */
export function sellerMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return without(messages, isAdminNamespace);
}
