from datetime import date

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import admin_review, dashboard, escrow_schedule, schemas, service, settings

router = APIRouter(tags=["seller"])


@router.post("/seller/apply", response_model=schemas.SellerApplicationResponse, status_code=status.HTTP_201_CREATED)
async def apply(body: schemas.SellerApplyRequest, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.apply_for_seller(
        account, body.business_name, body.description, body.contact, db,
        onboarding=body.model_dump(exclude={"business_name", "description", "contact"}),
    )


@router.get("/seller/applications/me", response_model=schemas.SellerApplicationResponse | None)
async def my_application(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.get_latest_application(account.id, db)


@router.get("/seller/profile", response_model=schemas.SellerProfileResponse)
async def seller_profile(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.get_seller_profile(account, db)


@router.patch("/seller/profile", response_model=schemas.SellerProfileResponse)
async def update_seller_profile(
    body: schemas.SellerProfileUpdate,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_seller_profile(account, body.model_dump(exclude_unset=True), db)


@router.get("/admin/seller-applications", response_model=schemas.AdminSellerApplicationPage)
async def list_apps(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    status: str = Query("pending", pattern="^(pending|needs_info|approved|rejected)$"),
    search: str | None = Query(None, max_length=200),
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
):
    return await admin_review.list_applications(db, status=status, search=search, page=page, per_page=per_page)


@router.get("/admin/seller-applications/{app_id}", response_model=schemas.AdminSellerApplicationDetail)
async def get_app(app_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await admin_review.application_detail(db, app_id)


@router.post("/admin/seller-applications/{app_id}/approve", response_model=schemas.AdminSellerApplicationRow)
async def approve(
    app_id: int,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    app = await service.approve_application(app_id, db, actor_id=admin.id)
    return await admin_review.application_row(db, app)


@router.post("/admin/seller-applications/{app_id}/request-info", response_model=schemas.AdminSellerApplicationRow)
async def request_info(
    app_id: int,
    body: schemas.InfoRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    app = await service.request_application_info(app_id, body.note, db, actor_id=admin.id, fields=body.fields)
    return await admin_review.application_row(db, app)


@router.post("/admin/seller-applications/{app_id}/reject", response_model=schemas.AdminSellerApplicationRow)
async def reject(
    app_id: int,
    body: schemas.RejectRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    app = await service.reject_application(
        app_id, body.reason, db, actor_id=admin.id, resubmit_after_days=body.resubmit_after_days,
    )
    return await admin_review.application_row(db, app)


@router.get("/admin/seller-applications/{app_id}/notes", response_model=list[schemas.AdminNote])
async def app_notes(app_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    from src.audit.notes import list_notes

    await admin_review.get_application(db, app_id)
    return await list_notes(db, "seller_application", app_id)


@router.post(
    "/admin/seller-applications/{app_id}/notes", response_model=schemas.AdminNote, status_code=status.HTTP_201_CREATED,
)
async def add_app_note(
    app_id: int,
    body: schemas.AdminNoteCreate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    from src.audit.notes import add_note

    await admin_review.get_application(db, app_id)
    return await add_note(db, "seller_application", app_id, body.body, author_id=admin.id)


@router.get("/seller/dashboard", response_model=schemas.SellerDashboardResponse)
async def seller_dashboard(
    range: str = Query("30d", pattern=dashboard.RANGE_KEY_PATTERN),
    tz: str = Query("UTC", max_length=64),
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    rng = dashboard.resolve_range(range, tz, from_date, to_date)
    return await dashboard.get_seller_dashboard(account.id, rng, db)


@router.get("/seller/escrow-schedule", response_model=schemas.EscrowScheduleResponse)
async def seller_escrow_schedule(
    tz: str = Query("UTC", max_length=64),
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    """Upcoming escrow releases by local day, with the estimated payout."""
    return await escrow_schedule.get_escrow_schedule(account.id, tz, db)


@router.get("/admin/seller-config", response_model=schemas.SellerRuntimeConfigResponse)
async def admin_seller_config(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await settings.get_seller_settings(db)


@router.patch("/admin/seller-config", response_model=schemas.SellerRuntimeConfigResponse)
async def update_admin_seller_config(
    body: schemas.SellerRuntimeConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await settings.update_seller_settings(
        db,
        actor_id=admin.id,
        low_stock_threshold=body.low_stock_threshold,
        inventory_export_row_limit=body.inventory_export_row_limit,
        review_window_days=body.review_window_days,
        auto_review_days=body.auto_review_days,
        auto_review_enabled=body.auto_review_enabled,
    )
