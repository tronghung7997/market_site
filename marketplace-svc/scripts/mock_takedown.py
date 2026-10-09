"""Standalone mock of the takedown partner ("Takedown Module", API.vi.md).

Speaks the partner's wire format so src/takedown/client.py talks to it exactly
as it would to the real service ("mock at the HTTP layer", like
scripts/mock_topproxy.py): `/api/v1` prefix, `X-API-Key` (admin key or member
`tdk_...` key), `{status, message, data, meta, errors}` envelope, naive UTC+7
times, signed `order.status_changed` webhooks with 4 tries (0, 1, 5, 25 s) and
an auto `in_warranty → success` job.

Run:
    cd marketplace-svc
    uv run uvicorn scripts.mock_takedown:app --port 9402

Point the marketplace at it (local .env or shell, never real values):
    TAKEDOWN_API_BASE_URL=http://127.0.0.1:9402/api/v1
    TAKEDOWN_CLIENT_KEY=tdk_mock_gmmo
    TAKEDOWN_WEBHOOK_SECRET=mock-takedown-webhook-secret

Partner side of the flow (quote, confirm-payment, complete, fail, warranty
accept/reject, refund, evidence) is driven from the control page
http://127.0.0.1:9402/_mock — or with curl and the admin key, like the real
admin would.

Env:
    MOCK_TAKEDOWN_ADMIN_KEY      admin key (default mock-takedown-admin)
    MOCK_TAKEDOWN_CLIENT_KEY     member key (default tdk_mock_gmmo)
    MOCK_TAKEDOWN_CLIENT         member email (default gmmo@mock.local)
    MOCK_TAKEDOWN_WEBHOOK_URL    where to push events (default http://127.0.0.1:8002/webhooks/takedown, empty = off)
    MOCK_TAKEDOWN_WEBHOOK_SECRET HMAC secret (default mock-takedown-webhook-secret)
    MOCK_TAKEDOWN_WARRANTY_SCALE seconds per warranty hour (default 3600; 5 → a 24h warranty ends in 2 min)
    MOCK_TAKEDOWN_DROP_WEBHOOKS  1 = never deliver webhooks (exercises the polling safety net)
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import html
import json
import os
import re
import struct
import time
import zlib
from datetime import UTC, datetime, timedelta, timezone
from urllib.parse import parse_qs

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

ADMIN_KEY = os.environ.get("MOCK_TAKEDOWN_ADMIN_KEY", "mock-takedown-admin")
CLIENT_KEY = os.environ.get("MOCK_TAKEDOWN_CLIENT_KEY", "tdk_mock_gmmo")
CLIENT = os.environ.get("MOCK_TAKEDOWN_CLIENT", "gmmo@mock.local")
WEBHOOK_URL = os.environ.get("MOCK_TAKEDOWN_WEBHOOK_URL", "http://127.0.0.1:8002/webhooks/takedown")
WEBHOOK_SECRET = os.environ.get("MOCK_TAKEDOWN_WEBHOOK_SECRET", "mock-takedown-webhook-secret")
WARRANTY_SCALE = float(os.environ.get("MOCK_TAKEDOWN_WARRANTY_SCALE", "3600"))
DROP_WEBHOOKS = os.environ.get("MOCK_TAKEDOWN_DROP_WEBHOOKS") == "1"

UTC7 = timezone(timedelta(hours=7))
SERVICES = {"article_copyright", "profile_impersonation", "profile_copyright", "group_copyright"}
PLATFORM_RE = re.compile(r"^[a-z][a-z0-9_-]*$")
EVIDENCE_OK = {"in_warranty", "warranty_pending", "success"}
RETRY_DELAYS = (0, 1, 5, 25)

# action → (role, from statuses, to status, note required)
ACTIONS: dict[str, tuple[str, set[str], str | None, bool]] = {
    "reject": ("admin", {"pending_review"}, "rejected", True),
    "accept": ("member", {"quoted"}, "awaiting_payment", False),
    "decline": ("member", {"quoted"}, "quote_rejected", False),
    "cancel": ("member", {"pending_review", "quoted", "awaiting_payment"}, "cancelled", False),
    "confirm-payment": ("admin", {"awaiting_payment"}, "processing", False),
    "complete": ("admin", {"processing"}, "in_warranty", False),
    "warranty": ("member", {"in_warranty"}, "warranty_pending", True),
    "warranty-accept": ("admin", {"warranty_pending"}, "processing", False),
    "warranty-reject": ("admin", {"warranty_pending"}, "in_warranty", True),
    "fail": ("admin", {"processing", "in_warranty"}, "failed", True),
    "refund": ("admin", {"failed"}, None, False),
}
TERMINAL_ON = {"rejected", "quote_rejected", "cancelled", "failed"}

app = FastAPI(title="Mock Takedown Module", docs_url=None, redoc_url=None)

# Ids start from the clock so a restarted mock never hands out an id the
# marketplace already stored (partner_order_id is UNIQUE there).
_seq = {"order": int(time.time()) % 10_000_000, "event": int(time.time())}
_orders: dict[int, dict] = {}
_evidence: dict[int, dict] = {}
_events: dict[int, list[dict]] = {}
_deliveries: list[dict] = []


def _now() -> datetime:
    return datetime.now(UTC)


def _fmt(value: datetime | None) -> str | None:
    return value.astimezone(UTC7).strftime("%Y-%m-%d %H:%M:%S") if value else None


def _public(order: dict) -> dict:
    return {k: (_fmt(v) if isinstance(v, datetime) else v) for k, v in order.items()}


def ok(data, message: str, code: int = 200) -> JSONResponse:
    return JSONResponse({"status": "success", "message": message, "data": data, "meta": None, "errors": None}, status_code=code)


def err(code: int, message: str, errors: list | None = None) -> JSONResponse:
    return JSONResponse({"status": "error", "message": message, "data": None, "meta": None, "errors": errors}, status_code=code)


def _role(request: Request) -> str | None:
    key = request.headers.get("x-api-key")
    if key and hmac.compare_digest(key, ADMIN_KEY):
        return "admin"
    if key and hmac.compare_digest(key, CLIENT_KEY):
        return "member"
    return None


def _visible(order_id: int, role: str) -> dict | None:
    order = _orders.get(order_id)
    if order is None or (role == "member" and order["client"] != CLIENT):
        return None
    return order


def _sign(raw: bytes, ts: str) -> str:
    return "sha256=" + hmac.new(WEBHOOK_SECRET.encode(), ts.encode() + b"." + raw, hashlib.sha256).hexdigest()


async def _deliver(event: dict) -> None:
    if not WEBHOOK_URL:
        return
    raw = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode()
    record = {"id": event["id"], "action": event["data"]["action"], "to": event["data"]["to_status"], "tries": []}
    _deliveries.insert(0, record)
    del _deliveries[50:]
    if DROP_WEBHOOKS:
        record["tries"].append("dropped")
        return
    for delay in RETRY_DELAYS:
        await asyncio.sleep(delay)
        ts = str(int(time.time()))
        headers = {"Content-Type": "application/json", "X-Webhook-Id": str(event["id"]),
                   "X-Webhook-Timestamp": ts, "X-Webhook-Signature": _sign(raw, ts)}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(WEBHOOK_URL, content=raw, headers=headers)
            record["tries"].append(r.status_code)
            if 200 <= r.status_code < 300:
                return
        except httpx.HTTPError as exc:
            record["tries"].append(type(exc).__name__)


def _record(order: dict, action: str, from_status: str | None, actor_role: str, note: str | None) -> None:
    _seq["event"] += 1
    actor_id = "admin" if actor_role == "admin" else "system" if actor_role == "system" else order["client"]
    now = _now()
    _events.setdefault(order["id"], []).append({
        "id": _seq["event"], "from_status": from_status, "to_status": order["status"],
        "actor_id": actor_id, "actor_role": actor_role, "note": note, "created_at": _fmt(now),
    })
    event = {
        "id": _seq["event"], "type": "order.status_changed", "created_at": _fmt(now),
        "data": {
            "order_id": order["id"], "client": order["client"], "service": order["service"],
            "platform": order["platform"], "target_url": order["target_url"], "action": action,
            "from_status": from_status, "to_status": order["status"], "actor_role": actor_role,
            "note": note, "price": order["price"], "warranty_until": _fmt(order["warranty_until"]),
        },
    }
    asyncio.get_running_loop().create_task(_deliver(event))


def _apply(order: dict, action: str, role: str, note: str | None, price=None) -> JSONResponse | None:
    """Run one action; returns an error response or None."""
    if action == "quote":
        if role != "admin":
            return err(403, "Only admin can quote")
        if order["status"] != "pending_review":
            return err(409, f"Cannot quote an order in status {order['status']}")
        if not isinstance(price, int) or isinstance(price, bool) or price <= 0:
            return err(422, "price must be > 0", [{"field": "price", "message": "price must be > 0"}])
        before = order["status"]
        order.update(status="quoted", price=price, updated_at=_now())
        _record(order, "quote", before, role, note)
        return None
    spec = ACTIONS.get(action)
    if spec is None:
        return err(404, "Not Found")
    who, sources, target, needs_note = spec
    if role != who:
        return err(403, f"Only {who} can {action}")
    if order["status"] not in sources:
        return err(409, f"Cannot {action} an order in status {order['status']}")
    if needs_note and not (note or "").strip():
        return err(422, f"note is required to {action}", [{"field": "note", "message": f"note is required to {action}"}])
    now = _now()
    if action == "warranty" and order["warranty_until"] and now >= order["warranty_until"]:
        return err(409, "Warranty period has ended")
    if action == "refund":
        if order["refunded_at"]:
            return err(409, "Already refunded")
        order.update(refunded_at=now, updated_at=now)
        _record(order, "refund", "failed", role, note)
        return None
    before = order["status"]
    order.update(status=target, updated_at=now)
    if action == "complete":
        order["warranty_until"] = now + timedelta(seconds=order["warranty_hours"] * WARRANTY_SCALE)
    if action in {"warranty-accept", "fail"}:
        order["warranty_until"] = None
    if target in TERMINAL_ON:
        order["completed_at"] = now
    _record(order, action, before, role, note)
    return None


async def _auto_success() -> None:
    while True:
        await asyncio.sleep(5)
        now = _now()
        for order in list(_orders.values()):
            if order["status"] == "in_warranty" and order["warranty_until"] and order["warranty_until"] <= now:
                order.update(status="success", completed_at=now, updated_at=now)
                _record(order, "auto_success", "in_warranty", "system", None)


@app.on_event("startup")
async def _start() -> None:
    app.state.job = asyncio.create_task(_auto_success())


@app.on_event("shutdown")
async def _stop() -> None:
    app.state.job.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await app.state.job


@app.get("/health")
async def health():
    return {"status": "ok", "service": "Takedown Module"}


async def _body(request: Request) -> dict:
    try:
        data = await request.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


@app.post("/api/v1/orders")
async def create_order(request: Request):
    role = _role(request)
    if role is None:
        return err(401, "Invalid API key")
    if role != "member":
        return err(403, "Only member can create")
    body = await _body(request)
    errors = []
    if body.get("service") not in SERVICES:
        errors.append({"field": "service", "message": "Input should be a valid service"})
    platform = body.get("platform")
    if not isinstance(platform, str) or not (2 <= len(platform) <= 20) or not PLATFORM_RE.match(platform):
        errors.append({"field": "platform", "message": "Invalid platform"})
    url = body.get("target_url")
    if not isinstance(url, str) or not (1 <= len(url) <= 2048):
        errors.append({"field": "target_url", "message": "Invalid target_url"})
    reason = body.get("reason")
    if reason is not None and (not isinstance(reason, str) or len(reason) > 2000):
        errors.append({"field": "reason", "message": "reason too long"})
    if body.get("warranty_hours") not in (24, 72):
        errors.append({"field": "warranty_hours", "message": "Input should be 24 or 72"})
    if errors:
        return err(422, "Validation error", errors)
    _seq["order"] += 1
    now = _now()
    order = {
        "id": _seq["order"], "client": CLIENT, "service": body["service"], "platform": platform,
        "target_url": url, "reason": reason, "warranty_hours": body["warranty_hours"], "price": None,
        "status": "pending_review", "warranty_until": None, "refunded_at": None, "completed_at": None,
        "created_at": now, "updated_at": now,
    }
    _orders[order["id"]] = order
    _record(order, "create", None, "member", None)
    return ok(_public(order), "Order created", 201)


@app.get("/api/v1/orders")
async def list_orders(request: Request, status: str | None = None, service: str | None = None):
    role = _role(request)
    if role is None:
        return err(401, "Invalid API key")
    rows = [o for o in _orders.values() if (role == "admin" or o["client"] == CLIENT)
            and (not status or o["status"] == status) and (not service or o["service"] == service)]
    return ok([_public(o) for o in sorted(rows, key=lambda o: o["id"], reverse=True)], "Orders retrieved")


@app.get("/api/v1/orders/{order_id}")
async def get_order(order_id: int, request: Request):
    role = _role(request)
    if role is None:
        return err(401, "Invalid API key")
    order = _visible(order_id, role)
    return ok(_public(order), "Order retrieved") if order else err(404, "Order not found")


@app.get("/api/v1/orders/{order_id}/events")
async def get_events(order_id: int, request: Request):
    role = _role(request)
    if role is None:
        return err(401, "Invalid API key")
    if not _visible(order_id, role):
        return err(404, "Order not found")
    return ok(_events.get(order_id, []), "Events retrieved")


@app.get("/api/v1/orders/{order_id}/evidence")
async def get_evidence(order_id: int, request: Request):
    role = _role(request)
    if role is None:
        return err(401, "Invalid API key")
    order = _visible(order_id, role)
    if not order:
        return err(404, "Order not found")
    if role == "member" and order["status"] not in EVIDENCE_OK:
        return err(409, "Evidence is available after the order is done")
    ev = _evidence.get(order_id, {})
    return ok({"id": order_id, "evidence_live_url": ev.get("live"), "evidence_dead_url": ev.get("dead")}, "Evidence retrieved")


@app.put("/api/v1/orders/{order_id}/evidence")
async def put_evidence(order_id: int, request: Request):
    role = _role(request)
    if role is None:
        return err(401, "Invalid API key")
    if role != "admin":
        return err(403, "Only admin can set evidence")
    order = _visible(order_id, role)
    if not order:
        return err(404, "Order not found")
    if order["status"] not in EVIDENCE_OK:
        return err(409, "Evidence is available after the order is done")
    body = await _body(request)
    live, dead = body.get("live_url"), body.get("dead_url")
    if not all(isinstance(u, str) and re.match(r"^https?://", u) and len(u) <= 2048 for u in (live, dead)):
        return err(422, "Validation error", [{"field": None, "message": "live_url and dead_url must be http(s) URLs"}])
    _evidence[order_id] = {"live": live, "dead": dead}
    return ok({"id": order_id, "evidence_live_url": live, "evidence_dead_url": dead}, "Evidence saved")


@app.post("/api/v1/orders/{order_id}/{action}")
async def order_action(order_id: int, action: str, request: Request):
    role = _role(request)
    if role is None:
        return err(401, "Invalid API key")
    order = _visible(order_id, role)
    if not order:
        return err(404, "Order not found")
    body = await _body(request)
    note = body.get("note")
    if note is not None and (not isinstance(note, str) or len(note) > 2000):
        return err(422, "Validation error", [{"field": "note", "message": "note too long"}])
    failure = _apply(order, action, role, note, body.get("price"))
    return failure or ok(_public(order), f"Order {action}")


# ---- control page (the partner admin's hands, local only) -------------------

_BUTTONS = {
    "pending_review": [("quote", False), ("reject", True)],
    "awaiting_payment": [("confirm-payment", False)],
    "processing": [("complete", False), ("fail", True)],
    "in_warranty": [("fail", True), ("evidence", False), ("expire", False)],
    "warranty_pending": [("warranty-accept", False), ("warranty-reject", True), ("evidence", False)],
    "success": [("evidence", False)],
    "failed": [("refund", False)],
}


def _png(rgb: tuple[int, int, int], width: int = 640, height: int = 360) -> bytes:
    """A solid-colour PNG (no Pillow needed): blue = before takedown, green = after."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    row = b"\x00" + bytes(rgb) * width
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(row * height)) + chunk(b"IEND", b""))


@app.get("/_mock/img/{kind}.png")
async def mock_image(kind: str):
    return Response(_png((37, 99, 235) if kind == "live" else (22, 163, 74)), media_type="image/png")


@app.post("/_mock/act")
async def mock_act(request: Request):
    form = {k: v[0] for k, v in parse_qs((await request.body()).decode()).items()}
    order_id = int(form.get("order_id", "0") or 0)
    action, note, price = form.get("action", ""), form.get("note", ""), form.get("price", "")
    order = _orders.get(order_id)
    if order:
        if action == "evidence":
            base = str(request.base_url).rstrip("/")
            _evidence[order_id] = {"live": f"{base}/_mock/img/live.png", "dead": f"{base}/_mock/img/dead.png"}
        elif action == "expire":
            if order["status"] == "in_warranty":
                order["warranty_until"] = _now()
        else:
            _apply(order, action, "admin", note.strip() or None, int(price) if price.strip().isdigit() else None)
    return RedirectResponse("/_mock", status_code=303)


@app.get("/_mock", response_class=HTMLResponse)
async def mock_page():
    rows = []
    for o in sorted(_orders.values(), key=lambda o: o["id"], reverse=True):
        forms = []
        for name, needs_note in _BUTTONS.get(o["status"], []):
            if name == "refund" and o["refunded_at"]:
                continue
            extra = '<input name="price" placeholder="giá vốn VND" size="10" required>' if name == "quote" else ""
            extra += '<input name="note" placeholder="note" size="14" required>' if needs_note else ""
            forms.append(f'<form method="post" action="/_mock/act"><input type="hidden" name="order_id" value="{o["id"]}">'
                         f'<input type="hidden" name="action" value="{name}">{extra}<button>{name}</button></form>')
        ev = "✓" if o["id"] in _evidence else ""
        rows.append(
            f"<tr><td>{o['id']}</td><td>{html.escape(o['status'])}</td><td>{o['price'] or ''}</td>"
            f"<td>{html.escape(o['service'])}<br><small>{html.escape((o['reason'] or '')[:60])}</small></td>"
            f"<td class=u>{html.escape(o['target_url'])}</td><td>{_fmt(o['warranty_until']) or ''}</td><td>{ev}</td>"
            f"<td>{''.join(forms)}</td></tr>")
    hooks = "".join(f"<li>#{d['id']} {html.escape(d['action'])} → {html.escape(d['to'])}: {html.escape(str(d['tries']))}</li>"
                    for d in _deliveries[:15])
    return f"""<!doctype html><meta charset=utf-8><title>Mock Takedown Module</title><meta http-equiv=refresh content=10>
<style>body{{font:13px system-ui;margin:20px}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #ddd;padding:6px;vertical-align:top;text-align:left}}
td.u{{max-width:280px;word-break:break-all}}form{{display:inline-flex;gap:4px;margin:2px}}</style>
<h1>Mock Takedown Module</h1>
<p>Webhook → <code>{html.escape(WEBHOOK_URL or 'off')}</code>{' (DROPPED)' if DROP_WEBHOOKS else ''} · 1 giờ bảo hành = {WARRANTY_SCALE:g}s · tự tải lại mỗi 10s</p>
<table><tr><th>id</th><th>status</th><th>price</th><th>service / reason</th><th>target_url</th><th>warranty_until (UTC+7)</th><th>evidence</th><th>admin</th></tr>
{''.join(rows) or '<tr><td colspan=8>Chưa có đơn</td></tr>'}</table>
<h2>Webhook gần đây</h2><ul>{hooks or '<li>—</li>'}</ul>"""
