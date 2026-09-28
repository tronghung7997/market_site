from datetime import datetime

from pydantic import BaseModel, Field


class ConnectRequest(BaseModel):
    token: str = Field(min_length=1, max_length=128)
    # The bot already posts to another tool's webhook; the seller agreed to
    # remove it so the marketplace can read the link code.
    replace_webhook: bool = False


class EventsUpdate(BaseModel):
    events: dict[str, bool]


class BotSummary(BaseModel):
    username: str
    name: str
    token_hint: str


class ChatSummary(BaseModel):
    key: str
    type: str
    title: str
    status: str


class TelegramState(BaseModel):
    connected: bool
    bot: BotSummary | None = None
    status: str | None = None
    paused_reason: str | None = None
    paused_at: datetime | None = None
    events: dict[str, bool]
    chats: list[ChatSummary]
    max_chats: int
    link_expires_at: datetime | None = None


class LinkCode(BaseModel):
    code: str
    expires_at: datetime
    deep_link: str
    group_command: str


class LinkStatus(BaseModel):
    status: str
    chat: ChatSummary | None = None


class TestResult(BaseModel):
    delivered: list[str]
    failed: list[str]
