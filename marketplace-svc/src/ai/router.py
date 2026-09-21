"""Admin HTTP surface for the shared AI seam.

Thin by design: parses, authorises, translates ``AiError`` to HTTP, and calls
one owning service interface.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.ai import schemas, service
from src.ai.port import AiError
from src.ai.tasks import SUPPORTED_LOCALES
from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

router = APIRouter(prefix="/admin/ai", tags=["admin-ai"])

# Configuration mistakes and upstream outages are different problems for the
# operator, so they get different status codes.
_STATUS_BY_KIND = {
    "disabled": status.HTTP_409_CONFLICT,
    "not_configured": status.HTTP_400_BAD_REQUEST,
    "budget_exceeded": status.HTTP_429_TOO_MANY_REQUESTS,
    "unavailable": status.HTTP_503_SERVICE_UNAVAILABLE,
    "invalid_output": status.HTTP_502_BAD_GATEWAY,
    "upstream_error": status.HTTP_400_BAD_REQUEST,
}


def http_error(exc: AiError) -> HTTPException:
    return HTTPException(
        status_code=_STATUS_BY_KIND.get(exc.kind, status.HTTP_400_BAD_REQUEST),
        detail=str(exc),
    )


@router.get("/config", response_model=schemas.AiProviderConfigOut)
async def get_ai_config(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.admin_config(db)


@router.patch("/config", response_model=schemas.AiProviderConfigOut)
async def update_ai_config(
    body: schemas.AiProviderConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await service.update_config(
            db, actor_id=admin.id, changes=body.model_dump(exclude_unset=True),
        )
    except AiError as exc:
        raise http_error(exc) from exc


@router.post("/config/test", response_model=schemas.AiConnectionTestResult)
async def test_ai_connection(
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """One real upstream call. Returns a result object rather than raising so
    the console can show a failure inline instead of a generic error toast."""
    return await service.test_connection(db, actor_id=admin.id)


@router.get("/prompts", response_model=list[schemas.AiPromptOut])
async def list_ai_prompts(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_prompts(db)


@router.put("/prompts/{task}/{locale}", response_model=schemas.AiPromptOut)
async def update_ai_prompt(
    task: str,
    locale: str,
    body: schemas.AiPromptUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    if locale not in SUPPORTED_LOCALES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Ngôn ngữ không hỗ trợ: {locale}")
    try:
        return await service.update_prompt(
            db, task=task, locale=locale,
            system_prompt=body.system_prompt, user_prompt=body.user_prompt,
            actor_id=admin.id,
        )
    except AiError as exc:
        raise http_error(exc) from exc


@router.get("/usage", response_model=schemas.AiUsageSummary)
async def ai_usage(
    days: int = Query(7, ge=1, le=90),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.usage_summary(db, days=days)
