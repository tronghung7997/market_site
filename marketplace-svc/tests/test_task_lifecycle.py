"""Order↔ServiceTask lifecycle: manual fulfillment is task-driven.

Mua takedown -> order 'processing'; admin hoàn thành task cuối -> 'delivered'
+ escrow; task fail -> refund tỉ lệ; fail hết -> cancelled + refund đủ.
"""

import pytest
from sqlalchemy import update

from src.database import SessionLocal
from src.models.product import Product
from src.models.provider import Provider

from .conftest import register_and_login, make_admin, make_seller

TASK_PARAMS = {
    "base_price": 100000,
    "platform_mult": {"facebook": 1.0},
}


def urls(n: int) -> str:
    return "\n".join(f"https://fb.com/post/{i}" for i in range(n))


async def setup_takedown_product(client, suffix=""):
    """Admin + manual provider + product task-pricing + buyer có 1_000_000 credit."""
    admin_email = f"tl_admin{suffix}@example.com"
    admin_token = await register_and_login(client, admin_email)
    await make_admin(admin_email)
    admin_token = await register_and_login(client, admin_email)

    await client.post("/admin/categories", json={"name": f"TD{suffix}", "slug": f"td{suffix}"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    provider_resp = await client.post("/admin/providers", json={
        "name": f"Takedown Team{suffix}", "type": "takedown", "config": {},
        "priority": 1,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    provider_id = provider_resp.json()["id"]
    async with SessionLocal() as db:
        await db.execute(
            update(Provider).where(Provider.id == provider_id).values(adapter_type="manual")
        )
        await db.commit()

    seller_email = f"tl_seller{suffix}@example.com"
    seller_token = await register_and_login(client, seller_email)
    await make_seller(seller_email)
    seller_token = await register_and_login(client, seller_email)

    product_resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Takedown", "status": "active",
        "escrow_days": 3, "service_type": "takedown",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product_resp.json()["id"]
    async with SessionLocal() as db:
        await db.execute(
            update(Product).where(Product.id == product_id).values(
                provider_id=provider_id,
                pricing_strategy="task",
                pricing_params=TASK_PARAMS,
            )
        )
        await db.commit()

    buyer_email = f"tl_buyer{suffix}@example.com"
    buyer_token = await register_and_login(client, buyer_email)
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_id = buyer_me.json()["id"]
    await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 1000000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    return buyer_token, admin_token, product_id, buyer_id


async def buy_takedown(client, buyer_token, product_id, n_urls):
    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"platform": "facebook", "target_urls": urls(n_urls)},
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def get_wallet_balance(client, token) -> int:
    resp = await client.get("/wallet", headers={"Authorization": f"Bearer {token}"})
    return resp.json()["balance"]


async def admin_tasks_for_order(client, admin_token, order_id):
    resp = await client.get("/admin/tasks", headers={"Authorization": f"Bearer {admin_token}"})
    return [t for t in resp.json() if t["order_id"] == order_id]


@pytest.mark.asyncio
async def test_manual_order_processing_until_all_tasks_complete(client):
    buyer_token, admin_token, product_id, _ = await setup_takedown_product(client)

    order = await buy_takedown(client, buyer_token, product_id, 4)
    # 100000 * 4 URL, chưa giao — đang chờ xử lý thủ công
    assert order["total_amount"] == 400000
    assert order["quantity"] == 4
    assert order["status"] == "processing"
    assert order["escrow_expires_at"] is None

    tasks = await admin_tasks_for_order(client, admin_token, order["id"])
    assert len(tasks) == 4
    assert all(t["status"] == "pending" for t in tasks)

    # Hoàn thành 3/4: order vẫn processing
    for t in tasks[:3]:
        resp = await client.put(f"/admin/tasks/{t['id']}", json={"status": "completed"},
                                headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 200
        assert resp.json()["order_status"] == "processing"

    # Task cuối: order delivered + escrow bắt đầu
    resp = await client.put(f"/admin/tasks/{tasks[3]['id']}", json={"status": "completed"},
                            headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    assert resp.json()["order_status"] == "delivered"

    order_resp = await client.get(f"/orders/{order['id']}",
                                  headers={"Authorization": f"Bearer {buyer_token}"})
    data = order_resp.json()
    assert data["status"] == "delivered"
    assert data["escrow_expires_at"] is not None


@pytest.mark.asyncio
async def test_partial_failure_refunds_proportionally(client):
    buyer_token, admin_token, product_id, _ = await setup_takedown_product(client, suffix="p")

    order = await buy_takedown(client, buyer_token, product_id, 4)
    balance_after_buy = await get_wallet_balance(client, buyer_token)

    tasks = await admin_tasks_for_order(client, admin_token, order["id"])
    for t in tasks[:3]:
        await client.put(f"/admin/tasks/{t['id']}", json={"status": "completed"},
                         headers={"Authorization": f"Bearer {admin_token}"})
    resp = await client.put(f"/admin/tasks/{tasks[3]['id']}", json={"status": "failed"},
                            headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.json()["order_status"] == "delivered"

    # Refund 1/4 của 400000 = 100000
    assert await get_wallet_balance(client, buyer_token) == balance_after_buy + 100000

    order_resp = await client.get(f"/orders/{order['id']}",
                                  headers={"Authorization": f"Bearer {buyer_token}"})
    data = order_resp.json()
    assert data["status"] == "delivered"
    # total_amount giảm phần refund để escrow release sau này trả seller đúng phần còn lại
    assert data["total_amount"] == 300000


@pytest.mark.asyncio
async def test_all_tasks_failed_cancels_and_refunds_fully(client):
    buyer_token, admin_token, product_id, _ = await setup_takedown_product(client, suffix="f")

    balance_before = await get_wallet_balance(client, buyer_token)
    order = await buy_takedown(client, buyer_token, product_id, 2)

    tasks = await admin_tasks_for_order(client, admin_token, order["id"])
    await client.put(f"/admin/tasks/{tasks[0]['id']}", json={"status": "failed"},
                     headers={"Authorization": f"Bearer {admin_token}"})
    resp = await client.put(f"/admin/tasks/{tasks[1]['id']}", json={"status": "failed"},
                            headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.json()["order_status"] == "cancelled"

    assert await get_wallet_balance(client, buyer_token) == balance_before


@pytest.mark.asyncio
async def test_update_task_can_clear_assignee(client):
    buyer_token, admin_token, product_id, _ = await setup_takedown_product(client, suffix="a")
    order = await buy_takedown(client, buyer_token, product_id, 1)
    tasks = await admin_tasks_for_order(client, admin_token, order["id"])

    resp = await client.put(f"/admin/tasks/{tasks[0]['id']}", json={"assignee": "alice"},
                            headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.json()["assignee"] == "alice"

    resp = await client.put(f"/admin/tasks/{tasks[0]['id']}", json={"assignee": None},
                            headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    assert resp.json()["assignee"] is None


@pytest.mark.asyncio
async def test_admin_tasks_list_includes_order_status(client):
    buyer_token, admin_token, product_id, _ = await setup_takedown_product(client, suffix="l")
    order = await buy_takedown(client, buyer_token, product_id, 1)

    tasks = await admin_tasks_for_order(client, admin_token, order["id"])
    assert tasks[0]["order_status"] == "processing"
