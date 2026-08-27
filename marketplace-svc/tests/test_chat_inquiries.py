import uuid

import pytest

from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_chat_routes_are_registered(client):
    response = await client.get("/chat/inquiries/by-product/1")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_buyer_can_open_product_inquiry_and_seller_can_reply(client):
    buyer_token, seller_token, _, _, _ = await setup_buyable_product(client)
    product = (await client.get("/seller/products", headers=_auth(seller_token))).json()[-1]

    opened = await client.post(
        "/chat/inquiries",
        json={
            "product_id": product["id"],
            "initial_message": "Sản phẩm này còn hỗ trợ bảo hành không?",
            "client_message_id": str(uuid.uuid4()),
        },
        headers=_auth(buyer_token),
    )

    assert opened.status_code == 201
    room = opened.json()
    assert room["kind"] == "product_inquiry"
    assert room["product"]["id"] == product["id"]
    seller_me = await client.get("/me", headers=_auth(seller_token))
    assert room["counterpart"]["label"] == seller_me.json()["email"].split("@", 1)[0]
    assert room["messages"][0]["body"] == "Sản phẩm này còn hỗ trợ bảo hành không?"
    assert "email" not in room["counterpart"]

    seller_rooms = await client.get("/chat/conversations?perspective=seller", headers=_auth(seller_token))
    assert seller_rooms.status_code == 200
    assert seller_rooms.json()["items"][0]["id"] == room["id"]
    assert seller_rooms.json()["items"][0]["counterpart"]["label"].startswith("Khách hàng #")
    assert seller_rooms.json()["items"][0]["unread_count"] == 1

    unified = await client.get("/chat/conversations?perspective=all", headers=_auth(seller_token))
    assert unified.status_code == 200
    assert unified.json()["items"][0]["id"] == room["id"]
    buyer_unified = await client.get("/chat/conversations?perspective=all", headers=_auth(buyer_token))
    assert buyer_unified.json()["items"][0]["id"] == room["id"]
    rejected = await client.get("/chat/conversations?perspective=admin", headers=_auth(seller_token))
    assert rejected.status_code == 422

    seller_actions = await client.get("/me/action-items", headers=_auth(seller_token))
    seller_action_keys = {item["key"]: item for item in seller_actions.json()}
    assert seller_action_keys["unread_messages"]["count"] == 1
    assert seller_action_keys["unread_messages"]["href"] == "/messages"
    buyer_actions = await client.get("/me/action-items", headers=_auth(buyer_token))
    assert not any(item["key"] == "unread_messages" for item in buyer_actions.json())

    opened_by_seller = await client.get(
        f"/chat/conversations/{room['id']}", headers=_auth(seller_token)
    )
    assert opened_by_seller.status_code == 200
    assert opened_by_seller.json()["unread_count"] == 0

    seller_rooms_after_read = await client.get(
        "/chat/conversations?perspective=seller", headers=_auth(seller_token)
    )
    assert seller_rooms_after_read.json()["items"][0]["unread_count"] == 0
    seller_actions_after_read = await client.get("/me/action-items", headers=_auth(seller_token))
    assert not any(item["key"] == "unread_messages" for item in seller_actions_after_read.json())

    replied = await client.post(
        f"/chat/conversations/{room['id']}/messages",
        json={"body": "Có, shop hỗ trợ theo mô tả sản phẩm.", "client_message_id": str(uuid.uuid4())},
        headers=_auth(seller_token),
    )
    assert replied.status_code == 201
    assert replied.json()["sender_role"] == "seller"
    buyer_rooms = await client.get("/chat/conversations?perspective=all", headers=_auth(buyer_token))
    assert buyer_rooms.status_code == 200
    buyer_item = buyer_rooms.json()["items"][0]
    assert buyer_item["id"] == room["id"]
    assert buyer_item["last_message"]["body"] == "Có, shop hỗ trợ theo mô tả sản phẩm."
    assert buyer_item["unread_count"] == 1
    buyer_actions_after_reply = await client.get("/me/action-items", headers=_auth(buyer_token))
    buyer_action_keys = {item["key"]: item for item in buyer_actions_after_reply.json()}
    assert buyer_action_keys["unread_messages"]["count"] == 1
    assert buyer_action_keys["unread_messages"]["href"] == "/messages"


@pytest.mark.asyncio
async def test_inquiry_is_scoped_to_product_and_reuses_existing_room(client):
    buyer_token, seller_token, _, _, _ = await setup_buyable_product(client)
    product = (await client.get("/seller/products", headers=_auth(seller_token))).json()[-1]
    client_message_id = str(uuid.uuid4())
    payload = {
        "product_id": product["id"],
        "initial_message": "Cho mình hỏi trước khi mua.",
        "client_message_id": client_message_id,
    }

    first = await client.post("/chat/inquiries", json=payload, headers=_auth(buyer_token))
    second = await client.post("/chat/inquiries", json=payload, headers=_auth(buyer_token))

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert len(second.json()["messages"]) == 1

    lookup = await client.get(
        f"/chat/inquiries/by-product/{product['id']}", headers=_auth(buyer_token)
    )
    assert lookup.status_code == 200
    assert lookup.json()["id"] == first.json()["id"]

    other_token = await register_and_login(client, "chat_other_buyer@example.com")
    forbidden = await client.get(
        f"/chat/conversations/{first.json()['id']}", headers=_auth(other_token)
    )
    assert forbidden.status_code == 404


@pytest.mark.asyncio
async def test_seller_cannot_start_product_inquiry(client):
    _, seller_token, _, _, _ = await setup_buyable_product(client)
    product = (await client.get("/seller/products", headers=_auth(seller_token))).json()[-1]

    response = await client.post(
        "/chat/inquiries",
        json={
            "product_id": product["id"],
            "initial_message": "Cold message",
            "client_message_id": str(uuid.uuid4()),
        },
        headers=_auth(seller_token),
    )

    assert response.status_code == 400
