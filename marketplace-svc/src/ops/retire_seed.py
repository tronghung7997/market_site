"""Retire test/seed accounts without breaking the ledger.

Used by scripts/purge_seed_accounts.py. Never commits: the caller checks the
result (reconcile before/after) and commits or rolls back.

- ``zero``: each wallet's whole available balance is booked out as an
  ``adjustment_debit`` (wallet row locked, audit ``manual_debit``) with
  reference ``seed-writeoff:account-<id>``; the period P&L leaves those rows
  out (ledger.report), the balance check and reconcile still count them.
  Locked/held money is never touched. Nothing is deleted or rewritten.
- ``seed``: ``accounts.is_seeded = true`` and their products ``suspended``.
- Always: reviews of seeded orders are hidden, ratings and sold figures are
  recomputed from real (non-seeded) data.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.ledger.journal import SEED_WRITEOFF_REF_PREFIX
from src.models.account import Account
from src.models.order import Order
from src.models.product import Product, ProductStatus
from src.models.review import Review
from src.models.wallet import Transaction, TransactionType, Wallet
from src.reviews.service import refresh_product_rating

REASON = "huỷ tiền tài khoản test/seed"

# Same definition as migration gu1a2b3c4d5e6 / models.order._count_completed_sale.
_REAL_SOLD = text("""
    UPDATE products p SET sold_count = COALESCE(s.units, 0)
    FROM products p2
    LEFT JOIN (
        SELECT COALESCE(o.product_id, v.product_id) AS product_id,
               SUM(CASE WHEN o.variant_id IS NOT NULL THEN GREATEST(o.quantity, 1) ELSE 1 END) AS units
        FROM orders o LEFT JOIN product_variants v ON v.id = o.variant_id
        WHERE o.status = 'completed' AND o.is_seeded IS NOT TRUE
        GROUP BY COALESCE(o.product_id, v.product_id)
    ) s ON s.product_id = p2.id
    WHERE p.id = p2.id AND p.sold_count IS DISTINCT FROM COALESCE(s.units, 0)
""")


async def retire_seed_accounts(db: AsyncSession, *, zero: list[int], seed: list[int], actor_id: int) -> dict:
    debits: dict[int, int] = {}
    for account_id in zero:
        wallet = (await db.execute(
            select(Wallet).where(Wallet.account_id == account_id).with_for_update()
        )).scalar_one_or_none()
        if wallet is None or wallet.available_balance <= 0:
            debits[account_id] = 0
            continue
        amount = wallet.available_balance
        debits[account_id] = amount
        wallet.available_balance -= amount
        db.add(Transaction(
            wallet_id=wallet.id, type=TransactionType.adjustment_debit, amount=amount,
            description=f"GMMO trừ tiền — {REASON}", reference_id=f"{SEED_WRITEOFF_REF_PREFIX}account-{account_id}",
        ))
        await log_event(db, "warning", f"Admin debit {amount:,}đ from account {account_id}".replace(",", "."),
                        metadata={"event": "manual_debit", "actor_id": actor_id, "actor_type": "admin",
                                  "subject_type": "account", "subject_id": account_id, "outcome": "success",
                                  "source": "script:purge_seed_accounts", "amount": amount, "reason": REASON})

    suspended: list[int] = []
    if seed:
        await db.execute(update(Account).where(Account.id.in_(seed)).values(is_seeded=True))
        suspended = sorted((await db.execute(
            update(Product).where(Product.seller_id.in_(seed), Product.status != ProductStatus.suspended)
            .values(status=ProductStatus.suspended).returning(Product.id)
        )).scalars().all())
        await log_event(db, "warning", f"Accounts {seed} retired as seed data",
                        metadata={"event": "seed_accounts_retired", "actor_id": actor_id, "actor_type": "admin",
                                  "account_ids": seed, "product_ids_suspended": suspended,
                                  "source": "script:purge_seed_accounts"})

    hidden_on = (await db.execute(
        update(Review).where(Review.is_hidden.is_(False), or_(
            Review.is_seeded.is_(True),
            Review.order_id.in_(select(Order.id).where(Order.is_seeded.is_(True))),
        ))
        .values(is_hidden=True, hidden_reason="Dữ liệu test/seed", hidden_by_id=actor_id,
                hidden_at=datetime.now(timezone.utc))
        .returning(Review.product_id)
    )).scalars().all()
    for product_id in set(hidden_on):
        await refresh_product_rating(product_id, db)

    resold = (await db.execute(_REAL_SOLD)).rowcount or 0
    await db.flush()
    return {"debits": debits, "suspended": suspended, "reviews_hidden": len(hidden_on),
            "rated_products": len(set(hidden_on)), "sold_recomputed": resold}
