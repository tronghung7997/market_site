from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import catalog, runtime, schemas
from .errors import (
    MailConfigError,
    MailNotReady,
    MailOutboxConflict,
    MailOutboxNotFound,
    MailTestCooldown,
    MailTestSendFailed,
)

router = APIRouter(tags=["mail"])


def _http(exc: Exception) -> None:
    if isinstance(exc, MailConfigError):
        raise HTTPException(status_code=422, detail=exc.detail) from exc
    if isinstance(exc, MailNotReady):
        raise HTTPException(status_code=400, detail=exc.detail) from exc
    if isinstance(exc, MailTestCooldown):
        raise HTTPException(
            status_code=429,
            detail="Wait before sending another test email",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    if isinstance(exc, MailTestSendFailed):
        raise HTTPException(status_code=502, detail=exc.detail) from exc
    if isinstance(exc, MailOutboxNotFound):
        raise HTTPException(status_code=404, detail="Outbox row not found") from exc
    if isinstance(exc, MailOutboxConflict):
        raise HTTPException(status_code=409, detail=exc.detail) from exc
    raise exc


@router.get("/admin/mail-config", response_model=schemas.MailConfigAdmin)
async def admin_mail_config(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await runtime.admin_config(db)


@router.patch("/admin/mail-config", response_model=schemas.MailConfigAdmin)
async def update_mail_config(
    body: schemas.MailConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await runtime.update_config(
            db,
            actor_id=admin.id,
            **body.model_dump(exclude_unset=True),
        )
    except (MailConfigError, MailNotReady) as exc:
        _http(exc)


@router.post("/admin/mail-config/reset-to-env", response_model=schemas.MailConfigAdmin)
async def reset_mail_config_to_env(
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await runtime.reset_to_env(db, actor_id=admin.id)
    except MailConfigError as exc:
        _http(exc)


@router.post("/admin/mail-config/send-test", response_model=schemas.MailSendTestResponse)
async def send_test_mail(
    body: schemas.MailSendTestRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await runtime.send_test(
            db,
            actor_id=admin.id,
            actor_email=admin.email,
            to_email=str(body.to_email),
            locale=body.locale,
        )
    except (MailConfigError, MailNotReady, MailTestCooldown, MailTestSendFailed, MailOutboxNotFound) as exc:
        _http(exc)


@router.get("/admin/mail-outbox", response_model=schemas.MailOutboxList)
async def admin_mail_outbox(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    status: str | None = Query(None),
    template: str | None = Query(None),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    try:
        return await runtime.list_outbox(
            db, status=status, template=template, limit=limit, offset=offset,
        )
    except MailConfigError as exc:
        _http(exc)


@router.post("/admin/mail-outbox/{outbox_id}/retry", response_model=schemas.MailOutboxRow)
async def retry_mail_outbox(
    outbox_id: int,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await runtime.retry_outbox(db, outbox_id=outbox_id, actor_id=admin.id)
    except (MailOutboxNotFound, MailOutboxConflict) as exc:
        _http(exc)


@router.get("/admin/mail-templates", response_model=schemas.MailTemplateList)
async def admin_mail_templates(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await catalog.list_templates(db)


@router.patch("/admin/mail-templates", response_model=schemas.MailTemplateRow)
async def update_mail_template(
    body: schemas.MailTemplateUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await catalog.update_template(
            db,
            actor_id=admin.id,
            template=body.template,
            locale=body.locale,
            subject=body.subject,
            body=body.body,
        )
    except MailConfigError as exc:
        _http(exc)


@router.post("/admin/mail-templates/reset", response_model=schemas.MailTemplateRow)
async def reset_mail_template(
    body: schemas.MailTemplateReset,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await catalog.reset_template(
            db,
            actor_id=admin.id,
            template=body.template,
            locale=body.locale,
        )
    except MailConfigError as exc:
        _http(exc)


@router.post("/admin/mail-templates/preview", response_model=schemas.MailTemplatePreviewResponse)
async def preview_mail_template(
    body: schemas.MailTemplatePreviewRequest,
    _: Account = Depends(require_role("admin")),
):
    try:
        return catalog.preview(body.template, body.locale, body.subject, body.body)
    except MailConfigError as exc:
        _http(exc)
