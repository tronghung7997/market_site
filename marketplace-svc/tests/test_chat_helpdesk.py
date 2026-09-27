"""The helpdesk: standing threads between an account and the Marketplace
desk (one as a buyer, one more for a seller's shop), opened by the first
message, answered by any admin."""
import uuid

import pytest

from tests.conftest import make_admin, make_seller, register_and_login


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _say(client, token, body, role=None, **extra):
    return await client.post(
        "/chat/helpdesk/messages",
        params={"role": role} if role else None,
        json={"body": body, "client_message_id": str(uuid.uuid4()), **extra},
        headers=_auth(token),
    )


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_helpdesk_requires_sign_in(client):
    assert (await client.get("/chat/helpdesk")).status_code == 401
    assert (await client.post("/chat/helpdesk/messages", json={})).status_code == 401


@pytest.mark.asyncio
async def test_first_message_opens_one_standing_thread(client):
    token = await register_and_login(client, "desk-buyer@example.com")
    assert (await client.get("/chat/helpdesk", headers=_auth(token))).json() is None

    first = await _say(client, token, "Nạp tiền 30 phút chưa vào ví")
    assert first.status_code == 201, first.text
    room = first.json()
    assert room["kind"] == "helpdesk"
    assert room["order"] is None and room["product"] is None
    assert room["counterpart"] == {"id": "marketplace", "label": "Marketplace", "role": "admin"}
    assert room["viewer_role"] == "buyer"
    assert room["can_send"] is True

    second = await _say(client, token, "Mã NAP123 nhé, gọi 0912345678")
    assert second.status_code == 200, second.text
    assert second.json()["id"] == room["id"]
    # Talking to the desk is exempt from the off-platform contact filter.
    assert [m["body"] for m in second.json()["messages"]][-1] == "Mã NAP123 nhé, gọi 0912345678"

    current = (await client.get("/chat/helpdesk", headers=_auth(token))).json()
    assert current["id"] == room["id"] and len(current["messages"]) == 2
    inbox = (await client.get("/chat/conversations?perspective=all", headers=_auth(token))).json()
    assert [item["id"] for item in inbox["items"]] == [room["id"]]


@pytest.mark.asyncio
async def test_admin_answers_from_the_desk_inbox(client):
    user = await register_and_login(client, "desk-seller@example.com")
    await make_seller("desk-seller@example.com")
    user = await register_and_login(client, "desk-seller@example.com")
    await register_and_login(client, "desk-admin@example.com")
    await make_admin("desk-admin@example.com")
    admin = await register_and_login(client, "desk-admin@example.com")
    room = (await _say(client, user, "Cho mình hỏi cách lên hạng", role="seller")).json()
    assert room["viewer_role"] == "seller"

    inbox = await client.get("/chat/admin/support", headers=_auth(admin))
    assert inbox.status_code == 200
    item = next(i for i in inbox.json()["items"] if i["id"] == room["id"])
    assert item["kind"] == "helpdesk"
    assert item["counterpart"]["role"] == "seller"
    assert item["counterpart"]["label"] == "desk-seller"
    assert item["unread_count"] == 1
    assert item["last_message"]["sender_role"] == "seller"

    waiting = (await client.get("/admin/action-items", headers=_auth(admin))).json()
    assert next(i for i in waiting if i["key"] == "admin_helpdesk_waiting")["count"] == 1

    opened = await client.get(f"/chat/conversations/{room['id']}", headers=_auth(admin))
    assert opened.status_code == 200
    reply = await client.post(
        f"/chat/conversations/{room['id']}/messages",
        json={"body": "Chào bạn, hạng xét theo đơn hoàn tất.", "client_message_id": str(uuid.uuid4())},
        headers=_auth(admin),
    )
    assert reply.status_code == 201, reply.text
    assert reply.json()["sender_role"] == "admin"

    answered = (await client.get("/admin/action-items", headers=_auth(admin))).json()
    assert all(i["key"] != "admin_helpdesk_waiting" for i in answered)

    mine = (await client.get("/chat/conversations?perspective=all", headers=_auth(user))).json()["items"][0]
    assert mine["unread_count"] == 1
    assert mine["counterpart"]["id"] == "marketplace"
    # Admin replies are not screened either, and the user reads them in the same thread.
    thread = (await client.get("/chat/helpdesk", params={"role": "seller"}, headers=_auth(user))).json()
    assert thread["messages"][-1]["sender_role"] == "admin"


@pytest.mark.asyncio
async def test_seller_keeps_a_shop_thread_apart_from_the_buyer_thread(client):
    await register_and_login(client, "desk-two@example.com")
    await make_seller("desk-two@example.com")
    user = await register_and_login(client, "desk-two@example.com")
    await register_and_login(client, "desk-admin3@example.com")
    await make_admin("desk-admin3@example.com")
    admin = await register_and_login(client, "desk-admin3@example.com")

    shop = (await _say(client, user, "Rút tiền shop bị treo", role="seller")).json()
    assert (await client.get("/chat/helpdesk", headers=_auth(user))).json() is None
    purchase = await _say(client, user, "Đơn mình mua chưa giao")
    assert purchase.status_code == 201, purchase.text
    purchase = purchase.json()
    assert purchase["id"] != shop["id"]
    assert (purchase["viewer_role"], shop["viewer_role"]) == ("buyer", "seller")
    again = await _say(client, user, "Thêm ảnh chụp", role="seller")
    assert again.status_code == 200 and again.json()["id"] == shop["id"]

    mine = (await client.get("/chat/conversations?perspective=all", headers=_auth(user))).json()["items"]
    assert {(i["id"], i["viewer_role"]) for i in mine} == {(shop["id"], "seller"), (purchase["id"], "buyer")}

    desk = {i["id"]: i for i in (await client.get("/chat/admin/support", headers=_auth(admin))).json()["items"]}
    assert desk[shop["id"]]["counterpart"]["role"] == "seller"
    assert desk[purchase["id"]]["counterpart"]["role"] == "buyer"
    assert desk[purchase["id"]]["viewer_role"] == "admin"
    waiting = (await client.get("/admin/action-items", headers=_auth(admin))).json()
    assert next(i for i in waiting if i["key"] == "admin_helpdesk_waiting")["count"] == 2


@pytest.mark.asyncio
async def test_only_sellers_have_a_shop_thread(client):
    token = await register_and_login(client, "desk-noshop@example.com")
    refused = await _say(client, token, "Cho mình hỏi về shop", role="seller")
    assert refused.status_code == 403
    assert refused.json()["error_code"] == "CHAT_HELPDESK_SELLER_ONLY"
    read = await client.get("/chat/helpdesk", params={"role": "seller"}, headers=_auth(token))
    assert read.status_code == 403
    assert (await client.get("/chat/helpdesk", params={"role": "admin"}, headers=_auth(token))).status_code == 422
    assert (await _say(client, token, "Hỏi với vai trò khác", role="admin")).status_code == 422


@pytest.mark.asyncio
async def test_helpdesk_threads_stay_private(client):
    owner = await register_and_login(client, "desk-owner@example.com")
    other = await register_and_login(client, "desk-other@example.com")
    room = (await _say(client, owner, "Tài khoản bị khoá")).json()

    peek = await client.get(f"/chat/conversations/{room['id']}", headers=_auth(other))
    assert peek.status_code == 404
    post = await client.post(
        f"/chat/conversations/{room['id']}/messages",
        json={"body": "xin chào", "client_message_id": str(uuid.uuid4())},
        headers=_auth(other),
    )
    assert post.status_code == 404
    assert (await client.get("/chat/admin/support", headers=_auth(other))).status_code == 403
    # Each account gets its own thread.
    theirs = (await _say(client, other, "Mình cần hỗ trợ")).json()
    assert theirs["id"] != room["id"]


@pytest.mark.asyncio
async def test_admins_cannot_open_a_thread_with_themselves(client):
    await register_and_login(client, "desk-admin2@example.com")
    await make_admin("desk-admin2@example.com")
    admin = await register_and_login(client, "desk-admin2@example.com")
    refused = await _say(client, admin, "test")
    assert refused.status_code == 403
    assert refused.json()["error_code"] == "CHAT_HELPDESK_UNAVAILABLE"


@pytest.mark.asyncio
async def test_empty_or_oversized_messages_are_rejected(client):
    token = await register_and_login(client, "desk-empty@example.com")
    assert (await _say(client, token, "   ")).status_code == 422
    assert (await _say(client, token, "x" * 4001)).status_code == 422
    assert (await client.get("/chat/helpdesk", headers=_auth(token))).json() is None
