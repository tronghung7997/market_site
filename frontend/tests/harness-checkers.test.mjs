import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESIGN_CHECKER = path.join(FRONTEND_ROOT, "scripts/check-design-system.mjs");
const MODULE_CHECKER = path.join(FRONTEND_ROOT, "scripts/check-module-boundaries.mjs");

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "proxora-frontend-harness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function put(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

function runChecker({ checker, root, baseline, args = [], allowBaselineUpdate = false }) {
  const env = {
    ...process.env,
    HARNESS_FRONTEND_ROOT: root,
  };
  delete env.ALLOW_HARNESS_BASELINE_UPDATE;

  if (checker === DESIGN_CHECKER) env.HARNESS_DESIGN_BASELINE = baseline;
  if (checker === MODULE_CHECKER) env.HARNESS_MODULE_BASELINE = baseline;
  if (allowBaselineUpdate) env.ALLOW_HARNESS_BASELINE_UPDATE = "1";

  return spawnSync(process.execPath, [checker, ...args], {
    cwd: FRONTEND_ROOT,
    env,
    encoding: "utf8",
  });
}

function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}

test("design guard baselines existing debt, rejects new debt, and accepts debt removal", (t) => {
  const root = fixture(t);
  const baseline = path.join(root, "design-baseline.json");
  const legacyPath = "components/Legacy.tsx";
  put(
    root,
    legacyPath,
    'export function Legacy() { return <button className="bg-indigo-500 text-white">legacy</button>; }\n',
  );

  const created = runChecker({
    checker: DESIGN_CHECKER,
    root,
    baseline,
    args: ["--write-baseline"],
    allowBaselineUpdate: true,
  });
  assert.equal(created.status, 0, output(created));
  assert.ok(JSON.parse(readFileSync(baseline, "utf8")).violations.length > 0);

  const unchanged = runChecker({ checker: DESIGN_CHECKER, root, baseline });
  assert.equal(unchanged.status, 0, output(unchanged));
  assert.match(output(unchanged), /passed/);

  put(
    root,
    legacyPath,
    'import { Search } from "lucide-react";\n' +
      'export function Legacy() { return <button className="bg-indigo-500 text-white">legacy</button>; }\n',
  );
  const increased = runChecker({ checker: DESIGN_CHECKER, root, baseline });
  assert.notEqual(increased.status, 0, output(increased));
  assert.match(output(increased), /new violation/);
  assert.match(output(increased), /direct-icon-family/);

  put(root, legacyPath, "export function Clean() { return null; }\n");
  const reduced = runChecker({ checker: DESIGN_CHECKER, root, baseline });
  assert.equal(reduced.status, 0, output(reduced));
  assert.match(output(reduced), /resolved/);
});

test("design guard refuses an unapproved baseline rewrite", (t) => {
  const root = fixture(t);
  const baseline = path.join(root, "design-baseline.json");
  put(root, "components/Probe.tsx", "export function Probe() { return null; }\n");

  const result = runChecker({
    checker: DESIGN_CHECKER,
    root,
    baseline,
    args: ["--write-baseline"],
  });
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /baseline updates require ALLOW_HARNESS_BASELINE_UPDATE=1/);
});

test("module guard rejects a new dependency violation above its baseline", (t) => {
  const root = fixture(t);
  const baseline = path.join(root, "module-baseline.json");
  put(root, "app/page.tsx", 'import { api } from "@/lib/api";\nexport default function Page() { return null; }\n');

  const created = runChecker({
    checker: MODULE_CHECKER,
    root,
    baseline,
    args: ["--write-baseline"],
    allowBaselineUpdate: true,
  });
  assert.equal(created.status, 0, output(created));

  const unchanged = runChecker({ checker: MODULE_CHECKER, root, baseline });
  assert.equal(unchanged.status, 0, output(unchanged));

  put(
    root,
    "components/RemoteWidget.tsx",
    'import { api } from "@/lib/api";\nexport function RemoteWidget() { return null; }\n',
  );
  const increased = runChecker({ checker: MODULE_CHECKER, root, baseline });
  assert.notEqual(increased.status, 0, output(increased));
  assert.match(output(increased), /new violation/);
  assert.match(output(increased), /component-direct-api/);
});

test("guards fail closed when a baseline is malformed", (t) => {
  const root = fixture(t);
  const baseline = path.join(root, "module-baseline.json");
  put(root, "app/page.tsx", "export default function Page() { return null; }\n");
  writeFileSync(baseline, "{not-json", "utf8");

  const result = runChecker({ checker: MODULE_CHECKER, root, baseline });
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /could not read baseline/);
});
