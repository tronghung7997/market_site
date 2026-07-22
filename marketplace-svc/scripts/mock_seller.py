"""Standalone mock seller backend.

Simulates a real seller's HTTP API for the two fulfillment paths that don't
have a real upstream integration yet: `credit` (per-request pass-through,
ScraperAPI-style — see adapter_type `seller_gateway`) and `task` (submit-job
+ webhook callback — adapter_type `seller_task_webhook`). Point a
marketplace-svc Provider's base_url at this process and every buyer call that
reaches it is logged on BOTH sides: marketplace-svc writes one
provider_call_logs row per HTTP attempt (see adapters/call_log.py), and this
process prints one line per request it receives — so you can watch a single
buyer action produce a traceable call chain end to end.

Follows the project's existing "mock at the HTTP layer, not by writing a
special-case adapter" principle (see
docs/superpowers/specs/2026-07-03-pricing-engine-admin-design.md §6b.5):
marketplace-svc talks to this exactly like it would talk to a real seller
backend — RealApiAdapter/SellerTaskWebhookAdapter don't know or care that
the other end is fake. Swapping this for a real seller integration later is
only a base_url + api_key change in /admin/providers, no code change.

Run:
    cd marketplace-svc
    uv run uvicorn scripts.mock_seller:app --port 9100 --reload

Then in /admin/providers, create a provider:
    adapter_type = seller_gateway   (or seller_task_webhook, for tasks)
    config = {
        "base_url": "http://localhost:9100",
        "api_key": "mock-seller-secret",       # must match MOCK_SELLER_API_KEY below
        "webhook_secret": "mock-webhook-secret" # only needed for seller_task_webhook
    }
Gán provider đó vào một sản phẩm strategy=credit (hoặc task), mua thử, rồi
gọi qua {backend_base_url}/gw/{gateway_key}/search?q=hello — log sẽ hiện ở cả
hai console (marketplace-svc: request_id + provider_call_logs row; ở đây:
dòng "call action='search' ...").
"""
import asyncio
import hashlib
import hmac
import json
import os
import random
import time
import uuid
from datetime import datetime, timezone

import httpx
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request

MOCK_SELLER_API_KEY = os.environ.get("MOCK_SELLER_API_KEY", "mock-seller-secret")
WEBHOOK_SECRET = os.environ.get("MOCK_SELLER_WEBHOOK_SECRET", "mock-webhook-secret")
TASK_PROCESSING_SECONDS = (2.0, 5.0)
FAILURE_RATE = 0.05  # simulate occasional real-world flakiness, exercises retry/refund paths

app = FastAPI(title="Mock Seller Backend")

_resources: dict[str, dict] = {}
_tasks: dict[str, dict] = {}


def _log(tag: str, **fields) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    extra = " ".join(f"{k}={v!r}" for k, v in fields.items())
    print(f"[mock-seller {ts}] {tag} {extra}", flush=True)


def _check_auth(authorization: str | None) -> None:
    if authorization != f"Bearer {MOCK_SELLER_API_KEY}":
        _log("auth_rejected", got=authorization)
        raise HTTPException(status_code=401, detail="invalid api key")


@app.get("/health")
async def health():
    _log("health_check")
    return {"status": "ok", "resources": len(_resources), "tasks": len(_tasks)}


# ---------------------------------------------------------------------------
# Provision contract (RealApiAdapter) — one-shot, at order creation time
# ---------------------------------------------------------------------------


@app.post("/provision")
async def provision(request: Request, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    body = await request.json()
    order_id = body.get("order_id")
    resource_id = f"mockres_{uuid.uuid4().hex[:12]}"
    _resources[resource_id] = {"order_id": order_id, "calls": 0, "created_at": time.time()}
    _log("provision", order_id=order_id, resource_id=resource_id,
         user_config={k: v for k, v in body.items() if k != "order_id"})
    return {"success": True, "data": f"session issued for order {order_id}", "resource_id": resource_id}


@app.get("/resources/{resource_id}/usage")
async def resource_usage(resource_id: str, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    res = _resources.get(resource_id)
    if not res:
        raise HTTPException(status_code=404, detail="unknown resource")
    return {"calls": res["calls"], "age_seconds": int(time.time() - res["created_at"])}


@app.delete("/resources/{resource_id}")
async def revoke_resource(resource_id: str, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    existed = _resources.pop(resource_id, None) is not None
    _log("revoke", resource_id=resource_id, existed=existed)
    return {"success": True}


# ---------------------------------------------------------------------------
# Task submission + webhook callback — task / seller_task_webhook
#
# Registered BEFORE the /v1/{action} catch-all below: Starlette dispatches to
# the first route whose path matches, in registration order, and does not
# fall through to a later route if the handler raises — so the more specific
# /v1/tasks[/...] paths must come first or the catch-all would shadow them.
# ---------------------------------------------------------------------------


async def _process_task(task_id: str, callback_url: str | None) -> None:
    await asyncio.sleep(random.uniform(*TASK_PROCESSING_SECONDS))
    task = _tasks.get(task_id)
    if not task:
        return
    task["status"] = "failed" if random.random() < FAILURE_RATE else "completed"
    task["result_data"] = f"mock result for {task['target']} ({task['task_type']})"
    _log("task_finished", task_id=task_id, status=task["status"])

    if not callback_url:
        return
    payload = {"status": task["status"], "result_data": task["result_data"]}
    raw = json.dumps(payload).encode()
    signature = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(
                f"{callback_url}/{task_id}", content=raw,
                headers={"Content-Type": "application/json", "X-Signature": signature},
            )
            _log("webhook_sent", task_id=task_id, status_code=resp.status_code)
        except httpx.HTTPError as e:
            _log("webhook_failed", task_id=task_id, error=str(e))


@app.post("/v1/tasks")
async def submit_task(request: Request, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    body = await request.json()
    task_id = f"mocktask_{uuid.uuid4().hex[:12]}"
    _tasks[task_id] = {
        "order_id": body.get("order_id"), "task_type": body.get("task_type"),
        "target": body.get("target"), "status": "queued", "result_data": None,
    }
    _log("task_submitted", task_id=task_id, task_type=body.get("task_type"), target=body.get("target"))
    asyncio.create_task(_process_task(task_id, body.get("callback_url")))
    return {"external_task_id": task_id, "status": "queued"}


@app.get("/v1/tasks/{task_id}")
async def get_task(task_id: str, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="unknown task")
    return task


# ---------------------------------------------------------------------------
# Per-request pass-through — credit / seller_gateway
# (RealApiAdapter.call(), forwarded per-call by src/gateway/router.py)
# ---------------------------------------------------------------------------

_CANNED_RESULTS = {
    "search": lambda q: {"query": q, "results": [f"result-{i}-for-{q}" for i in range(3)]},
    "scrape": lambda q: {"url": q, "html": f"<html><body>mock content for {q}</body></html>"},
}


@app.api_route("/v1/{action}", methods=["GET", "POST"])
async def call_endpoint(action: str, request: Request, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    params = dict(request.query_params)
    raw = await request.body()
    body = json.loads(raw) if raw else {}
    for res in _resources.values():
        res["calls"] += 1
        break  # demo bookkeeping only — a real backend would key this by caller
    _log("call", action=action, params=params, body=body)

    if random.random() < FAILURE_RATE:
        _log("call_simulated_failure", action=action)
        raise HTTPException(status_code=503, detail="upstream temporarily unavailable (simulated)")

    query = params.get("q") or body.get("q") or params.get("url") or body.get("url") or action
    builder = _CANNED_RESULTS.get(action, lambda q: {"action": action, "echo": q})
    return builder(query)


if __name__ == "__main__":
    port = int(os.environ.get("MOCK_SELLER_PORT", "9100"))
    print(
        f"Mock seller listening on :{port} — register as a Provider with "
        f"base_url=http://localhost:{port}, api_key={MOCK_SELLER_API_KEY!r}, "
        f"webhook_secret={WEBHOOK_SECRET!r}"
    )
    uvicorn.run(app, host="0.0.0.0", port=port)
