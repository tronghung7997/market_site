import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

pytestmark = pytest.mark.no_db

SERVICE_ROOT = Path(__file__).resolve().parents[1]
CHECKER = SERVICE_ROOT / "scripts" / "check_architecture.py"


def put(root: Path, relative_path: str, contents: str) -> None:
    target = root / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(contents, encoding="utf8")


def run_checker(
    root: Path,
    baseline: Path,
    *,
    write_baseline: bool = False,
    allow_baseline_update: bool = False,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop("ALLOW_HARNESS_BASELINE_UPDATE", None)
    env.update(
        HARNESS_BACKEND_ROOT=str(root),
        HARNESS_BACKEND_BASELINE=str(baseline),
    )
    if allow_baseline_update:
        env["ALLOW_HARNESS_BASELINE_UPDATE"] = "1"

    args = [sys.executable, str(CHECKER)]
    if write_baseline:
        args.append("--write-baseline")
    return subprocess.run(
        args,
        cwd=SERVICE_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def checker_output(result: subprocess.CompletedProcess[str]) -> str:
    return f"{result.stdout}\n{result.stderr}"


def test_architecture_guard_baselines_existing_debt_and_rejects_new_debt(tmp_path: Path):
    root = tmp_path / "backend"
    baseline = root / "scripts" / "architecture-baseline.json"
    put(
        root,
        "src/products/service.py",
        "from fastapi import HTTPException\n",
    )
    baseline.parent.mkdir(parents=True)

    created = run_checker(
        root,
        baseline,
        write_baseline=True,
        allow_baseline_update=True,
    )
    assert created.returncode == 0, checker_output(created)
    assert json.loads(baseline.read_text(encoding="utf8"))["violations"]

    unchanged = run_checker(root, baseline)
    assert unchanged.returncode == 0, checker_output(unchanged)
    assert "passed" in checker_output(unchanged)

    put(
        root,
        "src/products/router.py",
        "from src.adapters.factory import get_adapter\n",
    )
    increased = run_checker(root, baseline)
    assert increased.returncode != 0, checker_output(increased)
    assert "new violation" in checker_output(increased)
    assert "router-adapter-import" in checker_output(increased)

    put(root, "src/products/service.py", "async def execute() -> None:\n    return None\n")
    (root / "src/products/router.py").unlink()
    reduced = run_checker(root, baseline)
    assert reduced.returncode == 0, checker_output(reduced)
    assert "resolved" in checker_output(reduced)


def test_architecture_guard_refuses_unapproved_baseline_rewrite(tmp_path: Path):
    root = tmp_path / "backend"
    baseline = root / "scripts" / "architecture-baseline.json"
    put(root, "src/products/service.py", "async def execute() -> None:\n    return None\n")
    baseline.parent.mkdir(parents=True)

    result = run_checker(root, baseline, write_baseline=True)
    assert result.returncode != 0, checker_output(result)
    assert "ALLOW_HARNESS_BASELINE_UPDATE=1" in checker_output(result)


def test_architecture_guard_fails_closed_for_malformed_baseline(tmp_path: Path):
    root = tmp_path / "backend"
    baseline = root / "scripts" / "architecture-baseline.json"
    put(root, "src/products/service.py", "async def execute() -> None:\n    return None\n")
    baseline.parent.mkdir(parents=True)
    baseline.write_text("{not-json", encoding="utf8")

    result = run_checker(root, baseline)
    assert result.returncode != 0, checker_output(result)
    assert "invalid baseline" in checker_output(result)
