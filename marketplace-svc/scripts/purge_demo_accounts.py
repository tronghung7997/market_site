"""CLI: vô hiệu hoá account demo seed (email chứa cả dxtrade và example).

Mặc định DRY-RUN. Thêm --apply mới thực thi.

HTTP one-shot (curl sau deploy): POST /internal/ops/purge-demo-accounts
(chỉ cần X-Internal-Key).

Usage:

  docker compose exec marketplace-svc \\
    uv run python scripts/purge_demo_accounts.py

  docker compose exec marketplace-svc \\
    uv run python scripts/purge_demo_accounts.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.database import SessionLocal  # noqa: E402
from src.ops.purge_demo import purge_demo_accounts  # noqa: E402


async def _run(*, apply: bool, hard: bool, force: bool) -> int:
    async with SessionLocal() as db:
        result = await purge_demo_accounts(
            db, apply=apply, hard=hard, force=force, mark_one_shot=False,
        )
        if result.accounts:
            print(f"Tìm thấy / xử lý {len(result.accounts)} account:")
            for a in result.accounts:
                print(f"  {a}")
        print(result.message)
        if result.status == "aborted_no_admin":
            await db.rollback()
            return 2
        if apply and result.status in {"applied", "empty"}:
            await db.commit()
            return 0
        await db.rollback()
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Ghi DB (mặc định dry-run)")
    parser.add_argument("--hard", action="store_true", help="DELETE row (dễ fail FK)")
    parser.add_argument("--force", action="store_true", help="Cho phép khi không còn admin khác")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(apply=args.apply, hard=args.hard, force=args.force)))


if __name__ == "__main__":
    main()
