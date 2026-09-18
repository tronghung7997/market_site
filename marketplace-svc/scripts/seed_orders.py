"""Seed demo orders with various statuses for both seller and provider products.

Run:  /tmp/seed-venv/bin/python marketplace-svc/scripts/seed_orders.py

Assumes seed_demo.py has already been run (accounts, products, providers exist).
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import asyncpg
import httpx

BASE = "http://localhost:8001"
DB = "postgresql://marketplace:marketplace@localhost:5432/marketplace"
PW = "DemoPass123!"
BUYER = "buyer@dxtrade.example.com"
ADMIN = "admin@dxtrade.example.com"


async def login(c: httpx.AsyncClient, email: str) -> dict:
    r = await c.post("/auth/login", json={"email": email, "password": PW})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def main():
    conn = await asyncpg.connect(DB)
    async with httpx.AsyncClient(base_url=BASE, timeout=15) as c:
        buyer = await login(c, BUYER)
        seller = await login(c, "seller@dxtrade.example.com")
        admin = await login(c, ADMIN)

        buyer_id = await conn.fetchval("SELECT id FROM accounts WHERE email=$1", BUYER)
        admin_id = await conn.fetchval("SELECT id FROM accounts WHERE email=$1", ADMIN)
        seller_id = await conn.fetchval("SELECT id FROM accounts WHERE email=$1", "seller@dxtrade.example.com")

        # Top up buyer wallet generously
        await c.post("/wallet/topup", headers=admin, json={"account_id": buyer_id, "amount": 10_000_000, "reason": "Demo seed"})

        # Restock seller resources for instant variants
        for vid in [1, 2, 4, 5, 8, 9]:
            items = [f"seed_resource_{vid}_{i}|data|extra" for i in range(5)]
            await c.post(f"/seller/variants/{vid}/resources", headers=seller, json={"items": items})
        print("  Topped up buyer: +10.000.000đ")

        # ─── 1. Seller product orders (old flow: variant_id) ───

        # Get variants for seller products
        twitter_variants = await conn.fetch(
            """SELECT v.id, v.name, v.price, v.delivery_mode FROM product_variants v
               JOIN products p ON v.product_id = p.id
               WHERE p.title LIKE 'Twitter%' AND v.is_active ORDER BY v.price"""
        )
        fb_variants = await conn.fetch(
            """SELECT v.id, v.name, v.price, v.delivery_mode FROM product_variants v
               JOIN products p ON v.product_id = p.id
               WHERE p.title LIKE 'Facebook%' AND v.is_active ORDER BY v.price"""
        )
        tg_variants = await conn.fetch(
            """SELECT v.id, v.name, v.price, v.delivery_mode FROM product_variants v
               JOIN products p ON v.product_id = p.id
               WHERE p.title LIKE 'Telegram%' AND v.is_active ORDER BY v.price"""
        )

        created = 0

        # Order 1: Twitter instant — completed
        if twitter_variants:
            v = twitter_variants[0]
            r = await c.post("/orders", headers=buyer, json={"variant_id": v["id"], "quantity": 1})
            if r.status_code == 201:
                oid = r.json()["id"]
                await c.post(f"/orders/{oid}/confirm", headers=buyer)
                created += 1
                print(f"  Order #{oid}: Twitter '{v['name']}' — completed")
            else:
                print(f"  FAIL: Twitter order: {r.status_code} {r.text[:100]}")

        # Order 2: Twitter instant — delivered (pending confirm)
        if len(twitter_variants) > 1:
            v = twitter_variants[1]
            r = await c.post("/orders", headers=buyer, json={"variant_id": v["id"], "quantity": 1})
            if r.status_code == 201:
                oid = r.json()["id"]
                created += 1
                print(f"  Order #{oid}: Twitter '{v['name']}' — delivered (awaiting confirm)")

        # Order 3: Facebook instant — completed + reviewed
        if fb_variants:
            v = fb_variants[0]
            r = await c.post("/orders", headers=buyer, json={"variant_id": v["id"], "quantity": 1})
            if r.status_code == 201:
                oid = r.json()["id"]
                await c.post(f"/orders/{oid}/confirm", headers=buyer)
                await c.post(f"/orders/{oid}/review", headers=buyer, json={"rating": 5, "comment": "Acc chất lượng, đăng nhập được ngay!"})
                created += 1
                print(f"  Order #{oid}: Facebook '{v['name']}' — completed + reviewed ★5")

        # Order 4: Telegram instant — delivered then disputed
        if tg_variants:
            v = tg_variants[0]
            r = await c.post("/orders", headers=buyer, json={"variant_id": v["id"], "quantity": 1})
            if r.status_code == 201:
                oid = r.json()["id"]
                await c.post(f"/orders/{oid}/dispute", headers=buyer, json={"reason": "Session không hoạt động, không kết nối được Telethon."})
                created += 1
                print(f"  Order #{oid}: Telegram '{v['name']}' — disputed")

        # Order 5: Facebook instant — completed + reviewed 3 stars
        if len(fb_variants) > 1:
            v = fb_variants[1]
            r = await c.post("/orders", headers=buyer, json={"variant_id": v["id"], "quantity": 1})
            if r.status_code == 201:
                oid = r.json()["id"]
                await c.post(f"/orders/{oid}/confirm", headers=buyer)
                await c.post(f"/orders/{oid}/review", headers=buyer, json={"rating": 3, "comment": "Acc hơi yếu, bạn bè ít."})
                created += 1
                print(f"  Order #{oid}: Facebook '{v['name']}' — completed + reviewed ★3")

        # Order 6: Twitter manual — pending (seller chưa accept)
        manual_variants = [v for v in twitter_variants if v["delivery_mode"] == "manual"]
        if manual_variants:
            v = manual_variants[0]
            r = await c.post("/orders", headers=buyer, json={"variant_id": v["id"], "quantity": 1})
            if r.status_code == 201:
                oid = r.json()["id"]
                created += 1
                print(f"  Order #{oid}: Twitter '{v['name']}' — pending (manual)")

        # ─── 2. Provider product orders (new flow: product_id + user_config) ───

        # Proxy order
        proxy_product = await conn.fetchrow(
            "SELECT id FROM products WHERE service_type='proxy' AND provider_id IS NOT NULL LIMIT 1"
        )
        if proxy_product:
            r = await c.post("/orders", headers=buyer, json={
                "product_id": proxy_product["id"],
                "user_config": {
                    "service_type": "proxy",
                    "type": "residential_static",
                    "network": "viettel",
                    "days": 30,
                    "quantity": 1,
                },
                "quantity": 1,
            })
            if r.status_code == 201:
                oid = r.json()["id"]
                created += 1
                print(f"  Order #{oid}: Proxy dân cư (provider) — delivered (mock IP)")

            # Another proxy — volume discount
            r = await c.post("/orders", headers=buyer, json={
                "product_id": proxy_product["id"],
                "user_config": {
                    "service_type": "proxy",
                    "type": "datacenter",
                    "network": "fpt",
                    "days": 7,
                    "quantity": 10,
                },
                "quantity": 1,
            })
            if r.status_code == 201:
                oid = r.json()["id"]
                created += 1
                print(f"  Order #{oid}: Proxy datacenter x10 (volume discount) — delivered")

        # Endpoint order
        endpoint_product = await conn.fetchrow(
            "SELECT id FROM products WHERE service_type='endpoint' AND provider_id IS NOT NULL LIMIT 1"
        )
        if endpoint_product:
            r = await c.post("/orders", headers=buyer, json={
                "product_id": endpoint_product["id"],
                "user_config": {
                    "service_type": "endpoint",
                    "package_size": 5000,
                },
                "quantity": 1,
            })
            if r.status_code == 201:
                oid = r.json()["id"]
                created += 1
                print(f"  Order #{oid}: TikTok Scraper API 5K credits — delivered (mock key)")

        # Takedown order
        takedown_product = await conn.fetchrow(
            "SELECT id FROM products WHERE service_type='takedown' AND provider_id IS NOT NULL LIMIT 1"
        )
        if takedown_product:
            r = await c.post("/orders", headers=buyer, json={
                "product_id": takedown_product["id"],
                "user_config": {
                    "service_type": "takedown",
                    "platform": "facebook",
                    "target_urls": "https://fb.com/post/123456\nhttps://fb.com/post/789012\nhttps://fb.com/page/scam-shop",
                    "quantity": 3,
                },
                "quantity": 1,
            })
            if r.status_code == 201:
                oid = r.json()["id"]
                created += 1
                print(f"  Order #{oid}: Takedown Facebook 3 URLs — delivered (tasks created)")

                # Simulate team processing some tasks
                tasks = await conn.fetch(
                    "SELECT id FROM service_tasks WHERE order_id=$1 ORDER BY id", oid
                )
                if len(tasks) >= 3:
                    await conn.execute(
                        "UPDATE service_tasks SET status='completed', assignee='Hùng', result_data='Takedown thành công. Facebook đã xoá bài.' WHERE id=$1",
                        tasks[0]["id"],
                    )
                    await conn.execute(
                        "UPDATE service_tasks SET status='processing', assignee='Minh' WHERE id=$1",
                        tasks[1]["id"],
                    )
                    print(f"    → Task #{tasks[0]['id']}: completed (Hùng)")
                    print(f"    → Task #{tasks[1]['id']}: processing (Minh)")
                    print(f"    → Task #{tasks[2]['id']}: pending")

        # Cloud order
        cloud_product = await conn.fetchrow(
            "SELECT id FROM products WHERE service_type='cloud' AND provider_id IS NOT NULL LIMIT 1"
        )
        if cloud_product:
            r = await c.post("/orders", headers=buyer, json={
                "product_id": cloud_product["id"],
                "user_config": {
                    "service_type": "cloud",
                    "plan": "standard",
                    "duration_months": 1,
                    "quantity": 1,
                },
                "quantity": 1,
            })
            if r.status_code == 201:
                oid = r.json()["id"]
                await c.post(f"/orders/{oid}/confirm", headers=buyer)
                created += 1
                print(f"  Order #{oid}: VPS Cloud Standard — completed")

        # ─── 3. Admin orders (admin as buyer) ───
        await c.post("/wallet/topup", headers=admin, json={"account_id": admin_id, "amount": 5_000_000, "reason": "Demo seed"})
        if tg_variants:
            v = tg_variants[0]
            r = await c.post("/orders", headers=admin, json={"variant_id": v["id"], "quantity": 2})
            if r.status_code == 201:
                oid = r.json()["id"]
                await c.post(f"/orders/{oid}/confirm", headers=admin)
                await c.post(f"/orders/{oid}/review", headers=admin, json={"rating": 4, "comment": "Session ổn, kết nối tốt."})
                created += 1
                print(f"  Order #{oid}: Admin bought Telegram x2 — completed + reviewed ★4")

    await conn.close()

    print(f"\nSeed orders complete: {created} orders created")
    print(f"  Buyer : {BUYER} / {PW}")
    print(f"  Admin : {ADMIN} / {PW}")


if __name__ == "__main__":
    asyncio.run(main())
