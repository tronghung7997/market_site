"""Standalone mock of the social-data lookup providers.

One process answers the two upstreams the marketplace reads social data from,
at the HTTP boundary (same principle as mock_seller / mock_topproxy): the real
adapters and the frontend lookup routes cannot tell it from the real hosts.

- lookup.ghlab.info (key in ``?api_key=``):
    GET  /api/v1/tiktok?url=…                 → frontend /solutions/tiktok-id
    POST /api/v1/fb-module/find-id {url}      → frontend /solutions/facebook-id
    POST /api/v1/fb-module/collect {url}      → gateway source ``ghlab_fb`` (fb_collect)
- api.scrapecreators.com (key in ``x-api-key``):
    GET  /v1|v2/{platform}/{…}?handle=|url=…  → provider ``scrapecreators`` (gateway)

Run:
    cd marketplace-svc
    uv run uvicorn scripts.mock_lookup:app --port 9500

Point the consumers at it:
    frontend: TIKTOK_LOOKUP_API_URL=http://127.0.0.1:9500/api/v1/tiktok
              LOOKUP_API_KEY=mock-lookup-key
    ghlab_fb source: base_url http://127.0.0.1:9500, api_key mock-lookup-key
    scripts/seed_scrapecreators.py: SCRAPECREATORS_BASE_URL=http://127.0.0.1:9500
              SCRAPECREATORS_API_KEY=mock-lookup-key

Scripted outcomes (mock only): a target containing ``notfound`` answers 404,
``slow`` waits 3 s, ``fail`` answers 500 — enough to exercise the not-found,
timeout and "upstream error is free for the buyer" paths.
"""
import asyncio
import hashlib
import os
import time
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

MOCK_KEY = os.environ.get("MOCK_LOOKUP_KEY", "mock-lookup-key")

app = FastAPI(title="Mock lookup providers")
_calls = {"count": 0}


def _log(tag: str, **fields) -> None:
    _calls["count"] += 1
    ts = datetime.now().strftime("%H:%M:%S")
    extra = " ".join(f"{k}={v!r}" for k, v in fields.items())
    print(f"[mock-lookup {ts}] #{_calls['count']} {tag} {extra}", flush=True)


def _number(seed: str, low: int, high: int) -> int:
    digest = int(hashlib.sha256(seed.encode()).hexdigest()[:12], 16)
    return low + digest % (high - low)


def _handle(target: str) -> str:
    cleaned = target.rstrip("/").split("?")[0]
    return cleaned.rsplit("/", 1)[-1].lstrip("@") or "user"


async def _scripted(target: str) -> JSONResponse | None:
    if "slow" in target:
        await asyncio.sleep(3)
    if "notfound" in target:
        return JSONResponse({"success": False, "message": "Target does not exist"}, status_code=404)
    if "fail" in target:
        return JSONResponse({"success": False, "message": "Upstream crashed"}, status_code=500)
    return None


def _unauthorized() -> JSONResponse:
    return JSONResponse({"success": False, "message": "Invalid API key"}, status_code=401)


@app.get("/health")
async def health():
    return {"ok": True, "calls": _calls["count"]}


@app.get("/api/v1/tiktok")
async def tiktok_profile(request: Request, url: str = "", api_key: str = ""):
    _log("tiktok", url=url)
    if api_key != MOCK_KEY:
        return _unauthorized()
    if (scripted := await _scripted(url)):
        return scripted
    handle = _handle(url)
    uid = str(_number(handle, 6_000_000_000_000_000_000, 7_000_000_000_000_000_000))
    return {
        "success": True,
        "username": handle,
        "data": {
            "data": {
                "id": uid, "unique_id": handle, "nickname": handle.replace(".", " ").title(),
                "avatar": None, "verified": _number(handle, 0, 10) == 0, "private": False,
                "signature": f"Mock profile for @{handle}", "bio_link": None,
                "url": f"https://www.tiktok.com/@{handle}",
                "follower_count": _number(handle + "f", 100, 2_000_000),
                "following_count": _number(handle + "g", 10, 3_000),
                "heart_count": _number(handle + "h", 1_000, 50_000_000),
                "video_count": _number(handle + "v", 1, 900),
                "friend_count": _number(handle + "r", 0, 500), "digg_count": _number(handle + "d", 0, 90_000),
                "language": "vi", "create_time": 1_600_000_000 + _number(handle, 0, 100_000_000),
                "commerce_user": False, "tt_seller": False,
            },
            "meta": {"source": "mock", "fetched_at": int(time.time())},
        },
    }


@app.post("/api/v1/fb-module/find-id")
async def facebook_find_id(request: Request, api_key: str = ""):
    body = await request.json()
    url = str(body.get("url") or "")
    _log("fb-find-id", url=url)
    if api_key != MOCK_KEY:
        return _unauthorized()
    if not url:
        return JSONResponse({"success": False, "message": "url is required"}, status_code=422)
    if (scripted := await _scripted(url)):
        return scripted
    handle = _handle(url)
    kind = "group" if "/groups/" in url else "page" if _number(handle, 0, 2) else "profile"
    return {
        "id": str(_number(handle, 100_000_000_000_000, 100_099_999_999_999)),
        "type": kind, "username": handle, "name": handle.replace(".", " ").title(),
        "profile_picture_url": None, "url": url, "description": f"Mock {kind} {handle}",
        "likers_count": _number(handle + "l", 0, 500_000) if kind == "page" else None,
        "members_count": _number(handle + "m", 0, 200_000) if kind == "group" else None,
        "privacy": "public", "old_page_id": None, "source": "mock", "data_status": "fresh", "cached": False,
    }


@app.post("/api/v1/fb-module/collect")
async def facebook_collect(request: Request, api_key: str = ""):
    body = await request.json()
    url = str(body.get("url") or "")
    _log("fb-collect", url=url)
    if api_key != MOCK_KEY:
        return _unauthorized()
    if not url:
        return JSONResponse({"success": False, "message": "url is required"}, status_code=422)
    if (scripted := await _scripted(url)):
        return scripted
    handle = _handle(url)
    return {
        "success": True,
        "data": {
            "url": url, "id": str(_number(handle, 10**14, 10**15)), "type": "post",
            "author": {"id": str(_number(handle + "a", 10**14, 10**15)), "name": f"Author {handle[:12]}"},
            "text": f"Mock post content for {handle}",
            "reactions": _number(handle + "x", 0, 90_000), "comments": _number(handle + "c", 0, 5_000),
            "shares": _number(handle + "s", 0, 2_000), "created_time": int(time.time()) - _number(handle, 0, 10**7),
        },
        "meta": {"source": "mock", "fetched_at": int(time.time())},
    }


@app.get("/{version}/{path:path}")
async def scrapecreators(version: str, path: str, request: Request):
    params = dict(request.query_params)
    target = params.get("handle") or params.get("url") or params.get("query") or params.get("id") or path
    _log("scrapecreators", path=path, target=target)
    if request.headers.get("x-api-key") != MOCK_KEY:
        return _unauthorized()
    if (scripted := await _scripted(str(target))):
        return scripted
    platform = path.split("/", 1)[0]
    handle = _handle(str(target))
    return {
        "success": True, "platform": platform, "endpoint": f"/{version}/{path}",
        "credits_remaining": 1_000_000 - _calls["count"],
        "data": {
            "handle": handle, "id": str(_number(handle, 10**10, 10**11)),
            "followers": _number(handle + "f", 0, 5_000_000),
            "items": [{"id": str(_number(f"{handle}{i}", 10**10, 10**11)), "title": f"{platform} item {i}"} for i in range(3)],
        },
    }
