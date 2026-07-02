"""Debug/diagnostics router.

Quick health probe to answer, in one request:
  1. Is the *new code* actually running?  -> git_sha / started_at
  2. Have migrations run to head?          -> alembic.current vs alembic.head
  3. Can the app reach the DB / products?  -> db.ok / products_count

Every check is wrapped so this endpoint itself never raises — even when the
rest of the app is broken. Mounted at /debug/version.

NOTE: temporary debugging aid. Remove (or protect behind auth) before it
lives long in production.
"""

import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import text

from src.config import settings
from src.database import SessionLocal

router = APIRouter(prefix="/debug", tags=["debug"])

# Captured once, at import time = when this uvicorn process started.
# If this timestamp is old after a deploy, the container was NOT restarted
# with the new image.
_STARTED_AT = datetime.now(timezone.utc).isoformat()


def _build_info() -> dict:
    # GIT_SHA / BUILD_TIME are injected at image-build time (see notes in the
    # response). Absent -> "unknown", which itself tells you the build didn't
    # stamp them.
    return {
        "git_sha": os.getenv("GIT_SHA", "unknown"),
        "build_time": os.getenv("BUILD_TIME", "unknown"),
        "started_at": _STARTED_AT,
    }


def _alembic_status() -> dict:
    """Compare the revision recorded in the DB against the head in the code."""
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        cfg = Config("alembic.ini")
        script = ScriptDirectory.from_config(cfg)
        heads = list(script.get_heads())
    except Exception as e:  # code side broken (missing files, etc.)
        return {"ok": False, "error": f"cannot read migration scripts: {e!r}"}
    return {"ok": True, "code_heads": heads}


async def _db_status() -> dict:
    """Live DB checks: connectivity, applied revision, products query."""
    out: dict = {"ok": False}
    try:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
            out["ok"] = True

            try:
                rev = await session.execute(text("SELECT version_num FROM alembic_version"))
                out["current_revision"] = rev.scalar_one_or_none()
            except Exception as e:
                out["current_revision_error"] = repr(e)

            # Exercise the exact table /products reads — surfaces the real error
            # (missing column, bad type, etc.) instead of a blank 500.
            try:
                cnt = await session.execute(text("SELECT count(*) FROM products"))
                out["products_count"] = cnt.scalar_one()
            except Exception as e:
                out["products_query_error"] = repr(e)
    except Exception as e:
        out["error"] = repr(e)
    return out


@router.get("/version")
async def debug_version() -> dict:
    build = _build_info()
    code = _alembic_status()
    db = await _db_status()

    migrations_up_to_date = None
    if code.get("ok") and "current_revision" in db:
        migrations_up_to_date = db["current_revision"] in code["code_heads"]

    return {
        "service": settings.service_name,
        "build": build,
        "migrations": {
            "code_heads": code.get("code_heads"),
            "db_current": db.get("current_revision"),
            "up_to_date": migrations_up_to_date,
            "code_error": code.get("error"),
        },
        "db": db,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
