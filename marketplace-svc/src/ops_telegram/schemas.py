from datetime import datetime

from pydantic import BaseModel, Field


class OutboxStats(BaseModel):
    pending: int
    failed_24h: int
    last_sent_at: datetime | None = None


class OpsTelegramConfigOut(BaseModel):
    enabled: bool
    token_set: bool
    # "…ab12": the last characters only; the token itself is never returned.
    token_hint: str | None = None
    bot_username: str | None = None
    ops_chat_id: str
    channel_chat_id: str
    channel_enabled: bool
    channel_interval_minutes: int
    events: dict[str, bool]
    quiet_low_priority: bool
    status: str
    paused_reason: str | None = None
    paused_at: datetime | None = None
    updated_at: datetime | None = None
    updated_by_id: int | None = None
    outbox: OutboxStats


class OpsTelegramConfigUpdate(BaseModel):
    enabled: bool | None = None
    # Write-only. "" removes the stored token.
    bot_token: str | None = Field(default=None, max_length=128)
    ops_chat_id: str | None = Field(default=None, max_length=64)
    channel_chat_id: str | None = Field(default=None, max_length=64)
    channel_enabled: bool | None = None
    channel_interval_minutes: int | None = None
    events: dict[str, bool] | None = None
    quiet_low_priority: bool | None = None
    # Lift a pause (after fixing the token or the bot's place in the chats).
    resume: bool | None = None


class TokenCheck(BaseModel):
    # Empty = check the stored token.
    token: str | None = Field(default=None, max_length=128)


class BotIdentity(BaseModel):
    username: str
    name: str


class TestResult(BaseModel):
    # ok · unreachable · not_set
    ops: str
    channel: str
