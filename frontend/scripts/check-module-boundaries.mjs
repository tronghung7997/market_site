import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkAgainstBaseline,
  moduleSpecifiers,
  resolveLocalModule,
  sourceFiles,
  violation,
  writeBaseline,
  lineNumberAt,
} from "./harness-utils.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.resolve(
  process.env.HARNESS_MODULE_BASELINE || path.join(SCRIPT_DIR, "module-boundaries-baseline.json"),
);
const WRITE_BASELINE = process.argv.includes("--write-baseline");
const LEGACY_DOMAIN_COMPONENTS = [
  "components/admin/",
  "components/chat/",
  "components/home/",
  "components/orders/",
  "components/products/",
  "components/seller/",
];

function startsWithAny(value, prefixes) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function featureName(filePath) {
  const match = filePath.match(/^features\/([^/]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function isFeaturePublicInterface(target, targetFeature) {
  return target === `features/${targetFeature}` ||
    target === `features/${targetFeature}/index` ||
    target === `features/${targetFeature}/index.ts` ||
    target === `features/${targetFeature}/index.tsx`;
}

function collectViolations() {
  const violations = [];

  for (const file of sourceFiles()) {
    for (const { specifier, index } of moduleSpecifiers(file.text)) {
      const target = resolveLocalModule(file.path, specifier);
      if (target === null) continue;
      const line = lineNumberAt(file.text, index);

      if (
        (file.path === "components/ui.tsx" || file.path.startsWith("components/ui/")) &&
        startsWithAny(target, ["app/", "features/", "components/patterns/"])
      ) {
        violations.push(violation(
          "ui-upward-import",
          file.path,
          specifier,
          line,
          "UI primitives may depend on utilities, not app, feature, or product-pattern modules.",
        ));
      }

      if (
        file.path.startsWith("components/patterns/") &&
        startsWithAny(target, ["app/", "features/"])
      ) {
        violations.push(violation(
          "pattern-upward-import",
          file.path,
          specifier,
          line,
          "Product patterns may compose UI primitives but must not know routes or feature implementations.",
        ));
      }

      const sourceFeature = featureName(file.path);
      const targetFeature = featureName(target);
      if (sourceFeature && target.startsWith("app/")) {
        violations.push(violation(
          "feature-app-import",
          file.path,
          specifier,
          line,
          "Feature modules must not depend on the Next.js route layer.",
        ));
      }

      if (
        sourceFeature &&
        targetFeature &&
        sourceFeature !== targetFeature &&
        !isFeaturePublicInterface(target, targetFeature)
      ) {
        violations.push(violation(
          "feature-internal-import",
          file.path,
          specifier,
          line,
          `Import feature ${targetFeature} through its public index.ts interface.`,
        ));
      }

      if (
        file.path.startsWith("lib/") &&
        startsWithAny(target, ["app/", "features/", "components/"])
      ) {
        violations.push(violation(
          "lib-ui-import",
          file.path,
          specifier,
          line,
          "Infrastructure and pure lib modules must not depend on UI or route modules.",
        ));
      }

      if (file.path.startsWith("app/") && (target === "lib/api" || target === "lib/api.ts")) {
        violations.push(violation(
          "route-direct-api",
          file.path,
          specifier,
          line,
          "Move query/mutation ownership behind a feature module interface; routes should compose it.",
        ));
      }

      if (file.path.startsWith("components/") && (target === "lib/api" || target === "lib/api.ts")) {
        violations.push(violation(
          "component-direct-api",
          file.path,
          specifier,
          line,
          "Move data access and domain orchestration into a feature module.",
        ));
      }

      if (file.path.startsWith("app/") && startsWithAny(target, LEGACY_DOMAIN_COMPONENTS)) {
        violations.push(violation(
          "route-legacy-domain-component",
          file.path,
          specifier,
          line,
          "New route composition should consume a feature public interface, not legacy domain components.",
        ));
      }

      if (file.path.startsWith("app/") && target.startsWith("hooks/")) {
        violations.push(violation(
          "route-legacy-hook",
          file.path,
          specifier,
          line,
          "New route composition should consume data behavior from a feature public interface.",
        ));
      }
    }
  }

  return violations;
}

const violations = collectViolations();
if (WRITE_BASELINE) {
  writeBaseline(BASELINE_PATH, violations, "frontend module-boundary guard");
  process.exit(0);
}

process.exit(checkAgainstBaseline({
  baselinePath: BASELINE_PATH,
  violations,
  label: "frontend module-boundary guard",
}));
