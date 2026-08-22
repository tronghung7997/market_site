import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkAgainstBaseline,
  lineEvidenceAt,
  lineNumberAt,
  moduleSpecifiers,
  sourceFiles,
  violation,
  writeBaseline,
} from "./harness-utils.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.resolve(
  process.env.HARNESS_DESIGN_BASELINE || path.join(SCRIPT_DIR, "design-system-baseline.json"),
);
const WRITE_BASELINE = process.argv.includes("--write-baseline");

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\s*\(|\boklch\s*\(/g;
const PALETTE_UTILITY = /(?:^|[^a-zA-Z0-9_-])(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|accent|caret|decoration|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[0-9]{2,3})(?:\/[0-9]{1,3})?\b|(?:^|[^a-zA-Z0-9_-])(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|accent|caret|decoration|placeholder)-(?:white|black)(?:\/[0-9]{1,3})?\b/g;
const RAW_CONTROL = /<(?:button|input|select|textarea)(?=[\s>])/g;
const PRIMITIVE_DECLARATION = /\bexport\s+(?:(?:default\s+)?function|const|class)\s+(Button|Card|Input|Textarea|Select|Dialog|Badge)\b/g;
const CANONICAL_UI_FILES = new Set(["components/ui.tsx"]);
const ALLOWED_UI_SUBPATHS = new Set([
  "@/components/ui/dialog",
  "@/components/ui/tooltip",
]);

function isCanonicalUiFile(file) {
  return CANONICAL_UI_FILES.has(file.path) || file.path.startsWith("components/ui/");
}

function collectViolations() {
  const violations = [];

  for (const file of sourceFiles()) {
    for (const match of file.text.matchAll(RAW_COLOR)) {
      violations.push(violation(
        "raw-color",
        file.path,
        lineEvidenceAt(file.text, match.index ?? 0),
        lineNumberAt(file.text, match.index ?? 0),
        "Move raw colour values to app/globals.css and consume a semantic token.",
      ));
    }

    for (const match of file.text.matchAll(PALETTE_UTILITY)) {
      violations.push(violation(
        "framework-palette",
        file.path,
        lineEvidenceAt(file.text, match.index ?? 0),
        lineNumberAt(file.text, match.index ?? 0),
        "Use Proxora semantic utilities instead of a framework palette class.",
      ));
    }

    if (file.path.endsWith(".tsx") && !isCanonicalUiFile(file)) {
      for (const match of file.text.matchAll(RAW_CONTROL)) {
        violations.push(violation(
          "raw-control",
          file.path,
          lineEvidenceAt(file.text, match.index ?? 0),
          lineNumberAt(file.text, match.index ?? 0),
          "Use a canonical control from @/components/ui or promote a missing variant.",
        ));
      }
    }

    if (!isCanonicalUiFile(file)) {
      for (const match of file.text.matchAll(PRIMITIVE_DECLARATION)) {
        violations.push(violation(
          "duplicate-primitive",
          file.path,
          lineEvidenceAt(file.text, match.index ?? 0),
          lineNumberAt(file.text, match.index ?? 0),
          `Do not declare another ${match[1]} primitive outside components/ui.`,
        ));
      }
    }

    for (const { specifier, index } of moduleSpecifiers(file.text)) {
      if (specifier === "lucide-react" && file.path !== "components/Icons.tsx") {
        violations.push(violation(
          "direct-icon-family",
          file.path,
          specifier,
          lineNumberAt(file.text, index),
          "Add the icon to @/components/Icons instead of importing another icon interface directly.",
        ));
      }

      if (specifier.startsWith("@/components/ui/") && !ALLOWED_UI_SUBPATHS.has(specifier)) {
        violations.push(violation(
          "ui-internal-import",
          file.path,
          specifier,
          lineNumberAt(file.text, index),
          "Import canonical primitives from the @/components/ui public interface.",
        ));
      }
    }
  }

  return violations;
}

const violations = collectViolations();
if (WRITE_BASELINE) {
  writeBaseline(BASELINE_PATH, violations, "frontend design-system guard");
  process.exit(0);
}

process.exit(checkAgainstBaseline({
  baselinePath: BASELINE_PATH,
  violations,
  label: "frontend design-system guard",
}));
