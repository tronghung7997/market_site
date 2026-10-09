"""HTTP seam shared by every settings router that goes through approval."""
from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from .registry import SubmitOutcome

REASON_FIELD = "change_reason"
REASON_MAX = 1000


async def change_reason(request: Request) -> str | None:
    """The maker's note, sent as a top-level ``change_reason`` next to the
    settings fields (the section schemas ignore unknown keys, so the field
    never reaches the update function)."""
    try:
        body = await request.json()
    except ValueError:
        return None
    value = body.get(REASON_FIELD) if isinstance(body, dict) else None
    return value.strip()[:REASON_MAX] if isinstance(value, str) else None


def respond(outcome: SubmitOutcome, config: Any) -> Any:
    """200 with the section's usual payload when everything applied at once;
    202 with the pending request (and the section as it is now) otherwise."""
    if outcome.request is None:
        return config
    return JSONResponse(status_code=202, content=jsonable_encoder({
        "status": "pending_approval",
        "request": outcome.request,
        "applied_fields": outcome.applied_fields,
        "config": config,
    }))
