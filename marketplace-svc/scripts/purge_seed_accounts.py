"""CLI: retire test/seed accounts without breaking the ledger (src/ops/retire_seed.py).

--zero: available balance booked out as a ``seed-writeoff`` adjustment_debit.
--seed: accounts flagged is_seeded, their products suspended.
Always: reviews of seeded orders hidden, ratings + sold figures recomputed.

One transaction, refused unless the reconcile is clean before and after.
Default is a DRY-RUN that prints the plan and rolls back; add --apply to commit.

    uv run python scripts/purge_seed_accounts.py --zero 1,2,3,4,7,8,13 --seed 1,2,3,4,7 --actor 18
    uv run python scripts/purge_seed_accounts.py --zero 1,2,3,4,7,8,13 --seed 1,2,3,4,7 --actor 18 --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # noqa: E402 — run as a plain script

from src.database import SessionLocal  # noqa: E402
from src.ledger.service import reconcile_ledger  # noqa: E402
from src.ops.retire_seed import retire_seed_accounts  # noqa: E402


def _ids(raw: str) -> list[int]:
    return [int(x) for x in raw.split(",") if x.strip()]


async def _run(*, zero: list[int], seed: list[int], actor: int, apply: bool) -> int:
    async with SessionLocal() as db:
        before = await reconcile_ledger(db)
        print(f"reconcile before: findings={len(before.findings)} held={before.totals['held_total']:,}")
        if before.findings:
            print("refusing: the ledger already has findings — fix those first")
            return 1
        result = await retire_seed_accounts(db, zero=zero, seed=seed, actor_id=actor)
        for account_id, amount in result["debits"].items():
            print(f"  #{account_id}: debit {amount:,}")
        print(f"  accounts seeded: {seed}; products suspended: {len(result['suspended'])} {result['suspended']}")
        print(f"  reviews hidden: {result['reviews_hidden']} on {result['rated_products']} products")
        print(f"  sold_count recomputed on {result['sold_recomputed']} products")
        after = await reconcile_ledger(db)
        print(f"reconcile after: findings={len(after.findings)} held={after.totals['held_total']:,}")
        if after.findings:
            for f in after.findings:
                print("   ", f)
            await db.rollback()
            print("rolled back: reconcile not clean")
            return 1
        if apply:
            await db.commit()
            print("APPLIED")
        else:
            await db.rollback()
            print("DRY-RUN — rolled back. Add --apply to commit.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--zero", required=True, help="account ids whose available balance is written off to 0")
    parser.add_argument("--seed", default="", help="account ids flagged is_seeded (products suspended)")
    parser.add_argument("--actor", type=int, required=True, help="admin account id recorded in the audit log")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    sys.exit(asyncio.run(_run(zero=_ids(args.zero), seed=_ids(args.seed), actor=args.actor, apply=args.apply)))


if __name__ == "__main__":
    main()
