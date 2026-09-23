"""Buyer proxy dashboard API — /me/proxies, /me/proxy-tags (docs/proxy-dashboard-api.md).

Đổi IP / whitelist dùng endpoint có sẵn theo đơn (`/orders/{ref}/proxy/*`,
src/resources/proxy_router.py); ở đây chỉ đọc danh sách dòng, tag và ghi chú.
"""
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account
from src.database import get_session
from src.models.account import Account
from src.proxies import service

router = APIRouter(tags=["proxies"])

Tone = Literal["iris", "good", "warn", "neutral", "ink"]


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    tone: Tone = "neutral"


class TagUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    tone: Tone | None = None


class TagAssign(BaseModel):
    line_ids: list[str] = Field(min_length=1, max_length=500)
    add: list[str] = Field(default_factory=list, max_length=50)
    remove: list[str] = Field(default_factory=list, max_length=50)
    mode: Literal["merge", "replace"] = "merge"


class NoteUpdate(BaseModel):
    line_id: str = Field(min_length=4, max_length=24)
    note: str = Field(default="", max_length=200)


@router.get("/me/proxies")
async def list_my_proxies(
    status_tab: Literal["", "running", "soon", "problem"] = Query(default="", alias="status"),
    q: str = Query(default="", max_length=100),
    tags: str = Query(default="", max_length=600),
    ip_type: str = Query(default="", max_length=60),
    rotation: str = Query(default="", max_length=60),
    expires: Literal["", "24h", "3d", "7d", "expired"] = "",
    sort: Literal["expiry_asc", "expiry_desc", "newest", "line"] = "expiry_asc",
    page: int = Query(default=1, ge=1, le=10_000),
    per_page: int = Query(default=50, ge=1, le=100),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_lines(
        account.id, db, tab=status_tab, q=q, tags=tags, ip_type=ip_type, rotation=rotation,
        expires=expires, sort=sort, page=page, per_page=per_page,
    )


@router.patch("/me/proxies/note")
async def update_note(body: NoteUpdate, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.set_note(account.id, body.line_id, body.note, db)


@router.post("/me/proxies/tags")
async def assign_tags(body: TagAssign, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.assign_tags(account.id, body.line_ids, body.add, body.remove, body.mode, db)


@router.get("/me/proxy-tags")
async def list_tags(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.list_tags(account.id, db)


@router.post("/me/proxy-tags", status_code=status.HTTP_201_CREATED)
async def create_tag(body: TagCreate, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.create_tag(account.id, body.name, body.tone, db)


@router.patch("/me/proxy-tags/{tag_id}")
async def update_tag(tag_id: str, body: TagUpdate, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.update_tag(account.id, tag_id, db, name=body.name, tone=body.tone)


@router.delete("/me/proxy-tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(tag_id: str, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    await service.delete_tag(account.id, tag_id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
