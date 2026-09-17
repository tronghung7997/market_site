import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const requiredNamespaces = ["common", "home", "labels", "status", "errors"];
const messages = Object.fromEntries(["en", "vi"].map((locale) => [
  locale,
  JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")),
]));

function paths(value, prefix = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) => paths(child, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

for (const namespace of requiredNamespaces) {
  for (const locale of ["en", "vi"]) {
    if (!(namespace in messages[locale])) throw new Error(`Missing ${namespace} namespace in ${locale}.json`);
  }
  const en = new Set(paths(messages.en[namespace]));
  const vi = new Set(paths(messages.vi[namespace]));
  const missing = [...en].filter((key) => !vi.has(key)).concat([...vi].filter((key) => !en.has(key)));
  if (missing.length) throw new Error(`${namespace} key parity failed: ${missing.join(", ")}`);
}

// --- Client message scopes -------------------------------------------------
// The root layout ships only storefront namespaces to the browser; seller and
// admin layouts add theirs (see i18n/client-messages.ts). A client component
// outside those trees that reads a scoped namespace would render raw keys on
// production, so it fails here instead.
const SELLER_NAMESPACES = ["seller", "sellerDashboard", "sellerInventory", "sellerOrders", "sellerProductForm", "sellerProducts"];
const isScoped = (ns) => SELLER_NAMESPACES.includes(ns) || ns.startsWith("admin");
const SCOPED_TREES = [
  "app/[locale]/seller", "app/[locale]/admin",
  "features/seller-", "features/admin-",
  "components/seller/", "components/admin/",
];
// Seller-only editors that live under components/ but are imported solely by
// seller/admin pages. Add here only after checking every importer.
const SCOPED_COMPONENTS = new Set([
  "components/PricingParamsEditor.tsx",
  "components/products/ProductLanguageRail.tsx",
  "components/products/ProductPricingLabelsEditor.tsx",
]);
const root = new URL("..", import.meta.url).pathname;

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

const violations = [];
for (const top of ["app", "components", "features", "lib"]) {
  for (const file of sourceFiles(join(root, top))) {
    const rel = relative(root, file);
    if (SCOPED_TREES.some((tree) => rel.startsWith(tree)) || SCOPED_COMPONENTS.has(rel)) continue;
    const source = readFileSync(file, "utf8");
    if (!/^\s*["']use client["']/m.test(source)) continue;
    for (const match of source.matchAll(/useTranslations\(\s*["']([A-Za-z0-9_]+)/g)) {
      if (isScoped(match[1])) violations.push(`${rel}: useTranslations("${match[1]}") is not shipped to storefront pages`);
    }
  }
}
if (violations.length) {
  throw new Error(`Client message scope violations:\n  ${violations.join("\n  ")}\n(move the component under a seller/admin tree, or list it in SCOPED_COMPONENTS after checking its importers)`);
}

console.log("i18n message catalog is valid, released namespaces have EN/VI parity, client message scopes hold.");
