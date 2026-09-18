"""App-wide maintenance gate.

Registered as a global FastAPI dependency (see main.py). While maintenance is
on, every request answers 503 MAINTENANCE except:

- operational paths (health, payment webhooks, provider callbacks) — money
  already in flight must still be recorded;
- the admin console and the sign-in endpoints staff need to reach it;
- any caller whose access token carries the admin role (the JWT is decoded
  locally, no DB round-trip beyond the cached config).
"""
from __future__ import annotations

from fastapi import Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.service import decode_access_token
from src.database import get_session
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error

from .service import maintenance_active

_ALWAYS_OPEN_PREFIXES = ("/webhooks/", "/admin/", "/internal/", "/auth/2fa/", "/gw/", "/public/")
_ALWAYS_OPEN_EXACT = {
    "/health", "/public/site-status", "/me",
    "/auth/login", "/auth/admin/login", "/auth/login/2fa", "/auth/refresh", "/auth/logout", "/auth/logout-all",
    "/auth/change-password", "/public/auth-config",
}


def _is_admin_token(request: Request) -> bool:
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return False
    try:
        payload = decode_access_token(auth[7:], path=request.url.path)
    except Exception:
        return False
    return "admin" in (payload.get("roles") or [])


async def maintenance_gate(request: Request, db: AsyncSession = Depends(get_session)) -> None:
    path = request.url.path
    if path in _ALWAYS_OPEN_EXACT or path.startswith(_ALWAYS_OPEN_PREFIXES):
        return
    if not await maintenance_active(db):
        return
    if _is_admin_token(request):
        return
    raise api_error(ErrorCode.MAINTENANCE, status.HTTP_503_SERVICE_UNAVAILABLE)
