from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import admin_feed, history, schemas, service

router = APIRouter(tags=["notifications"])


@router.get("/me/action-items", response_model=list[schemas.ActionItem])
async def account_action_items(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.account_action_items(account, db)


@router.get("/orders/action-items", response_model=list[schemas.ActionItem])
async def buyer_action_items(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.buyer_action_items(account.id, db)


@router.get("/seller/action-items", response_model=list[schemas.ActionItem])
async def seller_action_items(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.seller_action_items(account.id, db)


@router.get("/admin/action-items", response_model=list[schemas.ActionItem])
async def admin_action_items(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.admin_action_items(db)


@router.get("/me/notifications", response_model=schemas.NotificationPage)
async def my_notifications(
    category: schemas.NotificationCategory | None = None,
    unread_only: bool = False,
    before: int | None = Query(None, ge=1),
    limit: int = Query(20, ge=1, le=history.PAGE_MAX),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    """The caller's notification history, newest first."""
    return await history.list_notifications(
        account.id, db, category=category, unread_only=unread_only, before=before, limit=limit,
    )


@router.get("/me/notifications/unread", response_model=schemas.NotificationCounts)
async def my_unread_notifications(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await history.unread_counts(account.id, db)


@router.post("/me/notifications/read", response_model=schemas.NotificationCounts)
async def read_my_notifications(
    body: schemas.NotificationReadRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await history.mark_read(account.id, db, ids=body.ids, category=body.category)


@router.get("/admin/notifications/feed", response_model=schemas.AdminFeed)
async def admin_notification_feed(
    limit: int = Query(8, ge=1, le=30),
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await admin_feed.admin_feed(db, account_id=admin.id, limit=limit)


@router.post("/admin/notifications/seen", status_code=204)
async def admin_notifications_seen(
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await admin_feed.mark_seen(db, account_id=admin.id)
    return Response(status_code=204)
