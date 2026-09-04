import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.order import (
    Dispute,
    DisputeClaimResource,
    DisputeMessage,
    DisputeStatus,
    Order,
    OrderStatus,
)
from src.scheduler import dispute_abandonment_job, dispute_resolution_timeout_job
from src.models.account import Account
from src.models.resource import Resource, ResourceStatus
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
    order = await client.get(f"/orders/{order_id}", headers={"Authorization": f"Bearer {buyer_token}"})
    assert order.json()["status"] == "delivered"
    assert order.json()["protection"] == {"status": "dispute_open"}
    assert order.json()["capabilities"]["can_confirm"] is False


@pytest.mark.asyncio
async def test_buyer_can_withdraw_unremedied_dispute_without_changing_escrow_deadline(client):
    buyer_token, _, order_id = await create_delivered_order(client)
    headers = {"Authorization": f"Bearer {buyer_token}"}
    opened = await client.post(
        f"/orders/{order_id}/dispute", json={"reason": "Opened in error"}, headers=headers,
    )
    assert opened.status_code == 201, opened.text

    before = await client.get(f"/orders/{order_id}", headers=headers)
    buyer_token = await register_and_login(client, "disp_buyer@example.com")
    headers = {"Authorization": f"Bearer {buyer_token}"}
    withdrawn = await client.post(f"/orders/{order_id}/dispute/withdraw", headers=headers)
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["status"] == "withdrawn_by_buyer"
    assert withdrawn.json()["resolution_deadline_at"] is None

    after = await client.get(f"/orders/{order_id}", headers=headers)
    assert after.json()["status"] == "delivered"
    assert after.json()["has_dispute"] is False
    assert after.json()["escrow_expires_at"] == before.json()["escrow_expires_at"]


@pytest.mark.asyncio
async def test_withdrawing_after_escrow_expiry_completes_order_immediately(client):
    buyer_token, _, order_id = await create_delivered_order(client)
    headers = {"Authorization": f"Bearer {buyer_token}"}
    opened = await client.post(
        f"/orders/{order_id}/dispute", json={"reason": "Opened in error"}, headers=headers,
    )
    assert opened.status_code == 201, opened.text
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        order.escrow_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()

    buyer_token = await register_and_login(client, "disp_buyer@example.com")
    headers = {"Authorization": f"Bearer {buyer_token}"}
    withdrawn = await client.post(f"/orders/{order_id}/dispute/withdraw", headers=headers)
    assert withdrawn.status_code == 200, withdrawn.text
    order = await client.get(f"/orders/{order_id}", headers=headers)
    assert order.json()["status"] == "completed"
    assert order.json()["has_dispute"] is False

    async with SessionLocal() as db:
        release = await db.scalar(
            select(Transaction.id).where(
                Transaction.type == TransactionType.purchase_release,
                Transaction.reference_id == f"order-{order_id}",
            )
        )
        assert release is not None


@pytest.mark.asyncio
async def test_withdrawing_legacy_order_without_escrow_deadline_completes_order(client):
    buyer_token, _, order_id = await create_delivered_order(client)
    headers = {"Authorization": f"Bearer {buyer_token}"}
    opened = await client.post(
        f"/orders/{order_id}/dispute", json={"reason": "Opened in error"}, headers=headers,
    )
    assert opened.status_code == 201, opened.text
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        order.escrow_expires_at = None
        await db.commit()

    buyer_token = await register_and_login(client, "disp_buyer@example.com")
    withdrawn = await client.post(
        f"/orders/{order_id}/dispute/withdraw", headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    order = await client.get(f"/orders/{order_id}", headers={"Authorization": f"Bearer {buyer_token}"})
    assert order.json()["status"] == "completed"
    assert order.json()["has_dispute"] is False


@pytest.mark.asyncio
async def test_buyer_cannot_withdraw_after_seller_has_issued_resource_remedy(client):
    buyer_token, _, order_id = await create_delivered_order(client, stock_count=2)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    resources = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Account failed", "resource_ids": [resources[0]["id"]]},
        headers=buyer_headers,
    )
    resolved = await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={"resource_ids": [resources[0]["id"]], "action": "replace", "idempotency_key": "withdraw-block-001"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert resolved.status_code == 200, resolved.text

    buyer_token = await register_and_login(client, "disp_buyer@example.com")
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    withdrawn = await client.post(f"/orders/{order_id}/dispute/withdraw", headers=buyer_headers)
    assert withdrawn.status_code == 409
    assert withdrawn.json()["error_code"] == "DISPUTE_WITHDRAWAL_NOT_ALLOWED"


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
async def test_refunding_every_claimed_resource_auto_closes_case_and_order(client):
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
    refunded = await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={"resource_ids": resource_ids, "action": "refund", "idempotency_key": "all-failed-refund"},
        headers=seller_headers,
    )
    assert refunded.status_code == 200, refunded.text
    assert refunded.json()["status"] == "resolved_refund"
    listed = await client.get("/seller/orders", headers=seller_headers)
    listed_order = next(row for row in listed.json() if row["id"] == order_id)
    assert listed_order["status"] == "refunded"
    assert listed_order["has_dispute"] is False
    assert listed_order["dispute_status"] == "resolved_refund"
    remaining = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    assert {row["id"] for row in remaining} == set(resource_ids)
    assert {row["status"] for row in remaining} == {"error"}
    buyer_inbox = await client.get("/orders/action-items", headers=buyer_headers)
    buyer_alerts = [item for item in buyer_inbox.json() if item.get("href", "").startswith(f"/orders?order_id={order_id}")]
    assert buyer_alerts, buyer_inbox.json()
    assert all(str(resource_id) in buyer_alerts[0]["href"] for resource_id in resource_ids)
    assert f"#{resource_ids[0]}" in buyer_alerts[0]["label"]
    seller_inbox = await client.get("/seller/action-items", headers=seller_headers)
    seller_alerts = [item for item in seller_inbox.json() if item.get("href", "").startswith(f"/seller/orders?order_id={order_id}")]
    assert seller_alerts, seller_inbox.json()
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.refunded
        assert order.refunded_amount == order.total_amount
        assert not order.delivered_data
        release = await db.scalar(
            select(Transaction.id).where(
                Transaction.type == TransactionType.purchase_release,
                Transaction.reference_id == f"order-{order_id}",
            )
        )
        assert release is None


@pytest.mark.asyncio
async def test_unanswered_seller_response_auto_settles_after_resolution_deadline(client):
    buyer_token, seller_token, _, product_id = await setup_adapter_product(client)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    created = await client.post(
        "/orders",
        json={
            "product_id": product_id,
            "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
            "quantity": 1,
        },
        headers=buyer_headers,
    )
    assert created.status_code == 201, created.text
    order_id = created.json()["id"]
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Proxy is unavailable"},
        headers=buyer_headers,
    )
    assert opened.status_code == 201, opened.text
    dispute_id = opened.json()["id"]
    responded = await client.post(
        f"/seller/disputes/{dispute_id}/respond",
        json={"seller_note": "Replacement access has been issued."},
        headers=seller_headers,
    )
    assert responded.status_code == 200, responded.text
    assert responded.json()["resolution_deadline_at"] is not None

    async with SessionLocal() as db:
        dispute = await db.get(Dispute, dispute_id)
        dispute.resolution_deadline_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()

    await dispute_resolution_timeout_job()

    async with SessionLocal() as db:
        dispute = await db.get(Dispute, dispute_id)
        order = await db.get(Order, order_id)
        assert dispute.status == DisputeStatus.resolved_timeout
        assert dispute.resolution_deadline_at is None
        assert order.status == OrderStatus.completed
        release = await db.scalar(
            select(Transaction.id).where(
                Transaction.type == TransactionType.purchase_release,
                Transaction.reference_id == f"order-{order_id}",
            )
        )
        assert release is not None


@pytest.mark.asyncio
async def test_buyer_message_keeps_pending_resolution_deadline(client):
    buyer_token, seller_token, _, product_id = await setup_adapter_product(client)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    created = await client.post(
        "/orders",
        json={
            "product_id": product_id,
            "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
            "quantity": 1,
        },
        headers=buyer_headers,
    )
    order_id = created.json()["id"]
    opened = await client.post(
        f"/orders/{order_id}/dispute", json={"reason": "Proxy is unavailable"}, headers=buyer_headers,
    )
    dispute_id = opened.json()["id"]
    await client.post(
        f"/seller/disputes/{dispute_id}/respond",
        json={"seller_note": "Replacement access has been issued."},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    message = await client.post(
        f"/orders/{order_id}/dispute/messages",
        json={"body": "The replacement still does not work.", "idempotency_key": "buyer-counter-001"},
        headers=buyer_headers,
    )
    assert message.status_code == 200, message.text
    assert message.json()["resolution_deadline_at"] is not None


@pytest.mark.asyncio
async def test_instant_claims_require_remedies_before_seller_note_starts_deadline(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=1)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    resources = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Account is unavailable", "resource_ids": [resources[0]["id"]]},
        headers=buyer_headers,
    )
    responded = await client.post(
        f"/seller/disputes/{opened.json()['id']}/respond",
        json={"seller_note": "I will investigate."},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert responded.status_code == 200, responded.text
    assert responded.json()["resolution_deadline_at"] is None
    assert responded.json()["abandon_after_at"] is not None


@pytest.mark.no_db
def test_abandon_clock_starts_after_escrow_or_later_buyer_claim():
    from src.disputes.service import compute_abandon_after_at

    escrow = datetime(2026, 9, 1, 12, tzinfo=timezone.utc)
    earlier = escrow - timedelta(hours=3)
    later = escrow + timedelta(hours=2)
    assert compute_abandon_after_at(
        escrow_expires_at=escrow,
        last_buyer_claim_activity=earlier,
        resolution_deadline_at=None,
        has_resource_remedy=False,
        grace_hours=24,
    ) == escrow + timedelta(hours=24)
    assert compute_abandon_after_at(
        escrow_expires_at=escrow,
        last_buyer_claim_activity=later,
        resolution_deadline_at=None,
        has_resource_remedy=False,
        grace_hours=24,
    ) == later + timedelta(hours=24)
    assert compute_abandon_after_at(
        escrow_expires_at=escrow,
        last_buyer_claim_activity=later,
        resolution_deadline_at=later,
        has_resource_remedy=False,
        grace_hours=24,
    ) is None
    assert compute_abandon_after_at(
        escrow_expires_at=escrow,
        last_buyer_claim_activity=later,
        resolution_deadline_at=None,
        has_resource_remedy=True,
        grace_hours=24,
    ) is None
    assert compute_abandon_after_at(
        escrow_expires_at=None,
        last_buyer_claim_activity=later,
        resolution_deadline_at=None,
        has_resource_remedy=False,
        grace_hours=24,
    ) is None
    assert compute_abandon_after_at(
        escrow_expires_at=escrow,
        last_buyer_claim_activity=later,
        resolution_deadline_at=None,
        has_resource_remedy=False,
        review_requested=True,
        grace_hours=24,
    ) is None


@pytest.mark.no_db
def test_replacement_generation_counts_warranty_hops():
    from src.disputes.service import replacement_generation

    actions = [(1, 11), (11, 21)]
    assert replacement_generation(1, actions) == 0
    assert replacement_generation(11, actions) == 1
    assert replacement_generation(21, actions) == 2


async def _backdate_open_dispute_past_abandon_grace(order_id: int, *, extra_hours: int = 1) -> int:
    past = datetime.now(timezone.utc) - timedelta(hours=24 + extra_hours)
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        order.escrow_expires_at = past
        dispute = await db.scalar(
            select(Dispute).where(Dispute.order_id == order_id, Dispute.status == DisputeStatus.open)
        )
        dispute.created_at = past
        claims = list(
            (await db.execute(select(DisputeClaimResource).where(DisputeClaimResource.dispute_id == dispute.id))).scalars()
        )
        for claim in claims:
            claim.created_at = past
        messages = list(
            (await db.execute(select(DisputeMessage).where(DisputeMessage.dispute_id == dispute.id))).scalars()
        )
        for message in messages:
            message.created_at = past
        await db.commit()
        return dispute.id


@pytest.mark.asyncio
async def test_abandoned_partial_claim_releases_full_remaining_escrow_to_seller(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=3)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    resources = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    claimed = [row["id"] for row in resources[:2]]
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Two accounts failed", "resource_ids": claimed},
        headers=buyer_headers,
    )
    assert opened.status_code == 201, opened.text
    await _backdate_open_dispute_past_abandon_grace(order_id)
    await dispute_abandonment_job()

    order = await client.get(f"/orders/{order_id}", headers=buyer_headers)
    assert order.json()["status"] == "completed"
    assert order.json()["has_dispute"] is False
    dispute = await client.get(f"/orders/{order_id}/dispute", headers=buyer_headers)
    assert dispute.json()["status"] == "resolved_abandoned"
    async with SessionLocal() as db:
        release = await db.scalar(
            select(Transaction.id).where(
                Transaction.type == TransactionType.purchase_release,
                Transaction.reference_id == f"order-{order_id}",
            )
        )
        assert release is not None
        persisted = await db.get(Order, order_id)
        assert persisted.refunded_amount == 0


@pytest.mark.asyncio
async def test_seller_note_without_remedy_does_not_block_abandonment(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=2)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    resources = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "One account failed", "resource_ids": [resources[0]["id"]]},
        headers=buyer_headers,
    )
    await client.post(
        f"/seller/disputes/{opened.json()['id']}/respond",
        json={"seller_note": "Looking into it."},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    await _backdate_open_dispute_past_abandon_grace(order_id)
    await dispute_abandonment_job()
    dispute = await client.get(f"/orders/{order_id}/dispute", headers=buyer_headers)
    assert dispute.json()["status"] == "resolved_abandoned"


@pytest.mark.asyncio
async def test_buyer_message_does_not_extend_abandonment_grace(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=1)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    resources = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Account failed", "resource_ids": [resources[0]["id"]]},
        headers=buyer_headers,
    )
    await _backdate_open_dispute_past_abandon_grace(order_id)
    message = await client.post(
        f"/orders/{order_id}/dispute/messages",
        json={"body": "Still waiting on a replacement.", "idempotency_key": "abandon-keep-open-001"},
        headers=buyer_headers,
    )
    assert message.status_code == 200, message.text
    await dispute_abandonment_job()
    dispute = await client.get(f"/orders/{order_id}/dispute", headers=buyer_headers)
    assert dispute.json()["status"] == "resolved_abandoned"


@pytest.mark.asyncio
async def test_seller_can_reoffer_after_buyer_counters_completed_instant_remedy(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=1, stock_count=2)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    resources = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Account failed", "resource_ids": [resources[0]["id"]]},
        headers=buyer_headers,
    )
    dispute_id = opened.json()["id"]
    remedied = await client.post(
        f"/seller/disputes/{dispute_id}/resources/action",
        json={"resource_ids": [resources[0]["id"]], "action": "replace", "idempotency_key": "reoffer-remedy-001"},
        headers=seller_headers,
    )
    assert remedied.status_code == 200, remedied.text
    before_counter = await client.get(f"/orders/{order_id}/dispute", headers=buyer_headers)
    assert before_counter.json()["resolution_deadline_at"] is not None

    counter = await client.post(
        f"/orders/{order_id}/dispute/messages",
        json={"body": "The replacement also fails.", "idempotency_key": "reoffer-counter-001"},
        headers=buyer_headers,
    )
    assert counter.status_code == 200, counter.text
    assert counter.json()["resolution_deadline_at"] is not None

    resources_after = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    original_id = resources[0]["id"]
    replacement_id = next(
        row["id"] for row in resources_after if row["id"] != original_id and row["status"] == "assigned"
    )
    claimed = await client.post(
        f"/orders/{order_id}/dispute/claims",
        json={
            "reason": "Replacement also fails",
            "resource_ids": [replacement_id],
            "idempotency_key": "reoffer-claim-001",
        },
        headers=buyer_headers,
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["resolution_deadline_at"] is None

    noted = await client.post(
        f"/seller/disputes/{dispute_id}/respond",
        json={"seller_note": "Please verify the replacement credentials again."},
        headers=seller_headers,
    )
    assert noted.status_code == 200, noted.text
    assert noted.json()["resolution_deadline_at"] is None

    refunded = await client.post(
        f"/seller/disputes/{dispute_id}/resources/action",
        json={
            "resource_ids": [replacement_id],
            "action": "refund",
            "idempotency_key": "reoffer-refund-001",
        },
        headers=seller_headers,
    )
    assert refunded.status_code == 200, refunded.text
    after_refund = await client.get(f"/orders/{order_id}/dispute", headers=buyer_headers)
    assert after_refund.json()["status"] == "resolved_refund"


@pytest.mark.asyncio
async def test_resource_remedy_blocks_abandonment(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=2, stock_count=3)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    resources = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Account failed", "resource_ids": [resources[0]["id"]]},
        headers=buyer_headers,
    )
    remedied = await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={"resource_ids": [resources[0]["id"]], "action": "replace", "idempotency_key": "abandon-block-001"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert remedied.status_code == 200, remedied.text
    await _backdate_open_dispute_past_abandon_grace(order_id)
    await dispute_abandonment_job()
    dispute = await client.get(f"/orders/{order_id}/dispute", headers=buyer_headers)
    assert dispute.json()["status"] == "open"


@pytest.mark.asyncio
async def test_seller_can_search_pending_claimed_accounts_and_list_ids(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=3, stock_count=4)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    resources = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Scattered failures", "resource_ids": [resources[0]["id"], resources[1]["id"]]},
        headers=buyer_headers,
    )
    dispute_id = opened.json()["id"]
    await client.post(
        f"/seller/disputes/{dispute_id}/resources/action",
        json={"resource_ids": [resources[0]["id"]], "action": "refund", "idempotency_key": "search-refund-001"},
        headers=seller_headers,
    )
    username = resources[1]["data"].split("|")[0]
    found = await client.get(
        f"/seller/disputes/{dispute_id}/resources?search={username}&pending_only=true",
        headers=seller_headers,
    )
    assert found.status_code == 200, found.text
    assert [row["id"] for row in found.json()["items"]] == [resources[1]["id"]]
    ids = await client.get(
        f"/seller/disputes/{dispute_id}/resources?pending_only=true&ids_only=true",
        headers=seller_headers,
    )
    assert ids.json()["ids"] == [resources[1]["id"]]
    assert ids.json()["total"] == 1


@pytest.mark.asyncio
async def test_seller_can_pick_specific_replacement_accounts(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=1, stock_count=3)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    claimed = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Account failed", "resource_ids": [claimed[0]["id"]]},
        headers=buyer_headers,
    )
    stock = await client.get(
        f"/seller/disputes/{opened.json()['id']}/replacement-resources",
        headers=seller_headers,
    )
    assert stock.status_code == 200, stock.text
    assert stock.json()["total"] == 2
    chosen = stock.json()["items"][1]["id"]
    replaced = await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={
            "resource_ids": [claimed[0]["id"]],
            "action": "replace",
            "replacement_resource_ids": [chosen],
            "idempotency_key": "pick-replace-001",
        },
        headers=seller_headers,
    )
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["actions"][0]["replacement_resource_id"] == chosen
    after = (await client.get(f"/orders/{order_id}", headers=buyer_headers)).json()
    assigned = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    live = [row for row in assigned if row["status"] == "assigned"]
    assert [row["id"] for row in live] == [chosen]
    assert after["delivered_data"] == live[0]["data"]
    inbox = await client.get("/orders/action-items", headers=buyer_headers)
    hrefs = [item["href"] for item in inbox.json() if "resources=" in item.get("href", "")]
    assert any(str(claimed[0]["id"]) in href and str(chosen) in href for href in hrefs), inbox.json()


@pytest.mark.asyncio
async def test_archived_resource_cannot_be_used_as_dispute_replacement(client):
    from sqlalchemy import update as sa_update

    from src.database import SessionLocal
    from src.models.resource import Resource

    buyer_token, _, order_id = await create_delivered_order(client, quantity=1, stock_count=3)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    claimed = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Account failed", "resource_ids": [claimed[0]["id"]]},
        headers=buyer_headers,
    )
    stock = (await client.get(
        f"/seller/disputes/{opened.json()['id']}/replacement-resources",
        headers=seller_headers,
    )).json()
    archived_id = stock["items"][0]["id"]
    async with SessionLocal() as db:
        await db.execute(sa_update(Resource).where(Resource.id == archived_id).values(is_archived=True))
        await db.commit()

    after = await client.get(
        f"/seller/disputes/{opened.json()['id']}/replacement-resources",
        headers=seller_headers,
    )
    assert archived_id not in [item["id"] for item in after.json()["items"]]
    rejected = await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={
            "resource_ids": [claimed[0]["id"]],
            "action": "replace",
            "replacement_resource_ids": [archived_id],
            "idempotency_key": "archived-replacement",
        },
        headers=seller_headers,
    )
    assert rejected.status_code == 409


@pytest.mark.asyncio
async def test_seller_replace_requires_one_replacement_per_claimed_account(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=2, stock_count=4)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    claimed = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Both failed", "resource_ids": [claimed[0]["id"], claimed[1]["id"]]},
        headers=buyer_headers,
    )
    stock = await client.get(
        f"/seller/disputes/{opened.json()['id']}/replacement-resources",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    mismatched = await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={
            "resource_ids": [claimed[0]["id"], claimed[1]["id"]],
            "action": "replace",
            "replacement_resource_ids": [stock.json()["items"][0]["id"]],
            "idempotency_key": "pick-replace-mismatch",
        },
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert mismatched.status_code == 400


@pytest.mark.asyncio
async def test_buyer_can_claim_warranty_replacement_once(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client, quantity=1, stock_count=3)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    original = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()[0]["id"]
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Dead account", "resource_ids": [original], "idempotency_key": "warranty-open"},
        headers=buyer_headers,
    )
    assert opened.status_code == 201, opened.text
    first = await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={"resource_ids": [original], "action": "replace", "idempotency_key": "warranty-replace-1"},
        headers=seller_headers,
    )
    assert first.status_code == 200, first.text
    live = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    gen1 = next(row["id"] for row in live if row["id"] != original and row["status"] == "assigned")
    claimed = await client.post(
        f"/orders/{order_id}/dispute/claims",
        json={"reason": "Replacement dead", "resource_ids": [gen1], "idempotency_key": "warranty-claim-1"},
        headers=buyer_headers,
    )
    assert claimed.status_code == 200, claimed.text
    assert gen1 in claimed.json()["claimed_resource_ids"]
    second = await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={"resource_ids": [gen1], "action": "replace", "idempotency_key": "warranty-replace-2"},
        headers=seller_headers,
    )
    assert second.status_code == 200, second.text
    live = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    gen2 = next(row["id"] for row in live if row["id"] not in {original, gen1} and row["status"] == "assigned")
    blocked = await client.post(
        f"/orders/{order_id}/dispute/claims",
        json={"reason": "Second replacement dead", "resource_ids": [gen2], "idempotency_key": "warranty-claim-2"},
        headers=buyer_headers,
    )
    assert blocked.status_code == 409
    assert blocked.json()["error_code"] == "DISPUTE_WARRANTY_LIMIT"

    preview = await client.post(
        f"/chat/orders/{order_id}/support",
        headers=buyer_headers,
    )
    assert preview.status_code == 400
    assert preview.json()["error_code"] == "CHAT_SUPPORT_REQUIRES_REVIEW"

    support = await client.post(
        f"/orders/{order_id}/dispute/escalate",
        json={
            "note": "Seller replaced twice and it still fails.",
            "idempotency_key": "warranty-escalate-1",
        },
        headers=buyer_headers,
    )
    assert support.status_code == 200, support.text
    conversation_id = support.json()["marketplace_conversation_id"]
    assert conversation_id
    case = await client.get(f"/orders/{order_id}/dispute", headers=buyer_headers)
    assert case.json()["review_requested_at"] is not None
    assert case.json()["resolution_deadline_at"] is None
    timeline_bodies = [event["body"] for event in case.json()["timeline"] if event.get("event_type") == "case_escalated"]
    assert "Seller replaced twice and it still fails." in timeline_bodies

    room = await client.post(f"/chat/orders/{order_id}/support", headers=buyer_headers)
    assert room.status_code == 200, room.text
    assert room.json()["id"] == conversation_id
    assert room.json()["kind"] == "support"
    assert room.json()["counterpart"]["label"] == "Marketplace"

    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    inbox = await client.get("/chat/admin/support", headers=admin_headers)
    assert inbox.status_code == 200, inbox.text
    assert any(item["id"] == conversation_id for item in inbox.json()["items"])
    outsider = await register_and_login(client, "warranty_outsider@example.com")
    denied = await client.post(
        f"/chat/orders/{order_id}/support",
        headers={"Authorization": f"Bearer {outsider}"},
    )
    assert denied.status_code == 404


@pytest.mark.asyncio
async def test_claim_rejects_unassigned_order_resource(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=2)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    rows = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()
    first, second = rows[0]["id"], rows[1]["id"]
    async with SessionLocal() as db:
        await db.execute(update(Resource).where(Resource.id == second).values(status=ResourceStatus.error))
        await db.commit()
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "One account failed", "resource_ids": [first], "idempotency_key": "claim-assigned-open"},
        headers=buyer_headers,
    )
    assert opened.status_code == 201, opened.text
    blocked = await client.post(
        f"/orders/{order_id}/dispute/claims",
        json={"reason": "Also this one", "resource_ids": [second], "idempotency_key": "claim-error-account"},
        headers=buyer_headers,
    )
    assert blocked.status_code == 400
    assert blocked.json()["error_code"] == "DISPUTE_RESOURCE_NOT_CLAIMABLE"


@pytest.mark.asyncio
async def test_can_append_claims_tracks_assigned_unclaimed_generation(client):
    buyer_token, _, order_id = await create_delivered_order(client, quantity=1, stock_count=3)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    original = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()[0]["id"]
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Dead", "resource_ids": [original], "idempotency_key": "cap-open"},
        headers=buyer_headers,
    )
    assert opened.status_code == 201, opened.text
    before = await client.get(f"/orders/{order_id}", headers=buyer_headers)
    assert before.json()["capabilities"]["can_append_claims"] is False
    replaced = await client.post(
        f"/seller/disputes/{opened.json()['id']}/resources/action",
        json={"resource_ids": [original], "action": "replace", "idempotency_key": "cap-replace"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert replaced.status_code == 200, replaced.text
    after_replace = await client.get(f"/orders/{order_id}", headers=buyer_headers)
    assert after_replace.json()["capabilities"]["can_append_claims"] is True


@pytest.mark.asyncio
async def test_seller_escalate_appends_note_to_existing_support_thread(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client, quantity=1)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_token = await register_and_login(client, "disp_seller@example.com")
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    original = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()[0]["id"]
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Dead account", "resource_ids": [original], "idempotency_key": "esc-open"},
        headers=buyer_headers,
    )
    dispute_id = opened.json()["id"]
    first = await client.post(
        f"/seller/disputes/{dispute_id}/escalate",
        json={"seller_note": "Buyer looks fraudulent.", "idempotency_key": "seller-esc-1"},
        headers=seller_headers,
    )
    assert first.status_code == 200, first.text
    assert first.json()["review_requested_at"] is not None
    conversation_id = first.json()["marketplace_conversation_id"]
    assert conversation_id
    first_room = await client.get(f"/chat/conversations/{conversation_id}", headers=seller_headers)
    assert first_room.status_code == 200, first_room.text
    assert any(message["body"] == "Buyer looks fraudulent." for message in first_room.json()["messages"])

    second = await client.post(
        f"/seller/disputes/{dispute_id}/escalate",
        json={"seller_note": "Here is extra evidence.", "idempotency_key": "seller-esc-2"},
        headers=seller_headers,
    )
    assert second.status_code == 200, second.text
    retry = await client.post(
        f"/seller/disputes/{dispute_id}/escalate",
        json={"seller_note": "Here is extra evidence.", "idempotency_key": "seller-esc-2"},
        headers=seller_headers,
    )
    assert retry.status_code == 200, retry.text
    room = await client.get(f"/chat/conversations/{conversation_id}", headers=seller_headers)
    bodies = [message["body"] for message in room.json()["messages"]]
    assert bodies.count("Buyer looks fraudulent.") == 1
    assert bodies.count("Here is extra evidence.") == 1

    blank = await client.post(
        f"/seller/disputes/{dispute_id}/escalate",
        json={"seller_note": "   ", "idempotency_key": "seller-esc-blank"},
        headers=seller_headers,
    )
    assert blank.status_code == 422

    missing = await client.post(
        f"/chat/orders/{order_id}/support",
        headers=buyer_headers,
    )
    assert missing.status_code == 400
    assert missing.json()["error_code"] == "CHAT_SUPPORT_REQUIRES_REVIEW"

    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    listed = await client.get("/admin/disputes", headers=admin_headers)
    row = next(item for item in listed.json() if item["id"] == dispute_id)
    assert row["review_requested_at"] is not None

    conflicted = await client.post(
        f"/seller/disputes/{dispute_id}/escalate",
        json={"seller_note": "Account vẫn lỗi", "idempotency_key": "seller-esc-1"},
        headers=seller_headers,
    )
    assert conflicted.status_code == 409
    assert conflicted.json()["error_code"] == "CHAT_MESSAGE_ID_CONFLICT"
    room = await client.get(f"/chat/conversations/{conversation_id}", headers=seller_headers)
    bodies = [message["body"] for message in room.json()["messages"]]
    assert "Account vẫn lỗi" not in bodies
    assert bodies.count("Buyer looks fraudulent.") == 1


@pytest.mark.asyncio
async def test_timeout_job_skips_marketplace_review_case(client):
    buyer_token, seller_token, _, product_id = await setup_adapter_product(client)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    created = await client.post(
        "/orders",
        json={
            "product_id": product_id,
            "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
            "quantity": 1,
        },
        headers=buyer_headers,
    )
    assert created.status_code == 201, created.text
    order_id = created.json()["id"]
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Proxy is unavailable"},
        headers=buyer_headers,
    )
    dispute_id = opened.json()["id"]
    responded = await client.post(
        f"/seller/disputes/{dispute_id}/respond",
        json={"seller_note": "Replacement access has been issued."},
        headers=seller_headers,
    )
    assert responded.status_code == 200, responded.text
    escalated = await client.post(
        f"/orders/{order_id}/dispute/escalate",
        json={"note": "Seller is stalling.", "idempotency_key": "timeout-review-esc"},
        headers=buyer_headers,
    )
    assert escalated.status_code == 200, escalated.text
    assert escalated.json()["review_requested_at"] is not None

    async with SessionLocal() as db:
        dispute = await db.get(Dispute, dispute_id)
        dispute.resolution_deadline_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()

    await dispute_resolution_timeout_job()

    async with SessionLocal() as db:
        dispute = await db.get(Dispute, dispute_id)
        order = await db.get(Order, order_id)
        assert dispute.status == DisputeStatus.open
        assert dispute.review_requested_at is not None
        assert order.status == OrderStatus.delivered
        release = await db.scalar(
            select(Transaction.id).where(
                Transaction.type == TransactionType.purchase_release,
                Transaction.reference_id == f"order-{order_id}",
            )
        )
        assert release is None


@pytest.mark.asyncio
async def test_admin_reject_after_marketplace_review_releases_remaining_to_seller(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Broken", "idempotency_key": "reject-review-open"},
        headers=buyer_headers,
    )
    dispute_id = opened.json()["id"]
    escalated = await client.post(
        f"/orders/{order_id}/dispute/escalate",
        json={"note": "Need Marketplace to decide.", "idempotency_key": "reject-review-esc"},
        headers=buyer_headers,
    )
    assert escalated.status_code == 200, escalated.text
    rejected = await client.post(
        f"/admin/disputes/{dispute_id}/reject",
        json={"admin_note": "Buyer evidence is insufficient."},
        headers=admin_headers,
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "resolved_reject"

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.completed
        assert order.refunded_amount == 0
        release = await db.scalar(
            select(Transaction).where(
                Transaction.type == TransactionType.purchase_release,
                Transaction.reference_id == f"order-{order_id}",
            )
        )
        assert release is not None
        from src.sellers.tiers import platform_fee_percent
        from src.wallet.service import escrow_settlement
        seller = await db.get(Account, order.seller_id)
        remaining, fee = escrow_settlement(
            order.total_amount,
            order.refunded_amount,
            platform_fee_percent(seller.seller_tier if seller else "new"),
        )
        assert release.amount == remaining - fee


@pytest.mark.asyncio
async def test_unauthorized_append_and_escalate_are_rejected(client):
    buyer_token, _, order_id = await create_delivered_order(client)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    original = (await client.get(f"/orders/{order_id}/resources", headers=buyer_headers)).json()[0]["id"]
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Dead account", "resource_ids": [original], "idempotency_key": "unauth-open"},
        headers=buyer_headers,
    )
    assert opened.status_code == 201, opened.text
    outsider = await register_and_login(client, "unauth_outsider@example.com")
    outsider_headers = {"Authorization": f"Bearer {outsider}"}

    append = await client.post(
        f"/orders/{order_id}/dispute/claims",
        json={"reason": "Also mine", "resource_ids": [original], "idempotency_key": "unauth-claim"},
        headers=outsider_headers,
    )
    assert append.status_code == 403
    assert append.json()["error_code"] == "NOT_ORDER_OWNER"

    escalate = await client.post(
        f"/orders/{order_id}/dispute/escalate",
        json={"note": "Please help", "idempotency_key": "unauth-esc"},
        headers=outsider_headers,
    )
    assert escalate.status_code == 404
    assert escalate.json()["error_code"] == "ORDER_NOT_FOUND"

    seller_escalate = await client.post(
        f"/seller/disputes/{opened.json()['id']}/escalate",
        json={"seller_note": "Please help", "idempotency_key": "unauth-seller-esc"},
        headers=outsider_headers,
    )
    assert seller_escalate.status_code == 403

    anonymous = await client.post(
        f"/orders/{order_id}/dispute/escalate",
        json={"note": "Please help", "idempotency_key": "anon-esc"},
    )
    assert anonymous.status_code == 401
