import asyncio

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from src.database import SessionLocal
from src.models.order import Order, OrderStatus
from src.models.wallet import Transaction, TransactionType
from tests.conftest import make_admin, make_seller, register_and_login
from tests.test_orders import setup_adapter_product


@pytest.mark.no_db
def test_dispute_resource_contract_accepts_two_thousand_items_but_not_more():
    from src.disputes.schemas import DisputeClaimAppend, SellerResourceAction

    resource_ids = list(range(1, 2001))
    claim = DisputeClaimAppend(
        resource_ids=resource_ids,
        reason="Bulk account failures",
        idempotency_key="bulk-claim-2000",
    )
    remedy = SellerResourceAction(
        resource_ids=resource_ids,
        action="refund",
        idempotency_key="bulk-refund-2000",
    )
    assert len(claim.resource_ids) == 2000
    assert len(remedy.resource_ids) == 2000

    with pytest.raises(ValidationError):
        DisputeClaimAppend(
            resource_ids=list(range(1, 2002)),
            reason="Too many",
            idempotency_key="bulk-claim-2001",
        )


@pytest.mark.no_db
def test_partial_refund_settlement_pays_seller_only_the_remaining_escrow():
    from src.wallet.service import escrow_settlement

    remaining, platform_fee = escrow_settlement(
        total_amount=2_000_000,
        refunded_amount=500_000,
        fee_percent=10,
    )
    assert remaining == 1_500_000
    assert platform_fee == 150_000
    assert remaining - platform_fee == 1_350_000

    with pytest.raises(ValueError):
        escrow_settlement(1_000, 1_001, 10)


async def create_delivered_order(client, *, quantity: int = 1, stock_count: int | None = None):
    admin_token = await register_and_login(client, "disp_admin@example.com")
    await make_admin("disp_admin@example.com")
    admin_token = await register_and_login(client, "disp_admin@example.com")

    await client.post("/admin/categories", json={"name": "DispCat", "slug": "dispcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    seller_token = await register_and_login(client, "disp_seller@example.com")
    await make_seller("disp_seller@example.com")
    seller_token = await register_and_login(client, "disp_seller@example.com")

    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Dispute Test", "status": "active", "escrow_days": 2,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    variant = await client.post(f"/seller/products/{product.json()['id']}/variants", json={
        "name": "DisputeVar", "price": 1000, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    await client.post(f"/seller/variants/{variant.json()['id']}/resources", json={
        "items": [f"uid-{index}|pass-{index}" for index in range(stock_count or quantity)],
    }, headers={"Authorization": f"Bearer {seller_token}"})

    buyer_token = await register_and_login(client, "disp_buyer@example.com")
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    await client.post("/wallet/topup", json={"account_id": buyer_me.json()["id"], "amount": max(50000, quantity * 1000)},
                      headers={"Authorization": f"Bearer {admin_token}"})

    order = await client.post("/orders", json={"variant_id": variant.json()["id"], "quantity": quantity},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    return buyer_token, admin_token, order.json()["id"]


@pytest.mark.asyncio
async def test_missing_buyer_dispute_returns_client_error_code(client):
    buyer_token, _, order_id = await create_delivered_order(client)
    response = await client.get(
        f"/orders/{order_id}/dispute",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert response.status_code == 404
    assert response.json()["error_code"] == "DISPUTE_NOT_FOUND"


@pytest.mark.asyncio
async def test_buyer_can_dispute(client):
    buyer_token, _, order_id = await create_delivered_order(client)
    resp = await client.post(f"/orders/{order_id}/dispute", json={"reason": "Account not working"},
                             headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 201
    assert resp.json()["status"] == "open"


@pytest.mark.asyncio
async def test_concurrent_dispute_refund_and_reject_settle_once(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Broken"},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    disputes = await client.get("/admin/disputes", headers={"Authorization": f"Bearer {admin_token}"})
    dispute_id = disputes.json()[-1]["id"]
    headers = {"Authorization": f"Bearer {admin_token}"}

    first, second = await asyncio.gather(
        client.post(f"/admin/disputes/{dispute_id}/refund", json={"admin_note": "refund"}, headers=headers),
        client.post(f"/admin/disputes/{dispute_id}/reject", json={"admin_note": "reject"}, headers=headers),
    )

    assert sorted((first.status_code, second.status_code)) == [200, 400]
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status in (OrderStatus.refunded, OrderStatus.completed)
        types = set(
            await db.scalars(
                select(Transaction.type).where(Transaction.reference_id == f"order-{order_id}")
            )
        )
        released = bool(types & {TransactionType.purchase_release, TransactionType.platform_fee})
        refunded = TransactionType.refund in types
        assert released != refunded


@pytest.mark.asyncio
async def test_admin_refund_dispute(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    await client.post(f"/orders/{order_id}/dispute", json={"reason": "Broken"},
                      headers={"Authorization": f"Bearer {buyer_token}"})

    disputes = await client.get("/admin/disputes", headers={"Authorization": f"Bearer {admin_token}"})
    dispute_id = disputes.json()[-1]["id"]

    resp = await client.post(f"/admin/disputes/{dispute_id}/refund",
                             json={"admin_note": "Confirmed broken"},
                             headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "resolved_refund"


@pytest.mark.asyncio
async def test_admin_reject_dispute(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    await client.post(f"/orders/{order_id}/dispute", json={"reason": "I changed my mind"},
                      headers={"Authorization": f"Bearer {buyer_token}"})

    disputes = await client.get("/admin/disputes", headers={"Authorization": f"Bearer {admin_token}"})
    dispute_id = disputes.json()[-1]["id"]

    resp = await client.post(f"/admin/disputes/{dispute_id}/reject",
                             json={"admin_note": "Product works fine"},
                             headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "resolved_reject"


@pytest.mark.asyncio
async def test_admin_can_open_dispute_detail_for_adapter_order(client):
    """Regression: đơn tạo qua product_id (adapter flow) có variant_id NULL — trước
    đây DisputeOrderInfo.variant_id khai báo bắt buộc là int nên response_model
    validation crash 500 ngay khi admin mở chi tiết. Cũng xác nhận product_title
    resolve được qua product_id (trước đây luôn None vì chỉ tra theo variant_id),
    và seller_note có mặt trong response (trước đây bị thiếu key, luôn null)."""
    buyer_token, seller_token, admin_token, product_id = await setup_adapter_product(client)

    order = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert order.status_code == 201, order.text
    order_id = order.json()["id"]
    assert order.json()["variant_id"] is None

    dispute = await client.post(f"/orders/{order_id}/dispute", json={"reason": "Không dùng được"},
                                headers={"Authorization": f"Bearer {buyer_token}"})
    assert dispute.status_code == 201, dispute.text
    dispute_id = dispute.json()["id"]

    respond = await client.post(f"/seller/disputes/{dispute_id}/respond", json={"seller_note": "Đã kiểm tra lại"},
                                headers={"Authorization": f"Bearer {seller_token}"})
    assert respond.status_code == 200, respond.text

    detail = await client.get(f"/admin/disputes/{dispute_id}", headers={"Authorization": f"Bearer {admin_token}"})
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["order"]["variant_id"] is None
    assert data["order"]["product_title"] == "Proxy Package"
    assert data["seller_note"] == "Đã kiểm tra lại"


@pytest.mark.asyncio
async def test_resource_claim_batches_partial_refund_replace_timeline_and_final_release(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=4, stock_count=6)
    seller_token = await register_and_login(client, "disp_seller@example.com")
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_headers = {"Authorization": f"Bearer {seller_token}"}

    resources = await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)
    assert resources.status_code == 200, resources.text
    resource_ids = [row["id"] for row in resources.json()]
    assert len(resource_ids) == 4
    assert [row["refund_amount_cap"] for row in resources.json()] == [1000, 1000, 1000, 1000]

    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={
            "reason": "Two scattered accounts failed",
            "resource_ids": [resource_ids[0], resource_ids[2]],
            "idempotency_key": "open-batch-0001",
        },
        headers=buyer_headers,
    )
    assert opened.status_code == 201, opened.text
    dispute_id = opened.json()["id"]

    selected = await client.get(f"/seller/disputes/{dispute_id}/resources", headers=seller_headers)
    assert selected.status_code == 200, selected.text
    assert [row["id"] for row in selected.json()["items"]] == [resource_ids[0], resource_ids[2]]

    refund_body = {
        "resource_ids": [resource_ids[0]],
        "action": "refund",
        "idempotency_key": "refund-batch-001",
        "seller_note": "Refunded the first failed account",
    }
    refunded = await client.post(
        f"/seller/disputes/{dispute_id}/resources/action",
        json=refund_body,
        headers=seller_headers,
    )
    assert refunded.status_code == 200, refunded.text
    assert refunded.json()["actions"][0]["refund_amount"] == 1000
    retried = await client.post(
        f"/seller/disputes/{dispute_id}/resources/action",
        json=refund_body,
        headers=seller_headers,
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["retried"] is True
    premature_accept = await client.post(f"/orders/{order_id}/dispute/accept", headers=buyer_headers)
    assert premature_accept.status_code == 409

    appended = await client.post(
        f"/orders/{order_id}/dispute/claims",
        json={
            "reason": "Another account stopped working",
            "resource_ids": [resource_ids[1]],
            "idempotency_key": "claim-batch-0002",
        },
        headers=buyer_headers,
    )
    assert appended.status_code == 200, appended.text
    message = await client.post(
        f"/orders/{order_id}/dispute/messages",
        json={"body": "Please replace the remaining accounts", "idempotency_key": "buyer-message-001"},
        headers=buyer_headers,
    )
    assert message.status_code == 200, message.text

    replaced = await client.post(
        f"/seller/disputes/{dispute_id}/resources/action",
        json={
            "resource_ids": [resource_ids[2], resource_ids[1]],
            "action": "replace",
            "idempotency_key": "replace-batch-01",
            "seller_note": "Replacements issued",
        },
        headers=seller_headers,
    )
    assert replaced.status_code == 200, replaced.text
    assert all(row["replacement_resource_id"] for row in replaced.json()["actions"])

    detail = await client.get(f"/orders/{order_id}/dispute", headers=buyer_headers)
    assert detail.status_code == 200, detail.text
    event_types = [event["event_type"] for event in detail.json()["timeline"]]
    assert event_types.count("claim_batch") == 2
    assert "resource_refund" in event_types
    assert "resource_replace" in event_types
    assert "buyer_message" in event_types
    assert "seller_message" in event_types

    accepted = await client.post(f"/orders/{order_id}/dispute/accept", headers=buyer_headers)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "resolved_partial_refund"

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.completed
        assert order.total_amount == 4000
        assert order.refunded_amount == 1000
        refund_transactions = list(
            await db.scalars(
                select(Transaction).where(
                    Transaction.type == TransactionType.refund,
                    Transaction.reference_id == f"order-{order_id}:dispute:{dispute_id}:refund-batch-001",
                )
            )
        )
        assert len(refund_transactions) == 1
        assert refund_transactions[0].amount == 1000


@pytest.mark.asyncio
async def test_seller_cannot_remedy_unclaimed_account(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=2, stock_count=3)
    seller_token = await register_and_login(client, "disp_seller@example.com")
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    resources = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "One failed", "resource_ids": [resources[0]["id"]], "idempotency_key": "open-batch-0001"},
        headers=buyer_headers,
    )
    await register_and_login(client, "other-disp-seller@example.com")
    await make_seller("other-disp-seller@example.com")
    other_seller_token = await register_and_login(client, "other-disp-seller@example.com")
    unauthorized = await client.get(
        f"/seller/disputes/{opened.json()['id']}/resources",
        headers={"Authorization": f"Bearer {other_seller_token}"},
    )
    assert unauthorized.status_code == 404
    response = await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={"resource_ids": [resources[1]["id"]], "action": "refund", "idempotency_key": "refund-wrong-001"},
        headers=seller_headers,
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_refunding_every_claimed_resource_marks_order_fully_refunded(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=3)
    seller_token = await register_and_login(client, "disp_seller@example.com")
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    resources = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    resource_ids = [resource["id"] for resource in resources]

    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "All failed", "resource_ids": resource_ids, "idempotency_key": "all-failed-open"},
        headers=buyer_headers,
    )
    await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={"resource_ids": resource_ids, "action": "refund", "idempotency_key": "all-failed-refund"},
        headers=seller_headers,
    )
    accepted = await client.post(f"/orders/{order_id}/dispute/accept", headers=buyer_headers)

    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "resolved_refund"
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.refunded
        assert order.refunded_amount == order.total_amount
        release = await db.scalar(
            select(Transaction.id).where(
                Transaction.type == TransactionType.purchase_release,
                Transaction.reference_id == f"order-{order_id}",
            )
        )
        assert release is None
