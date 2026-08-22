import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FRONTEND_ROOT = path.resolve(
  process.env.HARNESS_FRONTEND_ROOT || DEFAULT_FRONTEND_ROOT,
);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set([".next", "node_modules", "coverage"]);

export function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function sourceFiles() {
  const roots = ["app", "components", "features", "hooks", "lib"];
  const files = [];

  function visit(absolutePath) {
    if (!existsSync(absolutePath)) return;
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(path.basename(absolutePath))) return;
      for (const name of readdirSync(absolutePath).sort()) {
        visit(path.join(absolutePath, name));
      }
      return;
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(absolutePath)) || absolutePath.endsWith(".d.ts")) return;
    files.push({
      absolutePath,
      path: toPosix(path.relative(FRONTEND_ROOT, absolutePath)),
      text: readFileSync(absolutePath, "utf8"),
    });
  }

  for (const root of roots) visit(path.join(FRONTEND_ROOT, root));
  return files;
}

export function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

export function lineEvidenceAt(text, index) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return normalizeEvidence(text.slice(start, end === -1 ? text.length : end));
}

export function normalizeEvidence(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function moduleSpecifiers(text) {
  const found = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      found.push({ specifier: match[1], index: match.index ?? 0 });
    }
  }

  return found.sort((a, b) => a.index - b.index || a.specifier.localeCompare(b.specifier));
}

export function resolveLocalModule(sourcePath, specifier) {
  if (specifier === "@") return "";
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (!specifier.startsWith(".")) return null;
  return toPosix(path.normalize(path.join(path.dirname(sourcePath), specifier)));
}

export function violation(rule, file, evidence, line, message) {
  return {
    rule,
    file,
    evidence: normalizeEvidence(evidence),
    line,
    message,
  };
}

function fingerprint(item) {
  return createHash("sha256")
    .update(`${item.rule}\0${item.file}\0${item.evidence}`)
    .digest("hex");
}

function groupedViolations(violations) {
  const grouped = new Map();
  for (const item of violations) {
    const key = fingerprint(item);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.lines.push(item.line);
      continue;
    }
    grouped.set(key, {
      fingerprint: key,
      rule: item.rule,
      file: item.file,
      evidence: item.evidence,
      count: 1,
      lines: [item.line],
      message: item.message,
    });
  }
  return [...grouped.values()].sort((a, b) =>
    a.rule.localeCompare(b.rule) ||
    a.file.localeCompare(b.file) ||
    a.evidence.localeCompare(b.evidence),
  );
}

export function writeBaseline(baselinePath, violations, label) {
  if (process.env.ALLOW_HARNESS_BASELINE_UPDATE !== "1") {
    throw new Error(
      "baseline updates require ALLOW_HARNESS_BASELINE_UPDATE=1 and an explicitly reviewed migration",
    );
  }

  const records = groupedViolations(violations).map(({ message: _message, lines: _lines, ...record }) => record);
  const payload = {
    version: 1,
    label,
    policy: "Existing debt only. New fingerprints or increased occurrences fail verification.",
    violations: records,
  };
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Updated ${path.relative(FRONTEND_ROOT, baselinePath)} with ${violations.length} legacy violation(s).`);
}

export function checkAgainstBaseline({ baselinePath, violations, label }) {
  if (!existsSync(baselinePath)) {
    console.error(`${label}: baseline is missing: ${path.relative(FRONTEND_ROOT, baselinePath)}`);
    console.error("Create it only after review with ALLOW_HARNESS_BASELINE_UPDATE=1 and --write-baseline.");
    return 1;
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (error) {
    console.error(`${label}: could not read baseline: ${error.message}`);
    return 1;
  }

  if (parsed.version !== 1 || !Array.isArray(parsed.violations)) {
    console.error(`${label}: unsupported baseline format.`);
    return 1;
  }

  const current = groupedViolations(violations);
  const baseline = new Map(parsed.violations.map((item) => [item.fingerprint, item]));
  const currentMap = new Map(current.map((item) => [item.fingerprint, item]));
  const additions = [];
  let resolved = 0;

  for (const item of current) {
    const allowed = baseline.get(item.fingerprint)?.count ?? 0;
    if (item.count > allowed) additions.push({ ...item, added: item.count - allowed });
  }

  for (const item of parsed.violations) {
    const count = currentMap.get(item.fingerprint)?.count ?? 0;
    if (count < item.count) resolved += item.count - count;
  }

  const byRule = new Map();
  for (const item of violations) byRule.set(item.rule, (byRule.get(item.rule) ?? 0) + 1);
  const summary = [...byRule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, count]) => `${rule}=${count}`)
    .join(", ");

  if (additions.length === 0) {
    console.log(
      `${label}: passed (${violations.length} baselined violation(s), ${resolved} resolved${summary ? `; ${summary}` : ""}).`,
    );
    return 0;
  }

  console.error(`${label}: ${additions.reduce((sum, item) => sum + item.added, 0)} new violation(s):`);
  for (const item of additions.slice(0, 80)) {
    const location = `${item.file}:${Math.min(...item.lines)}`;
    console.error(`  [${item.rule}] ${location} ${item.message}`);
    console.error(`    ${item.evidence}`);
    if (item.added > 1) console.error(`    +${item.added} occurrence(s) above the baseline`);
  }
  if (additions.length > 80) console.error(`  … ${additions.length - 80} more fingerprint(s)`);
  console.error("Reuse or extend a canonical module. Do not update the baseline for ordinary feature work.");
  return 1;
}
