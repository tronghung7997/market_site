from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.media import service as media_service
from src.media.service import public_image
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.alert import Alert
from src.models.category import Category
from src.models.media import MediaPurpose


ONBOARDING_FIELDS = ("seller_type", "experience", "phone", "warranty_policy", "referral_source")


def _blank_to_none(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


async def _known_category_ids(category_ids: list[int] | None, db: AsyncSession) -> list[int] | None:
    """Keep the applicant's order, drop duplicates, reject ids that are not an
    active category (the wizard only offers active ones)."""
    if not category_ids:
        return None
    wanted = list(dict.fromkeys(category_ids))
    found = set((await db.execute(
        select(Category.id).where(Category.id.in_(wanted), Category.is_active == True)  # noqa: E712
    )).scalars().all())
    unknown = [cid for cid in wanted if cid not in found]
    if unknown:
        raise HTTPException(status_code=422, detail="Danh mục không hợp lệ")
    return wanted


async def apply_for_seller(
    account: Account,
    business_name: str,
    description: str | None,
    contact: str | None,
    db: AsyncSession,
    *,
    onboarding: dict | None = None,
) -> SellerApplication:
    """Submit an application. ``onboarding`` carries the optional wizard
    answers (``ONBOARDING_FIELDS``, ``category_ids``, ``accept_rules``)."""
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
    answers = onboarding or {}
    waiting = await db.scalar(
        select(SellerApplication).where(
            SellerApplication.account_id == account.id,
            SellerApplication.status == ApplicationStatus.needs_info,
        ).with_for_update()
    )
    if waiting:
        return await _resubmit_application(waiting, account, business_name, description, contact, answers, db)
    app = SellerApplication(
        account_id=account.id, business_name=business_name, description=description, contact=contact,
        **{field: _blank_to_none(answers.get(field)) for field in ONBOARDING_FIELDS},
        category_ids=await _known_category_ids(answers.get("category_ids"), db),
        rules_accepted_at=datetime.now(timezone.utc) if answers.get("accept_rules") else None,
    )
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


async def _clear_info_alert(account_id: int, db: AsyncSession) -> None:
    await db.execute(
        update(Alert)
        .where(
            Alert.is_active,
            Alert.type == "seller_application_needs_info",
            Alert.target_type == "buyer",
            Alert.target_id == account_id,
        )
        .values(is_active=False)
    )


async def _resubmit_application(
    app: SellerApplication,
    account: Account,
    business_name: str,
    description: str | None,
    contact: str | None,
    answers: dict,
    db: AsyncSession,
) -> SellerApplication:
    """Answer an admin's "needs more information": the same row takes the new
    answers and goes back to pending, keeping the admin's note for context."""
    from src.audit.service import log_event
    from src.logging import current_request_id

    app.business_name = business_name
    app.description = description
    app.contact = contact
    for field in ONBOARDING_FIELDS:
        setattr(app, field, _blank_to_none(answers.get(field)))
    app.category_ids = await _known_category_ids(answers.get("category_ids"), db)
    app.rules_accepted_at = datetime.now(timezone.utc) if answers.get("accept_rules") else None
    app.status = ApplicationStatus.pending
    app.info_responded_at = datetime.now(timezone.utc)
    await _clear_info_alert(account.id, db)
    await log_event(
        db, "info", f"Seller application {app.id} resubmitted with more information",
        request_id=current_request_id(),
        metadata={
            "event": "seller_application_resubmitted",
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


async def request_application_info(
    app_id: int, note: str, db: AsyncSession, *, actor_id: int | None = None,
) -> SellerApplication:
    """Send a pending application back to the applicant with a note."""
    from src.alerts.service import add_alert
    from src.audit.service import log_event
    from src.logging import current_request_id
    from src.mail.service import enqueue_mail, frontend_url

    app = await db.get(SellerApplication, app_id, with_for_update=True)
    if not app:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn đăng ký")
    if app.status != ApplicationStatus.pending:
        raise HTTPException(status_code=400, detail="Đơn đăng ký đã được xử lý")
    app.status = ApplicationStatus.needs_info
    app.info_request = note
    app.info_requested_at = datetime.now(timezone.utc)
    app.info_responded_at = None
    await log_event(
        db, "info", f"Seller application {app_id} sent back for more information",
        request_id=current_request_id(),
        metadata={
            "event": "seller_application_needs_info",
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
    await add_alert(
        db,
        type_="seller_application_needs_info",
        severity="warning",
        target_type="buyer",
        target_id=app.account_id,
        message="GMMO cần bạn bổ sung thông tin cho đơn đăng ký bán hàng.",
        href="/seller/apply",
    )
    await enqueue_mail(
        db,
        template="seller_application_needs_info",
        account_id=app.account_id,
        idempotency_key=f"seller_application_needs_info:{app.id}:{app.info_requested_at.isoformat()}",
        payload={"reason": note, "action_url": frontend_url("vi", "/seller/apply")},
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
    # An applicant who never answers a "needs more information" can still be turned down.
    if app.status not in (ApplicationStatus.pending, ApplicationStatus.needs_info):
        raise HTTPException(status_code=400, detail="Đơn đăng ký đã được xử lý")
    app.status = ApplicationStatus.rejected
    app.reject_reason = reason
    await _clear_info_alert(app.account_id, db)
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
        "logo": public_image(app.logo) if app else None,
        "banner": public_image(app.banner) if app else None,
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
    images_changed = []
    for field, purpose in (("logo", MediaPurpose.seller_logo), ("banner", MediaPurpose.seller_banner)):
        if f"{field}_id" not in data:
            continue
        media_id = data.pop(f"{field}_id")
        snaps = await media_service.set_subject_media(
            db, actor_id=account.id, purpose=purpose, subject_type="seller_shop",
            subject_id=account.id, public_ids=[media_id] if media_id else [], max_count=1,
        )
        new_value = snaps[0] if snaps else None
        if (getattr(app, field) or {}).get("id") != (new_value or {}).get("id"):
            images_changed.append(field)
        setattr(app, field, new_value)
    for key, value in data.items():
        if key == "business_name":
            if value is None or not value.strip():
                continue
            app.business_name = value.strip()
        else:
            setattr(app, key, (value or "").strip() or None)
    after = {"business_name": app.business_name, "description": app.description, "contact": app.contact}
    if after != before or images_changed:
        await log_event(
            db, "info", f"Seller profile updated by account {account.id}",
            request_id=current_request_id(),
            metadata={
                "event": "seller_profile_updated", "actor_id": account.id, "application_id": app.id,
                "before": before, "after": after, "images_changed": images_changed,
            },
        )
    await db.commit()
    return await get_seller_profile(account, db)
