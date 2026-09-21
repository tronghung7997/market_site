"""Synthetic reviewer identities.

Seeded reviews still need a buyer row, because a review belongs to an order and
an order belongs to an account. Those accounts must not be usable as accounts:

* ``@seed.invalid`` — RFC 2606 reserves ``.invalid``, so the address can never
  resolve or receive mail, and can never collide with a real signup.
* ``is_active = False`` and an unusable password hash — login is impossible even
  if a password reset were somehow attempted.
* ``is_seeded = True`` — excluded from admin account lists, user counts,
  affiliate attribution and every financial report.

Publicly they surface only through ``reviews.service.mask_reviewer`` ("ng***n"),
exactly like a real buyer.
"""
from __future__ import annotations

import random
import secrets

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account

SEED_EMAIL_DOMAIN = "seed.invalid"
# Never a valid bcrypt/argon hash, so no password can ever verify against it.
UNUSABLE_PASSWORD_HASH = "!seeded-no-login"

# Local parts are what mask_reviewer turns into "ng***n", so they must look
# like Vietnamese account names rather than "user1".
_GIVEN = (
    "nguyenvan", "tranthi", "lehoang", "phamminh", "hoangan", "vuquang",
    "dangkhoa", "buitrang", "dothanh", "ngothuy", "duytan", "haiyen",
    "minhduc", "quocbao", "thanhtung", "kimngan", "vanloc", "phuonganh",
    "trungkien", "myhanh", "giabao", "tuananh", "ngochuyen", "dinhphuc",
)


async def _unique_email(db: AsyncSession) -> str:
    for _ in range(12):
        candidate = f"{random.choice(_GIVEN)}{secrets.token_hex(3)}@{SEED_EMAIL_DOMAIN}"
        exists = await db.scalar(select(Account.id).where(Account.email == candidate))
        if exists is None:
            return candidate
    # Fall back to a collision-proof name rather than failing the batch.
    return f"seed{secrets.token_hex(8)}@{SEED_EMAIL_DOMAIN}"


async def get_or_create_pool(db: AsyncSession, *, size: int) -> list[Account]:
    """Return ``size`` seeded accounts, reusing existing ones first.

    Reuse matters: a storefront where every review comes from a first-time
    buyer is its own tell, and an unbounded pool would bloat the accounts table
    one batch at a time.
    """
    existing = list((await db.execute(
        select(Account).where(Account.is_seeded.is_(True)).order_by(func.random()).limit(size)
    )).scalars())

    created: list[Account] = []
    for _ in range(max(0, size - len(existing))):
        account = Account(
            email=await _unique_email(db),
            password_hash=UNUSABLE_PASSWORD_HASH,
            roles=["buyer"],
            is_active=False,
            is_seeded=True,
        )
        db.add(account)
        created.append(account)

    if created:
        await db.flush()
    return existing + created


async def pool_size(db: AsyncSession) -> int:
    return int(await db.scalar(
        select(func.count(Account.id)).where(Account.is_seeded.is_(True))
    ) or 0)
