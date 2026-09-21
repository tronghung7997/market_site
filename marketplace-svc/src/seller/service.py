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
    from src.alerts.service import add_alert
    from src.mail.service import enqueue_mail, frontend_url
    await enqueue_mail(
        db,
        template="seller_application_approved",
        account_id=app.account_id,
        idempotency_key=f"seller_application_approved:{app.id}",
        payload={"action_url": frontend_url("vi", "/seller")},
    )
    await add_alert(
        db,
        type_="seller_application_approved",
        severity="info",
        target_type="seller",
        target_id=app.account_id,
        message="Gian hàng của bạn đã được duyệt. Mở khu vực người bán để bắt đầu đăng sản phẩm.",
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


async def get_seller_profile(account: Account, db: AsyncSession) -> dict:
    """Shop identity for the /account › Người bán tab."""
    from src.sellers.service import seller_public_ref

    app = await db.scalar(
        select(SellerApplication)
        .where(SellerApplication.account_id == account.id, SellerApplication.status == ApplicationStatus.approved)
        .order_by(SellerApplication.created_at.desc())
        .limit(1)
    )
    # Sellers granted the role directly (internal / seeded) have no
    # application yet: hand back an empty profile so they can fill one in.
    ref = seller_public_ref(account.public_key, app.business_name if app else None)
    return {
        "business_name": app.business_name if app else "",
        "description": app.description if app else None,
        "contact": app.contact if app else None,
        "handle": ref["handle"],
        "canonical_path": ref["canonical_path"],
        "seller_tier": account.seller_tier.value if hasattr(account.seller_tier, "value") else account.seller_tier,
    }


async def update_seller_profile(account: Account, data: dict, db: AsyncSession) -> dict:
    """Sellers edit their shop name/bio without re-approval (product decision
    2026-09-21). Renaming changes the storefront handle; the public key in the
    URL keeps old links resolving."""
    from src.audit.service import log_event
    from src.logging import current_request_id

    app = await db.scalar(
        select(SellerApplication)
        .where(SellerApplication.account_id == account.id, SellerApplication.status == ApplicationStatus.approved)
        .order_by(SellerApplication.created_at.desc())
        .limit(1)
    )
    if app is None:
        name = (data.get("business_name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Đặt tên gian hàng trước")
        app = SellerApplication(account_id=account.id, business_name=name, status=ApplicationStatus.approved)
        db.add(app)
        await db.flush()
    before = {"business_name": app.business_name, "description": app.description, "contact": app.contact}
    for key, value in data.items():
        if key == "business_name":
            if value is None or not value.strip():
                continue
            app.business_name = value.strip()
        else:
            setattr(app, key, (value or "").strip() or None)
    after = {"business_name": app.business_name, "description": app.description, "contact": app.contact}
    if after != before:
        await log_event(
            db, "info", f"Seller profile updated by account {account.id}",
            request_id=current_request_id(),
            metadata={"event": "seller_profile_updated", "actor_id": account.id, "application_id": app.id, "before": before, "after": after},
        )
    await db.commit()
    return await get_seller_profile(account, db)
