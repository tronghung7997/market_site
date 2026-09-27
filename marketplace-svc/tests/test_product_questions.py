"""Buyer-asked product questions: private until answered, public after."""
import pytest

from tests.conftest import make_admin, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _product_id(client, seller):
    return (await client.get("/seller/products", headers=_auth(seller))).json()["items"][-1]["id"]


@pytest.mark.asyncio
async def test_question_goes_public_once_the_seller_answers(client):
    buyer, seller, _, _, _ = await setup_buyable_product(client)
    product_id = await _product_id(client, seller)

    asked = await client.post(
        f"/products/{product_id}/questions", json={"question": "  Tài khoản có đổi được mật khẩu không?  "},
        headers=_auth(buyer),
    )
    assert asked.status_code == 201, asked.text
    question = asked.json()
    assert question["status"] == "pending" and question["question"] == "Tài khoản có đổi được mật khẩu không?"

    # Private until answered.
    assert (await client.get(f"/products/{product_id}/questions")).json()["total"] == 0
    mine = (await client.get(f"/products/{product_id}/questions/mine", headers=_auth(buyer))).json()
    assert [q["id"] for q in mine] == [question["id"]]

    inbox = (await client.get("/seller/questions?status=pending", headers=_auth(seller))).json()
    assert inbox["pending"] == 1 and inbox["items"][0]["asker_label"].endswith("r")
    assert inbox["items"][0]["product_path"].startswith("/products/")
    actions = (await client.get("/seller/action-items", headers=_auth(seller))).json()
    assert next(i for i in actions if i["key"] == "seller_unanswered_questions")["count"] == 1

    answered = await client.put(
        f"/seller/questions/{question['id']}/answer", json={"answer": "Có, đổi ngay sau khi nhận."}, headers=_auth(seller),
    )
    assert answered.status_code == 200, answered.text
    assert answered.json()["status"] == "answered"

    public = (await client.get(f"/products/{product_id}/questions")).json()
    assert public["total"] == 1
    item = public["items"][0]
    assert item["answer"] == "Có, đổi ngay sau khi nhận."
    assert set(item) == {"id", "question", "answer", "asker_label", "created_at", "answered_at"}
    assert "@" not in item["asker_label"]
    buyer_alerts = (await client.get("/me/action-items", headers=_auth(buyer))).json()
    assert any(a.get("href", "").endswith("#qa") for a in buyer_alerts)
    actions = (await client.get("/seller/action-items", headers=_auth(seller))).json()
    assert all(i["key"] != "seller_unanswered_questions" for i in actions)

    # The seller can hide it and bring it back.
    hidden = await client.patch(f"/seller/questions/{question['id']}/visibility", json={"hidden": True}, headers=_auth(seller))
    assert hidden.json()["status"] == "hidden"
    assert (await client.get(f"/products/{product_id}/questions")).json()["total"] == 0
    shown = await client.patch(f"/seller/questions/{question['id']}/visibility", json={"hidden": False}, headers=_auth(seller))
    assert shown.json()["status"] == "answered"


@pytest.mark.asyncio
async def test_admin_hide_wins_over_the_seller(client):
    buyer, seller, admin, _, _ = await setup_buyable_product(client)
    product_id = await _product_id(client, seller)
    qid = (await client.post(f"/products/{product_id}/questions", json={"question": "Bảo hành bao lâu?"}, headers=_auth(buyer))).json()["id"]
    await client.put(f"/seller/questions/{qid}/answer", json={"answer": "7 ngày"}, headers=_auth(seller))

    listing = (await client.get("/admin/questions", headers=_auth(admin))).json()
    assert listing["total"] == 1
    hidden = await client.patch(f"/admin/questions/{qid}/visibility", json={"hidden": True}, headers=_auth(admin))
    assert hidden.status_code == 200 and hidden.json()["hidden_by"] == "admin"
    refused = await client.patch(f"/seller/questions/{qid}/visibility", json={"hidden": False}, headers=_auth(seller))
    assert refused.status_code == 403 and refused.json()["error_code"] == "QUESTION_HIDDEN_BY_ADMIN"
    assert (await client.get(f"/products/{product_id}/questions")).json()["total"] == 0


@pytest.mark.asyncio
async def test_question_rules(client):
    buyer, seller, _, _, _ = await setup_buyable_product(client)
    product_id = await _product_id(client, seller)
    assert (await client.post(f"/products/{product_id}/questions", json={"question": "hi"})).status_code == 401
    own = await client.post(f"/products/{product_id}/questions", json={"question": "Của tôi?"}, headers=_auth(seller))
    assert own.status_code == 400 and own.json()["error_code"] == "QUESTION_SELF"
    assert (await client.post(f"/products/{product_id}/questions", json={"question": "   "}, headers=_auth(buyer))).status_code == 422
    assert (await client.post(f"/products/{product_id}/questions", json={"question": "x" * 501}, headers=_auth(buyer))).status_code == 422
    assert (await client.post("/products/999999/questions", json={"question": "Còn không?"}, headers=_auth(buyer))).status_code == 404

    for n in range(5):
        ok = await client.post(f"/products/{product_id}/questions", json={"question": f"Câu {n}"}, headers=_auth(buyer))
        assert ok.status_code == 201
    limited = await client.post(f"/products/{product_id}/questions", json={"question": "Câu 6"}, headers=_auth(buyer))
    assert limited.status_code == 429 and limited.json()["error_code"] == "QUESTION_LIMIT"


@pytest.mark.asyncio
async def test_other_sellers_and_buyers_cannot_touch_questions(client):
    buyer, seller, _, _, _ = await setup_buyable_product(client)
    product_id = await _product_id(client, seller)
    qid = (await client.post(f"/products/{product_id}/questions", json={"question": "Còn hàng không?"}, headers=_auth(buyer))).json()["id"]

    await register_and_login(client, "qa-other-seller@example.com")
    from tests.conftest import make_seller
    await make_seller("qa-other-seller@example.com")
    other = await register_and_login(client, "qa-other-seller@example.com")
    assert (await client.put(f"/seller/questions/{qid}/answer", json={"answer": "x"}, headers=_auth(other))).status_code == 404
    assert (await client.get("/seller/questions", headers=_auth(other))).json()["total"] == 0
    assert (await client.put(f"/seller/questions/{qid}/answer", json={"answer": "x"}, headers=_auth(buyer))).status_code == 403
    assert (await client.get("/admin/questions", headers=_auth(buyer))).status_code == 403
