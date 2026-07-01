import secrets
import string

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account

_ALPHABET = string.ascii_uppercase + string.digits
_CODE_LENGTH = 8
_MAX_ATTEMPTS = 5


def generate_affiliate_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LENGTH))


async def generate_unique_affiliate_code(db: AsyncSession) -> str:
    for _ in range(_MAX_ATTEMPTS):
        code = generate_affiliate_code()
        exists = await db.scalar(select(Account.id).where(Account.affiliate_code == code))
        if not exists:
            return code
    raise RuntimeError(
        f"could not generate a unique affiliate_code after {_MAX_ATTEMPTS} attempts"
    )
