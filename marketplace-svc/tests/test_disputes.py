import asyncio

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.order import Order, OrderStatus
from src.models.wallet import Transaction, TransactionType
from tests.conftest import make_admin, make_seller, register_and_login
from tests.test_orders import setup_adapter_product


async def create_delivered_order(client):
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
        "items": ["uid|pass"],
    }, headers={"Authorization": f"Bearer {seller_token}"})

    buyer_token = await register_and_login(client, "disp_buyer@example.com")
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    await client.post("/wallet/topup", json={"account_id": buyer_me.json()["id"], "amount": 50000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    order = await client.post("/orders", json={"variant_id": variant.json()["id"], "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    return buyer_token, admin_token, order.json()["id"]


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
