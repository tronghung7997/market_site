from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.alert import Alert


async def create_alert(type_: str, severity: str, target_type: str, target_id: int, message: str, db: AsyncSession) -> Alert:
    alert = Alert(type=type_, severity=severity, target_type=target_type, target_id=target_id, message=message)
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return alert


async def list_active_alerts(db: AsyncSession) -> list[Alert]:
    result = await db.execute(select(Alert).where(Alert.is_active).order_by(Alert.created_at.desc()))
    return list(result.scalars().all())


async def dismiss_alert(alert_id: int, db: AsyncSession) -> Alert:
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Không tìm thấy cảnh báo")
    alert.is_active = False
    await db.commit()
    await db.refresh(alert)
    return alert


async def list_seller_alerts(seller_id: int, db: AsyncSession) -> list[Alert]:
    result = await db.execute(
        select(Alert).where(Alert.is_active, Alert.target_type == "seller", Alert.target_id == seller_id)
        .order_by(Alert.created_at.desc())
    )
    return list(result.scalars().all())
