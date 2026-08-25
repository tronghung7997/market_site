from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account, ApplicationStatus, SellerApplication


async def apply_for_seller(account: Account, business_name: str, description: str | None, contact: str | None, db: AsyncSession) -> SellerApplication:
    from src.audit.service import log_event
    from src.logging import current_request_id

    if "seller" in account.roles:
        raise HTTPException(status_code=400, detail="Bạn đã là người bán")
    existing = await db.scalar(
        select(SellerApplication).where(
            SellerApplication.account_id == account.id,
            SellerApplication.status == ApplicationStatus.pending,
        )
    )
    if existing:
        raise HTTPException(status_code=400, detail="Bạn đã có đơn đăng ký đang chờ duyệt")
    app = SellerApplication(account_id=account.id, business_name=business_name, description=description, contact=contact)
    db.add(app)
    await db.flush()
    await log_event(
        db, "info", f"Seller application submitted by account {account.id}",
        request_id=current_request_id(),
        metadata={
            "event": "seller_application_submitted",
            "actor_id": account.id,
            "actor_type": "buyer",
            "subject_type": "seller_application",
            "subject_id": app.id,
            "outcome": "success",
            "source": "public",
            "application_id": app.id,
        },
    )
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


async def approve_application(
    app_id: int, db: AsyncSession, *, actor_id: int | None = None,
) -> SellerApplication:
    from src.audit.service import log_event
    from src.logging import current_request_id

    app = await db.get(SellerApplication, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn đăng ký")
    if app.status != ApplicationStatus.pending:
        raise HTTPException(status_code=400, detail="Đơn đăng ký đã được xử lý")
    app.status = ApplicationStatus.approved
    account = await db.get(Account, app.account_id)
    if account and "seller" not in account.roles:
        account.roles = [*account.roles, "seller"]
    await log_event(
        db, "info", f"Seller application {app_id} approved",
        request_id=current_request_id(),
        metadata={
            "event": "seller_application_approved",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "seller_application",
            "subject_id": app_id,
            "outcome": "success",
            "source": "admin",
            "application_id": app_id,
            "target_account_id": app.account_id,
        },
    )
    from src.mail.service import enqueue_mail, frontend_url
    await enqueue_mail(
        db,
        template="seller_application_approved",
        account_id=app.account_id,
        idempotency_key=f"seller_application_approved:{app.id}",
        payload={"action_url": frontend_url("vi", "/seller")},
    )
    await db.commit()
    await db.refresh(app)
    return app


async def reject_application(
    app_id: int, reason: str, db: AsyncSession, *, actor_id: int | None = None,
) -> SellerApplication:
    from src.audit.service import log_event
    from src.logging import current_request_id

    app = await db.get(SellerApplication, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn đăng ký")
    if app.status != ApplicationStatus.pending:
        raise HTTPException(status_code=400, detail="Đơn đăng ký đã được xử lý")
    app.status = ApplicationStatus.rejected
    app.reject_reason = reason
    await log_event(
        db, "info", f"Seller application {app_id} rejected",
        request_id=current_request_id(),
        metadata={
            "event": "seller_application_rejected",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "seller_application",
            "subject_id": app_id,
            "outcome": "success",
            "source": "admin",
            "application_id": app_id,
            "target_account_id": app.account_id,
        },
    )
    from src.mail.service import enqueue_mail, frontend_url
    await enqueue_mail(
        db,
        template="seller_application_rejected",
        account_id=app.account_id,
        idempotency_key=f"seller_application_rejected:{app.id}",
        payload={
            "reason": app.reject_reason or "",
            "action_url": frontend_url("vi", "/seller/apply"),
        },
    )
    await db.commit()
    await db.refresh(app)
    return app
