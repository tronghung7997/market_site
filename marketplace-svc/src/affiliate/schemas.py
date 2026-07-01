from pydantic import BaseModel


class ClickRequest(BaseModel):
    code: str
    path: str | None = None
    referrer: str | None = None
