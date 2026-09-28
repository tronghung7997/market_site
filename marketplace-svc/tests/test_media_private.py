"""Private images: chat attachments, dispute evidence (+ admin case chat),
manual-credit proof and payout receipts — only the parties (and admins) can
fetch them."""

import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image
from sqlalchemy import select, update

from src.chat.retention import purge_expired_messages
from src.database import SessionLocal
from src.models.account import Account
from src.models.chat import ChatConversation, ChatMessage
from src.models.media import MediaObject
from tests.conftest import make_admin, make_seller, register_and_login
from tests.test_disputes import create_delivered_order


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _png(size=(640, 480)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 60, 60)).save(buffer, "PNG")
    return buffer.getvalue()


def _jpeg_taken(when: str) -> bytes:
    image = Image.new("RGB", (800, 600), (30, 30, 200))
    exif = Image.Exif()
    exif.get_ifd(0x8769)[0x9003] = when  # DateTimeOriginal
    exif.get_ifd(0x8825)[1] = "N"  # a GPS tag — must not survive
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", exif=exif.tobytes())
    return buffer.getvalue()


async def _upload(client, headers, purpose, data=None) -> dict:
    response = await client.post(
        f"/media/uploads?purpose={purpose}", content=data or _png(), headers={**headers, "Content-Type": "image/png"},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _headers(client, email, role=None):
    await register_and_login(client, email)
    if role == "seller":
        await make_seller(email)
    elif role == "admin":
        await make_admin(email)
    return _h(await register_and_login(client, email))


# --------------------------------------------------------------------------- chat

@pytest.mark.asyncio
async def test_chat_images_are_sent_listed_and_served_to_participants_only(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client, quantity=1, stock_count=2)
    buyer, admin = _h(buyer_token), _h(admin_token)
    seller = _h(await register_and_login(client, "disp_seller@example.com"))
    conversation = (await client.post(f"/chat/orders/{order_id}", headers=buyer)).json()
    cid = conversation["id"]

    first, second = await _upload(client, buyer, "chat_attachment"), await _upload(client, buyer, "chat_attachment")
    images_only = await client.post(f"/chat/conversations/{cid}/messages", json={
        "body": "", "client_message_id": str(uuid.uuid4()), "attachments": [first["id"], second["id"]],
    }, headers=buyer)
    assert images_only.status_code == 201, images_only.text
    message = images_only.json()
    assert message["body"] == "" and [a["id"] for a in message["attachments"]] == [first["id"], second["id"]]
    assert set(message["attachments"][0]) == {"id", "w", "h", "uploaded_at", "taken_at"}

    empty = await client.post(f"/chat/conversations/{cid}/messages", json={
        "body": "  ", "client_message_id": str(uuid.uuid4()),
    }, headers=buyer)
    assert empty.status_code == 422
    too_many = await client.post(f"/chat/conversations/{cid}/messages", json={
        "body": "x", "client_message_id": str(uuid.uuid4()), "attachments": ["a" * 16] * 5,
    }, headers=buyer)
    assert too_many.status_code == 422
    foreign = await _upload(client, seller, "chat_attachment")
    stolen = await client.post(f"/chat/conversations/{cid}/messages", json={
        "body": "x", "client_message_id": str(uuid.uuid4()), "attachments": [foreign["id"]],
    }, headers=buyer)
    assert stolen.status_code == 422 and stolen.json()["error_code"] == "MEDIA_NOT_ATTACHABLE"

    detail = (await client.get(f"/chat/conversations/{cid}", headers=seller)).json()
    assert [a["id"] for a in detail["messages"][-1]["attachments"]] == [first["id"], second["id"]]

    url = f"/chat/conversations/{cid}/attachments/{first['id']}"
    for headers in (buyer, seller, admin):
        served = await client.get(url, headers=headers)
        assert served.status_code == 200 and served.headers["content-type"] == "image/webp"
        assert served.headers["cache-control"] == "private, no-cache"
    assert (await client.get(url + "?v=thumb", headers=buyer)).status_code == 200
    # Revalidation still checks access: the owner's conditional request is 304, a stranger's 404.
    stranger = await _headers(client, "chat-stranger@example.com")
    etag = (await client.get(url, headers=buyer)).headers["etag"]
    assert (await client.get(url, headers={**buyer, "If-None-Match": etag})).status_code == 304
    assert (await client.get(url, headers={**stranger, "If-None-Match": etag})).status_code == 404
    assert (await client.get(url, headers=stranger)).status_code == 404
    assert (await client.get(f"/chat/conversations/{cid}/attachments/{foreign['id']}", headers=seller)).status_code == 404

    # Retention purges the message → its images are released for garbage collection.
    async with SessionLocal() as db:
        old = datetime.now(timezone.utc) - timedelta(days=45)
        await db.execute(update(ChatMessage).where(ChatMessage.conversation_id == uuid.UUID(cid)).values(created_at=old))
        await db.execute(update(ChatConversation).where(ChatConversation.id == uuid.UUID(cid)).values(last_message_at=old, last_message_id=None))
        from src.models.order import Order, OrderStatus
        await db.execute(update(Order).where(Order.id == order_id).values(status=OrderStatus.completed))
        await db.commit()
    async with SessionLocal() as db:
        assert await purge_expired_messages(db) >= 1
    async with SessionLocal() as db:
        statuses = set(await db.scalars(select(MediaObject.status).where(MediaObject.public_id.in_([first["id"], second["id"]]))))
    assert statuses == {"detached"}


# --------------------------------------------------------------------------- disputes

@pytest.mark.asyncio
async def test_dispute_evidence_images_flow_to_parties_admin_and_case_file(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client, quantity=2, stock_count=3)
    buyer, admin = _h(buyer_token), _h(admin_token)
    seller = _h(await register_and_login(client, "disp_seller@example.com"))

    # Buyer↔seller chat is attached to the admin case.
    cid = (await client.post(f"/chat/orders/{order_id}", headers=buyer)).json()["id"]
    await client.post(f"/chat/conversations/{cid}/messages", json={"body": "Acc lỗi rồi shop", "client_message_id": str(uuid.uuid4())}, headers=buyer)

    shot = await _upload(client, buyer, "dispute_evidence", _jpeg_taken("2026:09:20 08:15:00"))
    assert shot["url"] is None
    opened = await client.post(f"/orders/{order_id}/dispute", json={
        "reason": "Không đăng nhập được", "evidence_images": [shot["id"]], "idempotency_key": "evidence-open-01",
    }, headers=buyer)
    assert opened.status_code == 201, opened.text
    case = opened.json()
    assert [image["id"] for image in case["evidence_images"]] == [shot["id"]]
    assert case["evidence_images"][0]["taken_at"] == "2026-09-20T08:15:00"
    assert case["timeline"][0]["attachments"][0]["id"] == shot["id"]

    url = f"/orders/{order_id}/dispute/evidence/{shot['id']}"
    served = await client.get(url, headers=seller)
    assert served.status_code == 200
    kept = Image.open(io.BytesIO(served.content))
    assert not kept.getexif() and "exif" not in kept.info  # GPS and every other tag are gone
    assert (await client.get(url, headers=buyer)).status_code == 200
    assert (await client.get(url, headers=await _headers(client, "evidence-stranger@example.com"))).status_code == 404
    assert (await client.get(f"/admin/disputes/{case['id']}/evidence/{shot['id']}", headers=admin)).status_code == 200

    # Case messages carry images too, on both sides.
    more = await _upload(client, buyer, "dispute_evidence")
    posted = await client.post(f"/orders/{order_id}/dispute/messages", json={
        "body": "Thêm ảnh lỗi", "idempotency_key": "evidence-msg-0001", "attachments": [more["id"]],
    }, headers=buyer)
    assert posted.status_code == 200, posted.text
    buyer_event = next(e for e in posted.json()["timeline"] if e["event_type"] == "buyer_message")
    assert [a["id"] for a in buyer_event["attachments"]] == [more["id"]]
    proof = await _upload(client, seller, "dispute_evidence")
    responded = await client.post(f"/seller/disputes/{case['id']}/respond", json={
        "seller_note": "Acc vẫn đăng nhập được, xem ảnh", "attachments": [proof["id"]],
    }, headers=seller)
    assert responded.status_code == 200, responded.text
    assert (await client.get(f"/orders/{order_id}/dispute/evidence/{proof['id']}", headers=buyer)).status_code == 200

    admin_case = (await client.get(f"/admin/disputes/{case['id']}/case", headers=admin)).json()
    assert admin_case["order_chat"]["conversation_id"] == cid
    assert [m["body"] for m in admin_case["order_chat"]["messages"]] == ["Acc lỗi rồi shop"]
    assert "evidence_images" in {s["code"] for s in admin_case["signals"]}


@pytest.mark.asyncio
async def test_admin_can_require_an_evidence_image(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client, quantity=1, stock_count=2)
    buyer, admin = _h(buyer_token), _h(admin_token)
    switched = await client.patch("/admin/fee-config", json={"dispute_evidence_image_required": True}, headers=admin)
    assert switched.status_code == 200 and switched.json()["dispute_evidence_image_required"] is True
    assert (await client.get("/public/fee-config")).json()["dispute_evidence_image_required"] is True

    refused = await client.post(f"/orders/{order_id}/dispute", json={"reason": "Lỗi"}, headers=buyer)
    assert refused.status_code == 422 and refused.json()["error_code"] == "DISPUTE_EVIDENCE_REQUIRED"
    shot = await _upload(client, buyer, "dispute_evidence")
    accepted = await client.post(f"/orders/{order_id}/dispute", json={"reason": "Lỗi", "evidence_images": [shot["id"]]}, headers=buyer)
    assert accepted.status_code == 201, accepted.text


# --------------------------------------------------------------------------- wallet

@pytest.mark.asyncio
async def test_manual_credit_proof_and_payout_receipt(client):
    admin = await _headers(client, "proof-admin@example.com", "admin")
    seller = await _headers(client, "proof-seller@example.com", "seller")
    other_seller = await _headers(client, "proof-other@example.com", "seller")
    async with SessionLocal() as db:
        seller_id = await db.scalar(select(Account.id).where(Account.email == "proof-seller@example.com"))

    assert (await client.post("/media/uploads?purpose=adjustment_proof", content=_png(), headers={**seller, "Content-Type": "image/png"})).status_code == 403
    proof = await _upload(client, admin, "adjustment_proof")
    credited = await client.post("/wallet/topup", json={
        "account_id": seller_id, "amount": 500_000, "reason": "Nạp tay theo sao kê", "proof_images": [proof["id"]],
    }, headers=admin)
    assert credited.status_code == 200, credited.text
    rows = (await client.get(f"/admin/accounts/{seller_id}/transactions", headers=admin)).json()
    manual = next(row for row in rows if row["type"] == "topup")
    assert [image["id"] for image in manual["proof_images"]] == [proof["id"]]
    proof_url = f"/admin/wallet/transactions/{manual['id']}/proof/{proof['id']}"
    assert (await client.get(proof_url, headers=admin)).status_code == 200
    assert (await client.get(proof_url, headers=seller)).status_code in (403, 404)
    # The owner sees the credit and its reason, not the admin's evidence.
    own = next(row for row in (await client.get("/wallet/transactions", headers=seller)).json() if row["type"] == "topup")
    assert own["id"] == manual["id"] and own["proof_images"] == []
    assert "Nạp tay theo sao kê" in (own["description"] or "")

    request = await client.post("/wallet/withdraw", json={
        "amount": 200_000, "bank_name": "MB", "bank_account_number": "0123456789", "bank_account_holder": "PROOF SELLER",
    }, headers=seller)
    assert request.status_code == 200, request.text
    req_id = request.json()["id"]
    assert (await client.post(f"/admin/withdrawals/{req_id}/approve", headers=admin)).status_code == 200
    receipt = await _upload(client, admin, "payout_receipt")
    paid = await client.post(f"/admin/withdrawals/{req_id}/paid", json={
        "payout_reference": "FT26269000001", "receipt_images": [receipt["id"]],
    }, headers=admin)
    assert paid.status_code == 200, paid.text
    assert [image["id"] for image in paid.json()["receipt_images"]] == [receipt["id"]]
    mine = (await client.get("/wallet/withdrawals", headers=seller)).json()
    assert mine[0]["receipt_images"][0]["id"] == receipt["id"]

    assert (await client.get(f"/wallet/withdrawals/{req_id}/receipt/{receipt['id']}", headers=seller)).status_code == 200
    assert (await client.get(f"/wallet/withdrawals/{req_id}/receipt/{receipt['id']}", headers=other_seller)).status_code == 404
    assert (await client.get(f"/admin/withdrawals/{req_id}/receipt/{receipt['id']}", headers=admin)).status_code == 200
