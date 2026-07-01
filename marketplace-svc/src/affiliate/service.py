from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account
from src.models.affiliate import AffiliateClick


async def record_click(code: str, db: AsyncSession, path: str | None = None, referrer: str | None = None) -> None:
    affiliate = await db.scalar(select(Account).where(Account.affiliate_code == code))
    if not affiliate:
        return
    db.add(
        AffiliateClick(
            affiliate_account_id=affiliate.id,
            path=path,
            referrer=referrer,
        )
    )
    await db.commit()
