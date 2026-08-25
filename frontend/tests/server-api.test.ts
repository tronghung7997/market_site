import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveServerApiBase } from "../lib/server-api.ts";

function sourceFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [fileURLToPath(child)] : [];
  });
}

test("the build-time production upstream wins over a stale runtime API_URL", () => {
  assert.equal(
    resolveServerApiBase("http://marketplace-svc:8001/", "http://localhost:8001"),
    "http://marketplace-svc:8001",
  );
});

test("server API resolution falls back to runtime configuration and then local development", () => {
  assert.equal(resolveServerApiBase(undefined, "https://api.example.com/"), "https://api.example.com");
  assert.equal(resolveServerApiBase(undefined, undefined), "http://localhost:8001");
});

test("blank environment values do not override a usable upstream", () => {
  assert.equal(resolveServerApiBase(" ", "https://api.example.com"), "https://api.example.com");
});

test("app and library code cannot bypass the shared server API resolver", () => {
  const roots = [new URL("../app/", import.meta.url), new URL("../lib/", import.meta.url)];
  const resolver = fileURLToPath(new URL("../lib/server-api.ts", import.meta.url));
  const offenders = roots
    .flatMap(sourceFiles)
    .filter((path) => path !== resolver)
    .filter((path) => /process\.env\.(?:BUILT_API_URL|API_URL)/.test(readFileSync(path, "utf8")));

  assert.deepEqual(offenders, []);
});
