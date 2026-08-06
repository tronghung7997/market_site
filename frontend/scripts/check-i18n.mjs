import { readFileSync } from "node:fs";

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

console.log("i18n message catalog is valid and released namespaces have EN/VI parity.");
