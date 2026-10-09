"""Standalone mock of the Telegram Bot API, for the ops bot and seller bots.

Answers ``POST /bot{token}/{method}`` at the HTTP boundary, so
``src.seller_telegram.client`` cannot tell it from api.telegram.org:
``getMe``, ``getWebhookInfo``, ``deleteWebhook``, ``getUpdates`` (empty) and
``sendMessage`` (kept in memory, newest last).

Run:
    cd marketplace-svc
    uv run uvicorn scripts.mock_telegram:app --port 9455

Point one backend at it (that uvicorn only):
    TELEGRAM_API_BASE=http://127.0.0.1:9455

Any token of the BotFather shape works and answers as bot ``@<digits>_mock_bot``.
Scripted outcomes (mock only): a token containing ``revoked`` answers 401; a
chat id containing ``blocked`` (e.g. ``@blocked_channel``) answers 403; a chat
id of ``-1009999999999`` answers 429 with ``retry_after: 30``.

``GET /_sent`` lists what was sent (chat_id, text, silent), ``DELETE /_sent``
clears it.
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI(title="Mock Telegram Bot API")
SENT: list[dict] = []


def _error(status: int, description: str, **parameters) -> JSONResponse:
    body: dict = {"ok": False, "error_code": status, "description": description}
    if parameters:
        body["parameters"] = parameters
    return JSONResponse(body, status_code=status)


@app.get("/_sent")
async def sent() -> list[dict]:
    return SENT


@app.delete("/_sent")
async def clear() -> dict:
    SENT.clear()
    return {"ok": True}


@app.post("/bot{token}/{method}")
async def bot_api(token: str, method: str, request: Request):
    try:
        body = await request.json()
    except ValueError:
        body = {}
    bot_id = token.split(":", 1)[0]
    if "revoked" in token or not bot_id.isdigit():
        return _error(401, "Unauthorized")
    if method == "getMe":
        return {"ok": True, "result": {"id": int(bot_id), "is_bot": True, "first_name": "Mock Ops Bot",
                                       "username": f"{bot_id[:6]}_mock_bot"}}
    if method == "getWebhookInfo":
        return {"ok": True, "result": {"url": ""}}
    if method == "deleteWebhook":
        return {"ok": True, "result": True}
    if method == "getUpdates":
        return {"ok": True, "result": []}
    if method == "sendMessage":
        chat = str(body.get("chat_id", ""))
        if "blocked" in chat:
            return _error(403, "Forbidden: bot is not a member of the channel chat")
        if chat == "-1009999999999":
            return _error(429, "Too Many Requests: retry after 30", retry_after=30)
        SENT.append({"chat_id": body.get("chat_id"), "text": body.get("text"),
                     "silent": bool(body.get("disable_notification")), "button": body.get("reply_markup")})
        return {"ok": True, "result": {"message_id": len(SENT)}}
    return _error(404, "Not Found: method not found")
