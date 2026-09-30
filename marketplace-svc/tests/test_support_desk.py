"""Admin support desk: ticket list/views/counts/cursor, lifecycle transitions
(chat.tickets), blocked requesters, auto-reopen, assignment, tags, notes,
context, stats and canned replies."""
import uuid

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.chat import ChatConversation
from tests.conftest import make_admin, make_seller, register_and_login


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _say(client, token, body, role=None):
    return await client.post(
        "/chat/helpdesk/messages", params={"role": role} if role else None,
        json={"body": body, "client_message_id": str(uuid.uuid4())}, headers=_auth(token),
    )


async def _send(client, token, room_id, body):
    return await client.post(
        f"/chat/conversations/{room_id}/messages",
        json={"body": body, "client_message_id": str(uuid.uuid4())}, headers=_auth(token),
    )


async def _admin(client, email="desk-admin@example.com"):
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


async def _admin_id(client, token):
    return (await client.get("/me", headers=_auth(token))).json()["id"]


@pytest.mark.asyncio
async def test_list_views_counts_and_ticket_shape(client):
    admin = await _admin(client)
    buyer = await register_and_login(client, "t-buyer@example.com")
    await register_and_login(client, "t-seller@example.com")
    await make_seller("t-seller@example.com")
    seller = await register_and_login(client, "t-seller@example.com")

    a = (await _say(client, buyer, "Nạp tiền chưa vào ví")).json()
    b = (await _say(client, seller, "Rút tiền shop bị treo", role="seller")).json()
    assert (await _send(client, admin, b["id"], "Đang kiểm tra giúp bạn")).status_code == 201

    page = (await client.get("/admin/support", headers=_auth(admin))).json()
    assert page["counts"] == {"waiting": 1, "mine": 0, "open": 2, "resolved": 0}
    ids = [t["id"] for t in page["items"]]
    assert set(ids) == {a["id"], b["id"]}
    ticket = next(t for t in page["items"] if t["id"] == a["id"])
    assert ticket["requester"] == {"id": ticket["requester"]["id"], "email": "t-buyer@example.com", "role": "buyer"}
    assert ticket["waiting_since"] and ticket["assignee"] is None and ticket["tags"] == []
    assert ticket["last_message_preview"] == "Nạp tiền chưa vào ví" and ticket["status"] == "open"
    answered = next(t for t in page["items"] if t["id"] == b["id"])
    assert answered["waiting_since"] is None and answered["first_response_at"]

    waiting = (await client.get("/admin/support", params={"view": "waiting"}, headers=_auth(admin))).json()
    assert [t["id"] for t in waiting["items"]] == [a["id"]]
    sellers = (await client.get("/admin/support", params={"role": "seller"}, headers=_auth(admin))).json()
    assert [t["id"] for t in sellers["items"]] == [b["id"]]
    found = (await client.get("/admin/support", params={"q": "t-buyer@"}, headers=_auth(admin))).json()
    assert [t["id"] for t in found["items"]] == [a["id"]]
    body_hit = (await client.get("/admin/support", params={"q": "shop bị treo"}, headers=_auth(admin))).json()
    assert [t["id"] for t in body_hit["items"]] == [b["id"]]

    # Cursor pagination walks every ticket once.
    first = (await client.get("/admin/support", params={"limit": 1}, headers=_auth(admin))).json()
    assert len(first["items"]) == 1 and first["next_cursor"]
    second = (await client.get("/admin/support", params={"limit": 1, "cursor": first["next_cursor"]},
                               headers=_auth(admin))).json()
    assert len(second["items"]) == 1 and second["next_cursor"] is None
    assert {first["items"][0]["id"], second["items"][0]["id"]} == {a["id"], b["id"]}

    single = await client.get(f"/admin/support/{a['id']}", headers=_auth(admin))
    assert single.status_code == 200 and single.json()["id"] == a["id"]
    stats = (await client.get("/admin/support/stats", headers=_auth(admin))).json()
    assert stats["waiting"] == 1 and stats["oldest_waiting_at"] and stats["avg_first_response_minutes_7d"] is not None


@pytest.mark.asyncio
async def test_transitions_auto_reopen_and_409(client):
    admin = await _admin(client)
    buyer = await register_and_login(client, "t-reopen@example.com")
    room = (await _say(client, buyer, "Cần hỗ trợ")).json()
    rid = room["id"]

    resolved = await client.post(f"/admin/support/{rid}/status", json={"status": "resolved", "notify_requester": True},
                                 headers=_auth(admin))
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved" and resolved.json()["resolved_at"]
    thread = (await client.get("/chat/helpdesk", headers=_auth(buyer))).json()
    assert thread["messages"][-1]["sender_role"] == "admin" and "Đã xử lý" in thread["messages"][-1]["body"]
    assert thread["can_send"] is True

    # resolved → resolved and resolved → blocked are not transitions.
    again = await client.post(f"/admin/support/{rid}/status", json={"status": "resolved"}, headers=_auth(admin))
    assert again.status_code == 409 and again.json()["error_code"] == "TICKET_INVALID_TRANSITION"
    blocked = await client.post(f"/admin/support/{rid}/status", json={"status": "blocked", "reason": "spam"},
                                headers=_auth(admin))
    assert blocked.status_code == 409

    # The requester writing again reopens the ticket.
    assert (await _say(client, buyer, "Vẫn chưa được")).status_code == 200
    ticket = (await client.get(f"/admin/support/{rid}", headers=_auth(admin))).json()
    assert ticket["status"] == "open" and ticket["resolved_at"] is None and ticket["waiting_since"]

    closed = await client.post(f"/admin/support/{rid}/status", json={"status": "closed"}, headers=_auth(admin))
    assert closed.json()["status"] == "closed"
    refused = await _say(client, buyer, "Alo")
    assert refused.status_code == 409 and refused.json()["error_code"] == "CHAT_READ_ONLY"
    assert (await _send(client, admin, rid, "admin cũng không gửi được")).status_code == 409
    reopened = await client.post(f"/admin/support/{rid}/status", json={"status": "open"}, headers=_auth(admin))
    assert reopened.json()["status"] == "open"

    history = (await client.get("/admin/audit/entity", params={"type": "conversation", "id": rid},
                                headers=_auth(admin))).json()
    moves = [(h["details"]["from"], h["details"]["to"], h["details"]["auto"]) for h in history
             if h["event"] == "ticket_status_changed"]
    assert moves == [("closed", "open", False), ("open", "closed", False), ("resolved", "open", True),
                     ("open", "resolved", False)]
    bad = await client.post(f"/admin/support/{rid}/status", json={"status": "read_only"}, headers=_auth(admin))
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_blocked_requester_gets_403_but_admin_can_write(client):
    admin = await _admin(client)
    buyer = await register_and_login(client, "t-block@example.com")
    rid = (await _say(client, buyer, "spam spam")).json()["id"]

    no_reason = await client.post(f"/admin/support/{rid}/status", json={"status": "blocked"}, headers=_auth(admin))
    assert no_reason.status_code == 422
    blocked = await client.post(f"/admin/support/{rid}/status", json={"status": "blocked", "reason": "Spam lặp lại"},
                                headers=_auth(admin))
    assert blocked.status_code == 200 and blocked.json()["blocked_reason"] == "Spam lặp lại"

    refused = await _say(client, buyer, "cho tôi nói")
    assert refused.status_code == 403 and refused.json()["error_code"] == "CHAT_BLOCKED"
    refused = await _send(client, buyer, rid, "qua đường khác")
    assert refused.status_code == 403
    thread = (await client.get("/chat/helpdesk", headers=_auth(buyer))).json()
    assert thread["can_send"] is False and thread["read_only_reason"]
    assert (await _send(client, admin, rid, "Bạn đã bị khoá chat")).status_code == 201

    ctx = (await client.get(f"/admin/support/{rid}/context", headers=_auth(admin))).json()
    assert ctx["status"] == "blocked" and ctx["blocked_reason"] == "Spam lặp lại"
    unblocked = await client.post(f"/admin/support/{rid}/status", json={"status": "open"}, headers=_auth(admin))
    assert unblocked.json()["blocked_reason"] is None
    assert (await _say(client, buyer, "cảm ơn")).status_code == 200


@pytest.mark.asyncio
async def test_assign_tags_notes_and_context(client):
    admin = await _admin(client)
    other_admin = await _admin(client, "desk-admin2@example.com")
    buyer = await register_and_login(client, "t-assign@example.com")
    rid = (await _say(client, buyer, "Hỏi về đơn")).json()["id"]
    me = await _admin_id(client, admin)
    buyer_id = await _admin_id(client, buyer)

    mine = await client.post(f"/admin/support/{rid}/assign", json={"assignee_id": me}, headers=_auth(admin))
    assert mine.status_code == 200 and mine.json()["assignee"] == {"id": me, "email": "desk-admin@example.com"}
    assert (await client.get("/admin/support", params={"view": "mine"}, headers=_auth(admin))).json()["counts"]["mine"] == 1
    assert (await client.get("/admin/support", params={"view": "mine"}, headers=_auth(other_admin))).json()["items"] == []
    unassigned = (await client.get("/admin/support", params={"assignee": "none"}, headers=_auth(admin))).json()
    assert unassigned["items"] == []
    to_buyer = await client.post(f"/admin/support/{rid}/assign", json={"assignee_id": buyer_id}, headers=_auth(admin))
    assert to_buyer.status_code == 422 and to_buyer.json()["error_code"] == "TICKET_ASSIGNEE_INVALID"
    cleared = await client.post(f"/admin/support/{rid}/assign", json={"assignee_id": None}, headers=_auth(admin))
    assert cleared.json()["assignee"] is None

    tagged = await client.put(f"/admin/support/{rid}/tags", json={"tags": [" Nạp Tiền ", "vip", "vip"]},
                              headers=_auth(admin))
    assert tagged.status_code == 200 and tagged.json()["tags"] == ["nạp tiền", "vip"]
    assert (await client.put(f"/admin/support/{rid}/tags", json={"tags": ["x" * 41]}, headers=_auth(admin))).status_code == 422
    assert (await client.put(f"/admin/support/{rid}/tags", json={"tags": [str(i) for i in range(11)]},
                             headers=_auth(admin))).status_code == 422
    assert (await client.get("/admin/support/tags", headers=_auth(admin))).json() == [
        {"tag": "nạp tiền", "count": 1}, {"tag": "vip", "count": 1},
    ]
    by_tag = (await client.get("/admin/support", params={"tag": "vip"}, headers=_auth(admin))).json()
    assert [t["id"] for t in by_tag["items"]] == [rid]

    note = await client.post(f"/admin/support/{rid}/notes", json={"body": "Khách quen, ưu tiên"}, headers=_auth(admin))
    assert note.status_code == 201 and note.json()["author_email"] == "desk-admin@example.com"
    notes = (await client.get(f"/admin/support/{rid}/notes", headers=_auth(admin))).json()
    assert [n["body"] for n in notes] == ["Khách quen, ưu tiên"]
    assert (await client.post(f"/admin/support/{rid}/notes", json={"body": "  "}, headers=_auth(admin))).status_code == 422
    # Notes never reach the requester's thread.
    thread = (await client.get("/chat/helpdesk", headers=_auth(buyer))).json()
    assert all("ưu tiên" not in m["body"] for m in thread["messages"])

    ctx = (await client.get(f"/admin/support/{rid}/context", headers=_auth(admin))).json()
    assert ctx["requester"]["email"] == "t-assign@example.com" and ctx["requester"]["orders_bought"] == 0
    assert ctx["order"] is None and ctx["tags"] == ["nạp tiền", "vip"] and ctx["previous_tickets"] == []

    assert (await client.get(f"/admin/support/{uuid.uuid4()}/context", headers=_auth(admin))).status_code == 404


@pytest.mark.asyncio
async def test_non_admin_is_refused_everywhere(client):
    buyer = await register_and_login(client, "t-nonadmin@example.com")
    rid = (await _say(client, buyer, "hi")).json()["id"]
    calls = [
        ("get", "/admin/support", None), ("get", "/admin/support/stats", None), ("get", "/admin/support/tags", None),
        ("get", f"/admin/support/{rid}", None), ("get", f"/admin/support/{rid}/context", None),
        ("post", f"/admin/support/{rid}/status", {"status": "resolved"}),
        ("post", f"/admin/support/{rid}/assign", {"assignee_id": None}),
        ("put", f"/admin/support/{rid}/tags", {"tags": ["x"]}),
        ("get", f"/admin/support/{rid}/notes", None), ("post", f"/admin/support/{rid}/notes", {"body": "x"}),
        ("get", "/admin/canned-replies", None),
        ("post", "/admin/canned-replies", {"shortcut": "a", "title": "a", "body": "a"}),
        ("patch", "/admin/canned-replies/1", {"title": "b"}), ("delete", "/admin/canned-replies/1", None),
    ]
    for method, url, body in calls:
        kwargs = {"headers": _auth(buyer)}
        if body is not None:
            kwargs["json"] = body
        assert (await getattr(client, method)(url, **kwargs)).status_code == 403, url
    assert (await client.get("/admin/support")).status_code == 401
    async with SessionLocal() as db:
        room = await db.scalar(select(ChatConversation).where(ChatConversation.id == uuid.UUID(rid)))
        assert room.status == "open"


@pytest.mark.asyncio
async def test_canned_replies_crud(client):
    admin = await _admin(client)
    created = await client.post("/admin/canned-replies", json={
        "shortcut": "/Chao", "title": "Chào khách", "body": "Chào {ten}, đơn {ma_don} đang được xử lý.",
    }, headers=_auth(admin))
    assert created.status_code == 201, created.text
    reply = created.json()
    assert reply["shortcut"] == "chao" and reply["owner_type"] == "admin" and reply["owner_id"] is None
    assert "{ten}" in reply["body"]

    dup = await client.post("/admin/canned-replies", json={"shortcut": "chao", "title": "x", "body": "y"},
                            headers=_auth(admin))
    assert dup.status_code == 409 and dup.json()["error_code"] == "CANNED_REPLY_SHORTCUT_TAKEN"
    for bad in ({"shortcut": "có dấu", "title": "x", "body": "y"}, {"shortcut": "ok", "title": "", "body": "y"},
                {"shortcut": "ok", "title": "x", "body": "y" * 2001}):
        assert (await client.post("/admin/canned-replies", json=bad, headers=_auth(admin))).status_code == 422

    other = (await client.post("/admin/canned-replies", json={"shortcut": "hoan", "title": "Hoàn", "body": "Đã hoàn"},
                               headers=_auth(admin))).json()
    patched = await client.patch(f"/admin/canned-replies/{reply['id']}", json={"title": "Lời chào"}, headers=_auth(admin))
    assert patched.status_code == 200 and patched.json()["title"] == "Lời chào" and patched.json()["shortcut"] == "chao"
    clash = await client.patch(f"/admin/canned-replies/{other['id']}", json={"shortcut": "chao"}, headers=_auth(admin))
    assert clash.status_code == 409
    bad_patch = await client.patch(f"/admin/canned-replies/{other['id']}", json={"shortcut": "x y"}, headers=_auth(admin))
    assert bad_patch.status_code == 422

    listed = (await client.get("/admin/canned-replies", headers=_auth(admin))).json()
    assert [r["shortcut"] for r in listed] == ["chao", "hoan"]
    assert (await client.delete(f"/admin/canned-replies/{other['id']}", headers=_auth(admin))).status_code == 204
    assert (await client.delete(f"/admin/canned-replies/{other['id']}", headers=_auth(admin))).status_code == 404
    assert [r["shortcut"] for r in (await client.get("/admin/canned-replies", headers=_auth(admin))).json()] == ["chao"]
