"""Stateful standalone DProxy-compatible mock service.

This process deliberately mocks DProxy at the HTTP boundary. Marketplace code
must use its real DProxy adapter and cannot tell whether ``base_url`` points at
this app or ``https://api.dproxy.info``.

Run locally::

    cd marketplace-svc
    uv run uvicorn scripts.mock_dproxy:app --host 0.0.0.0 --port 9200 --reload

Provider config for local development::

    {
      "base_url": "http://127.0.0.1:9200",
      "api_key": "mock-dproxy-token",
      "auth_type": "bearer"
    }

The ``/_mock/*`` endpoints are test controls, not part of the DProxy contract.
They require ``X-Mock-Control-Key: mock-dproxy-control`` by default and make
error/cooldown/lifecycle E2E cases deterministic.
"""

from __future__ import annotations

import copy
import hmac
import json
import os
from base64 import b64decode
from datetime import datetime, timedelta, timezone
from typing import Literal

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field


API_KEY = os.environ.get("MOCK_DPROXY_API_KEY", "mock-dproxy-token")
CONTROL_KEY = os.environ.get("MOCK_DPROXY_CONTROL_KEY", "mock-dproxy-control")
AUTH_TYPE = os.environ.get("MOCK_DPROXY_AUTH_TYPE", "bearer").lower()
AUTH_HEADER = os.environ.get("MOCK_DPROXY_AUTH_HEADER", "X-API-Key")
DEFAULT_COOLDOWN_SECONDS = int(os.environ.get("MOCK_DPROXY_COOLDOWN_SECONDS", "2"))
DASHBOARD_USER = os.environ.get("MOCK_DPROXY_DASHBOARD_USER", "admin")
DASHBOARD_PASSWORD = os.environ.get("MOCK_DPROXY_DASHBOARD_PASSWORD", "mock-dashboard-password")

app = FastAPI(title="Mock DProxy", version="1.0.0")

FailureMode = Literal[
    "normal",
    "list_500",
    "list_malformed",
    "list_empty",
    "rotate_500",
    "rotate_malformed",
]


class ModeRequest(BaseModel):
    mode: FailureMode


class PatchAssignmentRequest(BaseModel):
    is_active: bool | None = None
    status: str | None = None
    proxy_status: str | None = None
    expires_in_seconds: int | None = None
    rotation_available: bool | None = None
    cooldown_seconds: int | None = Field(default=None, ge=0)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _new_assignment(index: int) -> dict:
    now = _utcnow()
    assignment_id = f"00000000-0000-4000-8000-{index:012d}"
    return {
        "id": assignment_id,
        "assigned_at": _iso(now - timedelta(days=1)),
        "expired_at": _iso(now + timedelta(days=7 + index)),
        "status": "active",
        "username": f"u_mock_{index}",
        "password": f"mock-pass-{index}",
        "old_password": None,
        "is_active": True,
        "proxies": {
            "host": "127.0.0.1",
            "port": 20160 + index,
            "status": {"msg": "online"},
            "country": "VN",
            "proxy_id": f"10000000-0000-4000-8000-{index:012d}",
            "ip_public": f"203.0.113.{10 + index}",
            "proxies_type": {"name": "residential"},
            "rotation": {
                "available": True,
                "mode": "pppoe",
                "cooldown_seconds": DEFAULT_COOLDOWN_SECONDS,
                "last_rotated_at": None,
                "rotate_endpoint": f"/api/v1/proxies/user/{assignment_id}/rotate",
            },
        },
        "_rotation_count": 0,
    }


_assignments: dict[str, dict] = {}
_mode: FailureMode = "normal"


def reset_state() -> None:
    global _mode
    _mode = "normal"
    _assignments.clear()
    for index in range(1, 4):
        assignment = _new_assignment(index)
        _assignments[assignment["id"]] = assignment


reset_state()


def _public_assignment(assignment: dict) -> dict:
    result = copy.deepcopy(assignment)
    result.pop("_rotation_count", None)
    return result


def _check_api_auth(request: Request) -> None:
    if AUTH_TYPE == "bearer":
        supplied = request.headers.get("authorization")
        expected = f"Bearer {API_KEY}"
    elif AUTH_TYPE == "header":
        supplied = request.headers.get(AUTH_HEADER)
        expected = API_KEY
    else:
        raise RuntimeError(f"Unsupported MOCK_DPROXY_AUTH_TYPE: {AUTH_TYPE!r}")
    if supplied != expected:
        raise HTTPException(status_code=401, detail="Invalid API credential")


def _check_control_auth(control_key: str | None) -> None:
    if control_key != CONTROL_KEY:
        raise HTTPException(status_code=401, detail="Invalid mock control key")


def _find_assignment(assignment_id: str) -> dict:
    assignment = _assignments.get(assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Proxy assignment not found")
    return assignment


def _check_dashboard_auth(request: Request) -> None:
    authorization = request.headers.get("authorization", "")
    try:
        scheme, encoded = authorization.split(" ", 1)
        username, password = b64decode(encoded).decode().split(":", 1)
    except (ValueError, UnicodeDecodeError):
        scheme, username, password = "", "", ""
    valid = (
        scheme.lower() == "basic"
        and hmac.compare_digest(username, DASHBOARD_USER)
        and hmac.compare_digest(password, DASHBOARD_PASSWORD)
    )
    if not valid:
        raise HTTPException(
            status_code=401,
            detail="Dashboard authentication required",
            headers={"WWW-Authenticate": 'Basic realm="Mock DProxy"'},
        )


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request) -> str:
    """Tiny local dashboard for humans; supplier endpoints remain unchanged."""
    _check_dashboard_auth(request)
    authorization_js = json.dumps(f"Bearer {API_KEY}")
    control_key_js = json.dumps(CONTROL_KEY)
    return """<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock DProxy</title><style>
body{font:14px system-ui;margin:0;background:#0b1020;color:#e8ecf4}main{max-width:1100px;margin:auto;padding:28px}
h1{margin:0 0 6px}.muted{color:#98a2b8}.bar{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}
button,select{background:#18213a;color:#fff;border:1px solid #34405f;border-radius:7px;padding:8px 11px;cursor:pointer}
button:hover{border-color:#7c8cff}table{width:100%;border-collapse:collapse;background:#121a2d;border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:11px;border-bottom:1px solid #27314a}th{color:#9da8bf}.ok{color:#61d095}.bad{color:#ff7b86}
code{color:#b9c5ff}#msg{min-height:22px;margin:10px 0}</style></head><body><main>
<h1>Mock DProxy</h1><div class="muted">DProxy-compatible inventory & rotation service · API key: <code>mock-dproxy-token</code></div>
<div class="bar"><button onclick="resetState()">Reset</button><select id="mode" onchange="setMode(this.value)">
<option>normal</option><option>list_empty</option><option>list_500</option><option>list_malformed</option><option>rotate_500</option><option>rotate_malformed</option>
</select><button onclick="load()">Refresh</button></div><div id="msg"></div>
<table><thead><tr><th>Assignment</th><th>Proxy</th><th>Public IP</th><th>Status</th><th>Expires</th><th>Rotation</th></tr></thead><tbody id="rows"></tbody></table>
<script>
const api={'Authorization':""" + authorization_js + """}, ctl={'X-Mock-Control-Key':""" + control_key_js + """,'Content-Type':'application/json'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){try{let r=await fetch('/_mock/state',{headers:ctl}),d=await r.json();mode.value=d.mode;
rows.innerHTML=d.assignments.map(x=>`<tr><td><code>${esc(x.id)}</code><br>${esc(x.username)} / ${esc(x.password)}</td><td>${esc(x.proxies.host)}:${esc(x.proxies.port)}</td><td>${esc(x.proxies.ip_public)}</td><td class="${x.is_active&&x.proxies.status.msg==='online'?'ok':'bad'}">${esc(x.status)} · ${esc(x.proxies.status.msg)}</td><td>${new Date(x.expired_at).toLocaleString()}</td><td><button onclick="rotate('${esc(x.id)}')">Đổi IP</button> ${esc(x.proxies.rotation.last_rotated_at||'chưa xoay')}</td></tr>`).join('');msg.textContent=`Mode: ${d.mode} · ${d.assignment_count} proxies`;}catch(e){msg.textContent=e}}
async function rotate(id){let r=await fetch(`/api/v1/proxies/user/${id}/rotate`,{method:'POST',headers:api}),d=await r.json();msg.textContent=`Rotate ${r.status}: ${JSON.stringify(d)}`;await load()}
async function resetState(){await fetch('/_mock/reset',{method:'POST',headers:ctl});await load()}
async function setMode(v){await fetch('/_mock/mode',{method:'PUT',headers:ctl,body:JSON.stringify({mode:v})});await load()}
load();</script></main></body></html>"""


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "mock-dproxy", "mode": _mode}


@app.get("/api/v1/proxies/user")
async def list_user_proxies(request: Request, response: Response):
    _check_api_auth(request)
    if _mode == "list_500":
        raise HTTPException(status_code=503, detail="Simulated DProxy outage")
    if _mode == "list_malformed":
        return {"unexpected": "top-level object instead of array"}
    if _mode == "list_empty":
        return []
    response.headers["X-Mock-DProxy"] = "true"
    return [_public_assignment(item) for item in _assignments.values()]


@app.post("/api/v1/proxies/user/{assignment_id}/rotate")
async def rotate_user_proxy(assignment_id: str, request: Request):
    _check_api_auth(request)
    if _mode == "rotate_500":
        raise HTTPException(status_code=503, detail="Simulated rotation outage")
    if _mode == "rotate_malformed":
        return {"ok": "not-a-boolean", "assignment": None}

    assignment = _find_assignment(assignment_id)
    rotation = assignment["proxies"]["rotation"]
    if not assignment["is_active"] or assignment["status"] != "active":
        raise HTTPException(status_code=409, detail="Proxy assignment is inactive")
    if assignment["proxies"]["status"]["msg"] != "online":
        raise HTTPException(status_code=409, detail="Proxy is offline")
    if datetime.fromisoformat(assignment["expired_at"]) <= _utcnow():
        raise HTTPException(status_code=410, detail="Proxy assignment expired")
    if not rotation["available"]:
        raise HTTPException(status_code=409, detail="Rotation is unavailable")

    cooldown = rotation["cooldown_seconds"] or 0
    last_rotated = rotation["last_rotated_at"]
    if last_rotated:
        available_at = datetime.fromisoformat(last_rotated) + timedelta(seconds=cooldown)
        if available_at > _utcnow():
            retry_after = max(1, int((available_at - _utcnow()).total_seconds()) + 1)
            raise HTTPException(
                status_code=429,
                detail={"message": "Rotation cooldown is active", "retry_after_seconds": retry_after},
                headers={"Retry-After": str(retry_after)},
            )

    assignment["_rotation_count"] += 1
    # Give each assignment a separate deterministic range so rotating one mock
    # proxy cannot accidentally produce the current IP of another assignment.
    assignment_number = int(assignment_id[-12:])
    suffix = assignment_number * 40 + assignment["_rotation_count"]
    assignment["proxies"]["ip_public"] = f"203.0.113.{suffix % 254 or 1}"
    rotation["last_rotated_at"] = _iso(_utcnow())
    return {
        "ok": True,
        "id": assignment_id,
        "ip_public": assignment["proxies"]["ip_public"],
        "last_rotated_at": rotation["last_rotated_at"],
    }


# Test-control API ---------------------------------------------------------


@app.get("/_mock/state")
async def mock_state(x_mock_control_key: str | None = Header(default=None)) -> dict:
    _check_control_auth(x_mock_control_key)
    return {
        "mode": _mode,
        "auth_type": AUTH_TYPE,
        "assignment_count": len(_assignments),
        "assignments": [_public_assignment(item) for item in _assignments.values()],
    }


@app.post("/_mock/reset")
async def mock_reset(x_mock_control_key: str | None = Header(default=None)) -> dict:
    _check_control_auth(x_mock_control_key)
    reset_state()
    return {"ok": True, "assignment_count": len(_assignments)}


@app.put("/_mock/mode")
async def mock_mode(body: ModeRequest, x_mock_control_key: str | None = Header(default=None)) -> dict:
    global _mode
    _check_control_auth(x_mock_control_key)
    _mode = body.mode
    return {"ok": True, "mode": _mode}


@app.patch("/_mock/assignments/{assignment_id}")
async def mock_patch_assignment(
    assignment_id: str,
    body: PatchAssignmentRequest,
    x_mock_control_key: str | None = Header(default=None),
) -> dict:
    _check_control_auth(x_mock_control_key)
    assignment = _find_assignment(assignment_id)
    changes = body.model_dump(exclude_unset=True)
    if "is_active" in changes:
        assignment["is_active"] = changes["is_active"]
    if "status" in changes:
        assignment["status"] = changes["status"]
    if "proxy_status" in changes:
        assignment["proxies"]["status"]["msg"] = changes["proxy_status"]
    if "expires_in_seconds" in changes:
        assignment["expired_at"] = _iso(_utcnow() + timedelta(seconds=changes["expires_in_seconds"]))
    if "rotation_available" in changes:
        assignment["proxies"]["rotation"]["available"] = changes["rotation_available"]
    if "cooldown_seconds" in changes:
        assignment["proxies"]["rotation"]["cooldown_seconds"] = changes["cooldown_seconds"]
    return _public_assignment(assignment)


if __name__ == "__main__":
    port = int(os.environ.get("MOCK_DPROXY_PORT", "9200"))
    print(
        f"Mock DProxy listening on :{port}; auth_type={AUTH_TYPE!r}; "
        f"api_key={API_KEY!r}; control_key={CONTROL_KEY!r}",
        flush=True,
    )
    uvicorn.run(app, host="0.0.0.0", port=port)
