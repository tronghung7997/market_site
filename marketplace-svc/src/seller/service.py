from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account, ApplicationStatus, SellerApplication


async def apply_for_seller(account: Account, business_name: str, description: str | None, contact: str | None, db: AsyncSession) -> SellerApplication:
    if "seller" in account.roles:
        raise HTTPException(status_code=400, detail="Already a seller")
    existing = await db.scalar(
        select(SellerApplication).where(
            SellerApplication.account_id == account.id,
            SellerApplication.status == ApplicationStatus.pending,
        )
    )
    if existing:
        raise HTTPException(status_code=400, detail="Already have a pending application")
    app = SellerApplication(account_id=account.id, business_name=business_name, description=description, contact=contact)
    db.add(app)
    await db.commit()
    await db.refresh(app)
    return app


async def list_applications(db: AsyncSession) -> list[SellerApplication]:
    result = await db.execute(select(SellerApplication).order_by(SellerApplication.created_at.desc()))
    return list(result.scalars().all())


async def get_latest_application(account_id: int, db: AsyncSession) -> SellerApplication | None:
    return await db.scalar(
        select(SellerApplication)
        .where(SellerApplication.account_id == account_id)
        .order_by(SellerApplication.created_at.desc())
        .limit(1)
    )


async def approve_application(app_id: int, db: AsyncSession) -> SellerApplication:
    app = await db.get(SellerApplication, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.status != ApplicationStatus.pending:
        raise HTTPException(status_code=400, detail="Application already processed")
    app.status = ApplicationStatus.approved
    account = await db.get(Account, app.account_id)
    if "seller" not in account.roles:
        account.roles = [*account.roles, "seller"]
    await db.commit()
    await db.refresh(app)
    return app


async def reject_application(app_id: int, reason: str, db: AsyncSession) -> SellerApplication:
    app = await db.get(SellerApplication, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.status != ApplicationStatus.pending:
        raise HTTPException(status_code=400, detail="Application already processed")
    app.status = ApplicationStatus.rejected
    app.reject_reason = reason
    await db.commit()
    await db.refresh(app)
    return app
