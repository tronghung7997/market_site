"""One-shot operational endpoints — không phải API sản phẩm.

POST /internal/ops/purge-demo-accounts
  - Auth: X-Internal-Key.
  - POST mặc định: soft-disable demo accounts + ghi marker → lần sau 410 Gone.
  - apply=false: dry-run, không đốt one-shot.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.auth.dependencies import verify_internal_key
from src.database import get_session
from src.ops.purge_demo import already_done, purge_demo_accounts

logger = structlog.get_logger()
router = APIRouter(tags=["ops-one-shot"], include_in_schema=False)


class PurgeDemoResponse(BaseModel):
    status: str
    message: str
    accounts: list[dict] = Field(default_factory=list)


@router.post(
    "/internal/ops/purge-demo-accounts",
    response_model=PurgeDemoResponse,
)
async def purge_demo_accounts_one_shot(
    apply: bool = Query(True, description="true=soft-disable + đốt one-shot; false=dry-run"),
    force: bool = Query(False, description="Cho phép purge khi không còn admin khác"),
    db: AsyncSession = Depends(get_session),
    _internal=Depends(verify_internal_key),
):
    if await already_done(db):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="One-shot purge_demo_accounts đã chạy rồi — không chạy lại được.",
        )

    result = await purge_demo_accounts(
        db,
        apply=apply,
        hard=False,  # HTTP chỉ soft-disable
        force=force,
        mark_one_shot=apply,
    )

    if result.status == "aborted_no_admin":
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=result.message)

    if apply and result.status == "applied":
        await log_event(
            db, "warning", result.message,
            metadata={
                "event": "purge_demo_accounts_done",
                "actor_type": "ops_one_shot",
                "account_ids": [a.get("id") for a in result.accounts],
                "source": "internal",
                "outcome": "success",
            },
        )
        await db.commit()
        logger.warning("purge_demo_accounts_one_shot_applied", count=len(result.accounts))
    elif apply and result.status == "empty":
        # Không có gì để xóa — vẫn đốt one-shot để không ai gọi lại "thử may".
        from src.ops.purge_demo import mark_done
        await mark_done(db, purged_ids=[])
        await log_event(
            db, "info", "purge_demo_accounts one-shot: không có account demo",
            metadata={"event": "purge_demo_accounts_done", "outcome": "empty", "source": "internal"},
        )
        await db.commit()
    else:
        await db.rollback()

    return PurgeDemoResponse(
        status=result.status,
        message=result.message,
        accounts=result.accounts,
    )
