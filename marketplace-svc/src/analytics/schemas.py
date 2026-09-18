import re

from pydantic import BaseModel, field_validator

# Clarity ids are short lowercase alphanumerics (e.g. "abcd1efgh2").
CLARITY_ID_RE = re.compile(r"^[a-z0-9]{6,20}$")


class AnalyticsConfigPublic(BaseModel):
    clarity_project_id: str | None


class AnalyticsConfigAdmin(AnalyticsConfigPublic):
    updated_at: str | None = None
    updated_by_id: int | None = None


class AnalyticsConfigUpdate(BaseModel):
    """Blank / null clears the id (tag off)."""
    clarity_project_id: str | None = None

    @field_validator("clarity_project_id", mode="before")
    @classmethod
    def normalize(cls, value):
        if value is None:
            return None
        value = str(value).strip().lower()
        if not value:
            return None
        if not CLARITY_ID_RE.fullmatch(value):
            raise ValueError("clarity_project_id must be 6–20 letters or digits")
        return value
