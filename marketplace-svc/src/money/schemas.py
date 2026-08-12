from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class MoneyConfigPublic(BaseModel):
    ledger_currency: str = "VND"
    display_fx_rate: int | None
    display_currency_default: str
    allow_user_toggle: bool
    allow_locale_toggle: bool


class MoneyConfigAdmin(MoneyConfigPublic):
    rate_min: int
    rate_max: int
    env_rate: int | None
    env_currency_default: str
    env_allow_user_toggle: bool
    env_allow_locale_toggle: bool
    updated_at: datetime | None = None
    updated_by_id: int | None = None
    source: str  # "db" | "env" | "none"


class MoneyConfigUpdate(BaseModel):
    """Partial update — at least one field required."""
    display_fx_rate: int | None = Field(None, description="VND per 1 USD")
    display_currency_default: Literal["VND", "USD"] | None = None
    allow_user_toggle: bool | None = None
    allow_locale_toggle: bool | None = None

    @model_validator(mode="after")
    def at_least_one(self):
        if (
            self.display_fx_rate is None
            and self.display_currency_default is None
            and self.allow_user_toggle is None
            and self.allow_locale_toggle is None
        ):
            raise ValueError("At least one field is required")
        return self


class MoneyConfigUpdateResponse(BaseModel):
    display_fx_rate: int
    display_currency_default: str
    allow_user_toggle: bool
    allow_locale_toggle: bool
    old_rate: int | None = None
    updated_at: datetime
    updated_by_id: int
