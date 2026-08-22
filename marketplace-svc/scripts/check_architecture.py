#!/usr/bin/env python3
"""Baseline-aware architecture checks for the FastAPI service."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

DEFAULT_SERVICE_ROOT = Path(__file__).resolve().parents[1]
SERVICE_ROOT = Path(
    os.environ.get("HARNESS_BACKEND_ROOT", DEFAULT_SERVICE_ROOT)
).resolve()
SOURCE_ROOT = SERVICE_ROOT / "src"
BASELINE_PATH = Path(
    os.environ.get(
        "HARNESS_BACKEND_BASELINE",
        Path(__file__).with_name("architecture-baseline.json"),
    )
).resolve()


@dataclass(frozen=True)
class ImportedModule:
    module: str
    names: tuple[str, ...]
    line: int


@dataclass(frozen=True)
class Violation:
    rule: str
    file: str
    evidence: str
    line: int
    message: str

    @property
    def fingerprint(self) -> str:
        value = f"{self.rule}\0{self.file}\0{self.evidence}".encode()
        return hashlib.sha256(value).hexdigest()


def source_files() -> list[Path]:
    return sorted(
        path
        for path in SOURCE_ROOT.rglob("*.py")
        if "__pycache__" not in path.parts
    )


def resolve_relative_module(path: Path, node: ast.ImportFrom) -> str:
    if node.level == 0:
        return node.module or ""

    relative = path.relative_to(SERVICE_ROOT).with_suffix("")
    package = list(relative.parts[:-1])
    levels_up = max(node.level - 1, 0)
    if levels_up:
        package = package[:-levels_up]
    if node.module:
        package.extend(node.module.split("."))
    return ".".join(package)


def imported_modules(path: Path, tree: ast.AST) -> list[ImportedModule]:
    imports: list[ImportedModule] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            imports.append(
                ImportedModule(
                    module=resolve_relative_module(path, node),
                    names=tuple(sorted(alias.name for alias in node.names)),
                    line=node.lineno,
                )
            )
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(
                    ImportedModule(module=alias.name, names=(), line=node.lineno)
                )
    return sorted(imports, key=lambda item: (item.line, item.module, item.names))


def source_feature(relative: str) -> str | None:
    parts = Path(relative).parts
    if len(parts) >= 3 and parts[0] == "src":
        return parts[1]
    return None


def target_feature(module: str) -> str | None:
    parts = module.split(".")
    if len(parts) >= 2 and parts[0] == "src":
        return parts[1]
    return None


def evidence(item: ImportedModule) -> str:
    names = ",".join(item.names)
    return f"{item.module}:{names}" if names else item.module


def collect_violations() -> list[Violation]:
    violations: list[Violation] = []

    for path in source_files():
        relative = path.relative_to(SERVICE_ROOT).as_posix()
        try:
            tree = ast.parse(path.read_text(encoding="utf8"), filename=relative)
        except SyntaxError as error:
            violations.append(
                Violation(
                    rule="python-syntax",
                    file=relative,
                    evidence=str(error.msg),
                    line=error.lineno or 1,
                    message="Fix Python syntax before architecture verification.",
                )
            )
            continue

        filename = path.name
        feature = source_feature(relative)

        for item in imported_modules(path, tree):
            module = item.module
            imported_feature = target_feature(module)
            item_evidence = evidence(item)

            if filename == "service.py" and (
                module.endswith(".router") or ".router." in module
            ):
                violations.append(
                    Violation(
                        rule="service-router-import",
                        file=relative,
                        evidence=item_evidence,
                        line=item.line,
                        message="Application/domain services must not depend on HTTP routers.",
                    )
                )

            if filename == "schemas.py" and (
                module.endswith(".router")
                or module.endswith(".service")
                or ".router." in module
                or ".service." in module
            ):
                violations.append(
                    Violation(
                        rule="schema-implementation-import",
                        file=relative,
                        evidence=item_evidence,
                        line=item.line,
                        message="Transport schemas must not depend on router or service implementations.",
                    )
                )

            if relative.startswith("src/models/") and (
                module == "fastapi"
                or module.startswith("fastapi.")
                or module.endswith(".router")
                or module.endswith(".service")
                or ".router." in module
                or ".service." in module
            ):
                violations.append(
                    Violation(
                        rule="model-upward-import",
                        file=relative,
                        evidence=item_evidence,
                        line=item.line,
                        message="Persistence models must not depend on transport or feature implementations.",
                    )
                )

            if filename == "router.py" and feature and imported_feature:
                if module.startswith("src.adapters"):
                    violations.append(
                        Violation(
                            rule="router-adapter-import",
                            file=relative,
                            evidence=item_evidence,
                            line=item.line,
                            message="Move provider/adapter orchestration behind the owning service interface.",
                        )
                    )
                elif (
                    imported_feature != feature
                    and (module.endswith(".service") or ".service." in module)
                ):
                    violations.append(
                        Violation(
                            rule="router-cross-feature-service",
                            file=relative,
                            evidence=item_evidence,
                            line=item.line,
                            message="Cross-feature orchestration belongs in a service/module, not an HTTP router.",
                        )
                    )

            if relative != "src/main.py" and (
                module.endswith(".router") or ".router." in module
            ):
                violations.append(
                    Violation(
                        rule="non-composition-router-import",
                        file=relative,
                        evidence=item_evidence,
                        line=item.line,
                        message="Only the application composition root may assemble routers.",
                    )
                )

            if filename == "service.py" and (
                (module == "fastapi" and "HTTPException" in item.names)
                or module == "fastapi.exceptions"
            ):
                violations.append(
                    Violation(
                        rule="service-http-exception",
                        file=relative,
                        evidence=item_evidence,
                        line=item.line,
                        message="Raise a domain/application error and translate it at the HTTP seam.",
                    )
                )

            if module == "sqlalchemy.orm" and any(
                name in {"Session", "sessionmaker", "scoped_session"}
                for name in item.names
            ):
                violations.append(
                    Violation(
                        rule="sync-database-interface",
                        file=relative,
                        evidence=item_evidence,
                        line=item.line,
                        message="Request-path persistence must use AsyncSession and async I/O.",
                    )
                )

    return violations


def grouped(violations: list[Violation]) -> dict[str, tuple[Violation, int]]:
    counts = Counter(item.fingerprint for item in violations)
    examples: dict[str, Violation] = {}
    for item in violations:
        examples.setdefault(item.fingerprint, item)
    return {key: (examples[key], count) for key, count in counts.items()}


def write_baseline(violations: list[Violation]) -> int:
    if os.environ.get("ALLOW_HARNESS_BASELINE_UPDATE") != "1":
        print(
            "backend architecture guard: baseline updates require "
            "ALLOW_HARNESS_BASELINE_UPDATE=1 and explicit review."
        )
        return 1

    records = []
    for fingerprint, (item, count) in sorted(
        grouped(violations).items(),
        key=lambda entry: (
            entry[1][0].rule,
            entry[1][0].file,
            entry[1][0].evidence,
        ),
    ):
        records.append(
            {
                "fingerprint": fingerprint,
                "rule": item.rule,
                "file": item.file,
                "evidence": item.evidence,
                "count": count,
            }
        )

    payload = {
        "version": 1,
        "label": "backend architecture guard",
        "policy": "Existing debt only. New fingerprints or increased occurrences fail verification.",
        "violations": records,
    }
    BASELINE_PATH.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf8")
    print(
        f"Updated {BASELINE_PATH.relative_to(SERVICE_ROOT)} with "
        f"{len(violations)} legacy violation(s)."
    )
    return 0


def check(violations: list[Violation]) -> int:
    if not BASELINE_PATH.exists():
        print(f"backend architecture guard: missing {BASELINE_PATH.relative_to(SERVICE_ROOT)}")
        return 1

    try:
        baseline_data = json.loads(BASELINE_PATH.read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"backend architecture guard: invalid baseline: {error}")
        return 1

    if baseline_data.get("version") != 1 or not isinstance(
        baseline_data.get("violations"), list
    ):
        print("backend architecture guard: unsupported baseline format.")
        return 1

    current = grouped(violations)
    baseline = {
        item["fingerprint"]: item for item in baseline_data["violations"]
    }
    additions: list[tuple[Violation, int]] = []
    resolved = 0

    for fingerprint, (item, count) in current.items():
        allowed = int(baseline.get(fingerprint, {}).get("count", 0))
        if count > allowed:
            additions.append((item, count - allowed))

    for fingerprint, item in baseline.items():
        count = current.get(fingerprint, (None, 0))[1]
        if count < int(item["count"]):
            resolved += int(item["count"]) - count

    rules = Counter(item.rule for item in violations)
    summary = ", ".join(f"{rule}={rules[rule]}" for rule in sorted(rules))

    if not additions:
        suffix = f"; {summary}" if summary else ""
        print(
            f"backend architecture guard: passed ({len(violations)} baselined "
            f"violation(s), {resolved} resolved{suffix})."
        )
        return 0

    additions.sort(key=lambda entry: (entry[0].rule, entry[0].file, entry[0].line))
    print(
        "backend architecture guard: "
        f"{sum(count for _, count in additions)} new violation(s):"
    )
    for item, count in additions[:80]:
        print(f"  [{item.rule}] {item.file}:{item.line} {item.message}")
        print(f"    {item.evidence}")
        if count > 1:
            print(f"    +{count} occurrence(s) above the baseline")
    if len(additions) > 80:
        print(f"  … {len(additions) - 80} more fingerprint(s)")
    print("Deepen the owning module; do not update the baseline for ordinary feature work.")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="Replace the reviewed legacy baseline (requires ALLOW_HARNESS_BASELINE_UPDATE=1).",
    )
    args = parser.parse_args()
    violations = collect_violations()
    return write_baseline(violations) if args.write_baseline else check(violations)


if __name__ == "__main__":
    raise SystemExit(main())
