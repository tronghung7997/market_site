import uuid

import pytest

from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_order_parties_share_one_scoped_conversation(client):
    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)
    order = await client.post(
        "/orders",
        json={"variant_id": instant_variant_id, "quantity": 1},
        headers=_auth(buyer_token),
    )
    assert order.status_code == 201
    assert order.json()["product_id"] is not None

    buyer_room = await client.post(
        f"/chat/orders/{order.json()['id']}", headers=_auth(buyer_token)
    )
    seller_room = await client.post(
        f"/chat/orders/{order.json()['id']}", headers=_auth(seller_token)
    )

    assert buyer_room.status_code == 201
    assert seller_room.status_code == 200
    assert seller_room.json()["id"] == buyer_room.json()["id"]
    assert buyer_room.json()["kind"] == "order"
    assert buyer_room.json()["order"] == {
        "id": order.json()["id"],
        "status": order.json()["status"],
        "quantity": 1,
        "total_amount": 1000,
        "cancel_reason": None,
    }
    assert buyer_room.json()["read_only_reason"] is None
    assert buyer_room.json()["counterpart"]["label"] == "ord_seller"
    assert seller_room.json()["counterpart"]["label"].startswith("Khách hàng #")

    sent = await client.post(
        f"/chat/conversations/{buyer_room.json()['id']}/messages",
        json={"body": "Mình cần hỗ trợ đơn này.", "client_message_id": str(uuid.uuid4())},
        headers=_auth(buyer_token),
    )
    assert sent.status_code == 201

    outsider = await register_and_login(client, "chat_order_outsider@example.com")
    denied = await client.post(
        f"/chat/orders/{order.json()['id']}", headers=_auth(outsider)
    )
    assert denied.status_code == 404
    assert denied.json()["error_code"] == "ORDER_NOT_FOUND"
