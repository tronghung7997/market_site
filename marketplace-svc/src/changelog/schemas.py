from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Kind = Literal["new", "improved", "fixed"]
Audience = Literal["admin", "seller", "buyer", "accounting"]


class ChangeItem(BaseModel):
    kind: Kind
    text: str = Field(min_length=1, max_length=300)
    audience: list[Audience] = Field(default_factory=list, max_length=4)

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text cannot be blank")
        return v


class ReleaseWrite(BaseModel):
    version: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    released_on: date
    title: str = Field(min_length=1, max_length=200)
    items: list[ChangeItem] = Field(default_factory=list, max_length=50)
    dev_notes: str = Field(default="", max_length=5000)
    status: Literal["draft", "published"] = "draft"


class ReleaseUpdate(BaseModel):
    version: str | None = Field(default=None, min_length=1, max_length=32, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    released_on: date | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    items: list[ChangeItem] | None = Field(default=None, max_length=50)
    dev_notes: str | None = Field(default=None, max_length=5000)
    status: Literal["draft", "published"] | None = None


class Release(BaseModel):
    id: int
    version: str
    released_on: date
    title: str
    items: list[ChangeItem]
    dev_notes: str
    status: str
    published_at: datetime | None
    author: str | None
    unread: bool


class ReleaseList(BaseModel):
    items: list[Release]
    unread_count: int
