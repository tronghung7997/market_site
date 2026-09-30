"""Admin support desk HTTP adapter (`/admin/support…`, `/admin/canned-replies…`)."""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import canned, schemas, support

router = APIRouter(tags=["support-desk"])
Admin = Depends(require_role("admin"))


@router.get("/admin/support", response_model=schemas.AdminTicketPage)
async def list_tickets(
    view: Literal["waiting", "mine", "open", "resolved", "all"] = "all",
    q: str | None = Query(None, max_length=200),
    role: Literal["buyer", "seller"] | None = None,
    kind: Literal["support", "helpdesk"] | None = None,
    assignee: str | None = Query(None, max_length=20, description="me, none or an admin id"),
    tag: str | None = Query(None, max_length=40),
    cursor: str | None = Query(None, max_length=400),
    limit: int = Query(30, ge=1, le=support.MAX_LIMIT),
    admin: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await support.list_tickets(
        admin, db, view=view, q=q, role=role, kind=kind, assignee=assignee, tag=tag, cursor=cursor, limit=limit,
    )


@router.get("/admin/support/stats", response_model=schemas.SupportStats)
async def support_stats(_: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await support.support_stats(db)


@router.get("/admin/support/tags", response_model=list[schemas.TagCount])
async def support_tags(_: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await support.tag_counts(db)


@router.get("/admin/support/{conversation_id}", response_model=schemas.AdminTicket)
async def get_ticket(conversation_id: uuid.UUID, admin: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await support.get_ticket(admin, db, conversation_id)


@router.get("/admin/support/{conversation_id}/context", response_model=schemas.TicketContext)
async def ticket_context(conversation_id: uuid.UUID, _: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await support.ticket_context(db, conversation_id)


@router.post("/admin/support/{conversation_id}/status", response_model=schemas.AdminTicket)
async def set_status(
    conversation_id: uuid.UUID,
    body: schemas.TicketStatusChange,
    admin: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await support.set_status(
        admin, db, conversation_id, target=body.status, reason=body.reason, notify_requester=body.notify_requester,
    )


@router.post("/admin/support/{conversation_id}/assign", response_model=schemas.AdminTicket)
async def assign(
    conversation_id: uuid.UUID,
    body: schemas.TicketAssign,
    admin: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await support.assign(admin, db, conversation_id, body.assignee_id)


@router.put("/admin/support/{conversation_id}/tags", response_model=schemas.AdminTicket)
async def set_tags(
    conversation_id: uuid.UUID,
    body: schemas.TicketTags,
    admin: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await support.set_tags(admin, db, conversation_id, body.tags)


@router.get("/admin/support/{conversation_id}/notes", response_model=list[schemas.AdminNoteOut])
async def list_notes(conversation_id: uuid.UUID, _: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await support.list_ticket_notes(db, conversation_id)


@router.post("/admin/support/{conversation_id}/notes", response_model=schemas.AdminNoteOut, status_code=201)
async def add_note(
    conversation_id: uuid.UUID,
    body: schemas.NoteCreate,
    admin: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await support.add_ticket_note(admin, db, conversation_id, body.body)


@router.get("/admin/canned-replies", response_model=list[schemas.CannedReplyOut])
async def list_canned(_: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await canned.list_replies(db)


@router.post("/admin/canned-replies", response_model=schemas.CannedReplyOut, status_code=201)
async def create_canned(body: schemas.CannedReplyInput, admin: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await canned.create_reply(db, body, actor_id=admin.id)


@router.patch("/admin/canned-replies/{reply_id}", response_model=schemas.CannedReplyOut)
async def update_canned(
    reply_id: int,
    body: schemas.CannedReplyPatch,
    admin: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    try:
        return await canned.update_reply(db, reply_id, body.model_dump(exclude_unset=True), actor_id=admin.id)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False, include_context=False)) from None


@router.delete("/admin/canned-replies/{reply_id}", status_code=204)
async def delete_canned(reply_id: int, admin: Account = Admin, db: AsyncSession = Depends(get_session)):
    await canned.delete_reply(db, reply_id, actor_id=admin.id)
    return Response(status_code=204)
