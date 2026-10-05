import pytest

from tests.conftest import make_admin, make_seller, register_and_login


async def _admin(client, email="mgmt_admin@example.com"):
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


# ── Feature A: admin edits product content + status ──────────────────

async def _seller_product(client):
    admin_token = await _admin(client, "mgmt_a_admin@example.com")
    await client.post("/admin/categories", json={"name": "MgmtCat", "slug": "mgmtcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cat_id = (await client.get("/categories")).json()[-1]["id"]

    seller_token = await register_and_login(client, "mgmt_seller@example.com")
    await make_seller("mgmt_seller@example.com")
    seller_token = await register_and_login(client, "mgmt_seller@example.com")
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Original", "status": "draft",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    return admin_token, seller_token, product.json()["id"]


@pytest.mark.asyncio
async def test_admin_updates_any_product_content_and_status(client):
    admin_token, _, product_id = await _seller_product(client)
    resp = await client.patch(f"/admin/products/{product_id}", json={
        "title": "Edited by admin", "description": "moderated", "status": "active",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200

    detail = await client.get(f"/products/{product_id}")
    assert detail.json()["title"] == "Edited by admin"
    assert detail.json()["description"] == "moderated"
    assert detail.json()["status"] == "active"


@pytest.mark.asyncio
async def test_admin_product_update_requires_admin(client):
    _, seller_token, product_id = await _seller_product(client)
    resp = await client.patch(f"/admin/products/{product_id}", json={"title": "hack"},
                              headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_seller_updates_english_translation_without_overwriting_vi(client):
    admin_token, seller_token, product_id = await _seller_product(client)
    headers = {"Authorization": f"Bearer {seller_token}"}

    translated = await client.patch(
        f"/seller/products/{product_id}/translations/en",
        json={
            "title": "English product title",
            "description": "English product description",
            "features": ["English feature"],
        },
        headers=headers,
    )
    assert translated.status_code == 200

    management = await client.get(
        f"/seller/products/{product_id}/detail", headers=headers,
    )
    body = management.json()
    assert body["title"] == "Original"
    assert body["translations"]["vi"]["title"] == "Original"
    assert body["translations"]["en"]["title"] == "English product title"
    assert set(body["available_locales"]) == {"en", "vi"}

    await client.patch(
        f"/admin/products/{product_id}",
        json={"status": "active"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    en = await client.get(
        f"/products/{product_id}", headers={"Accept-Language": "en"},
    )
    vi = await client.get(
        f"/products/{product_id}", headers={"Accept-Language": "vi"},
    )
    assert en.json()["title"] == "English product title"
    assert vi.json()["title"] == "Original"


@pytest.mark.asyncio
async def test_admin_updates_translation_and_seller_cannot_use_admin_route(client):
    admin_token, seller_token, product_id = await _seller_product(client)
    denied = await client.patch(
        f"/admin/products/{product_id}/translations/en",
        json={"title": "Not allowed"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert denied.status_code == 403

    updated = await client.patch(
        f"/admin/products/{product_id}/translations/en",
        json={"title": "Admin English title"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert updated.status_code == 200

    detail = await client.get(
        f"/admin/products/{product_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert detail.json()["translations"]["en"]["title"] == "Admin English title"


# ── Feature B: account & role management ─────────────────────────────

@pytest.mark.asyncio
async def test_admin_lists_accounts(client):
    admin_token = await _admin(client, "mgmt_b_admin@example.com")
    await register_and_login(client, "listed_user@example.com")

    resp = await client.get("/admin/accounts?search=listed_user",
                            headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 1
    assert any(u["email"] == "listed_user@example.com" for u in body["items"])


@pytest.mark.asyncio
async def test_admin_grants_and_revokes_roles(client):
    admin_token = await _admin(client, "mgmt_c_admin@example.com")
    reg = await client.post("/auth/register", json={"email": "role_target@example.com", "password": "StrongPass123!"})
    uid = reg.json()["id"]

    grant = await client.patch(f"/admin/accounts/{uid}/roles", json={"roles": ["buyer", "seller"]},
                               headers={"Authorization": f"Bearer {admin_token}"})
    assert grant.status_code == 200
    assert set(grant.json()["roles"]) == {"buyer", "seller"}

    revoke = await client.patch(f"/admin/accounts/{uid}/roles", json={"roles": ["buyer"]},
                                headers={"Authorization": f"Bearer {admin_token}"})
    assert set(revoke.json()["roles"]) == {"buyer"}


@pytest.mark.asyncio
async def test_role_update_rejects_invalid_role(client):
    admin_token = await _admin(client, "mgmt_d_admin@example.com")
    reg = await client.post("/auth/register", json={"email": "role_bad@example.com", "password": "StrongPass123!"})
    resp = await client.patch(f"/admin/accounts/{reg.json()['id']}/roles", json={"roles": ["wizard"]},
                              headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_admin_cannot_self_remove_admin(client):
    admin_token = await _admin(client, "mgmt_e_admin@example.com")
    me = await client.get("/me", headers={"Authorization": f"Bearer {admin_token}"})
    resp = await client.patch(f"/admin/accounts/{me.json()['id']}/roles", json={"roles": ["buyer"]},
                              headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_accounts_endpoints_require_admin(client):
    token = await register_and_login(client, "mgmt_nonadmin@example.com")
    assert (await client.get("/admin/accounts", headers={"Authorization": f"Bearer {token}"})).status_code == 403
    me = await client.get("/me", headers={"Authorization": f"Bearer {token}"})
    resp = await client.patch(f"/admin/accounts/{me.json()['id']}/roles", json={"roles": ["admin"]},
                              headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


# ── Feature A2: bulk product actions, audit trail, list columns ───────

@pytest.mark.asyncio
async def test_admin_bulk_status_logs_history_and_reports_skips(client):
    admin_token, seller_token, product_id = await _seller_product(client)
    admin = {"Authorization": f"Bearer {admin_token}"}

    paused = await client.post("/admin/products/bulk", json={
        "ids": [product_id, product_id, 999999], "action": "pause", "reason": "Kiểm tra nội dung",
    }, headers=admin)
    assert paused.status_code == 200
    body = paused.json()
    assert body["updated"] == [product_id]
    assert body["skipped"] == [{"id": 999999, "reason": "not_found"}]
    assert (await client.get(f"/admin/products/{product_id}", headers=admin)).json()["status"] == "paused"

    again = await client.post("/admin/products/bulk", json={"ids": [product_id], "action": "pause"}, headers=admin)
    assert again.json() == {"updated": [], "skipped": [{"id": product_id, "reason": "unchanged"}]}

    history = await client.get(f"/admin/products/{product_id}/activity", headers=admin)
    assert history.status_code == 200
    first = history.json()[0]
    assert first["event"] == "admin_product_status_changed"
    assert first["actor_email"] == "mgmt_a_admin@example.com"
    assert first["details"]["from"] == "draft"
    assert first["details"]["to"] == "paused"
    assert first["details"]["reason"] == "Kiểm tra nội dung"
    assert "ip" not in first["details"]


@pytest.mark.asyncio
async def test_admin_bulk_moves_category_and_validates_input(client):
    admin_token, _, product_id = await _seller_product(client)
    admin = {"Authorization": f"Bearer {admin_token}"}
    await client.post("/admin/categories", json={"name": "MgmtCat2", "slug": "mgmtcat2"}, headers=admin)
    target = next(c for c in (await client.get("/categories")).json() if c["slug"] == "mgmtcat2")

    missing = await client.post("/admin/products/bulk", json={"ids": [product_id], "action": "set_category"}, headers=admin)
    assert missing.status_code == 422
    bogus = await client.post("/admin/products/bulk", json={"ids": [product_id], "action": "delete"}, headers=admin)
    assert bogus.status_code == 422
    empty = await client.post("/admin/products/bulk", json={"ids": [], "action": "pause"}, headers=admin)
    assert empty.status_code == 422

    moved = await client.post("/admin/products/bulk", json={
        "ids": [product_id], "action": "set_category", "category_id": target["id"],
    }, headers=admin)
    assert moved.status_code == 200
    assert moved.json()["updated"] == [product_id]

    listed = await client.get("/admin/products", params={"search": "Original"}, headers=admin)
    row = next(item for item in listed.json()["items"] if item["id"] == product_id)
    assert row["category_id"] == target["id"]
    assert row["category_name"] == "MgmtCat2"
    assert row["variant_count"] == 0
    assert "price_from" in row and "stock_count" in row and "strategy_name" in row


@pytest.mark.asyncio
async def test_admin_bulk_and_activity_require_admin(client):
    _, seller_token, product_id = await _seller_product(client)
    seller = {"Authorization": f"Bearer {seller_token}"}
    denied = await client.post("/admin/products/bulk", json={"ids": [product_id], "action": "suspend"}, headers=seller)
    assert denied.status_code == 403
    assert (await client.get(f"/admin/products/{product_id}/activity", headers=seller)).status_code == 403
    assert (await client.post("/admin/products/bulk", json={"ids": [product_id], "action": "suspend"})).status_code == 401


@pytest.mark.asyncio
async def test_admin_patch_rejects_unknown_status_and_suspend_records_reason(client):
    admin_token, _, product_id = await _seller_product(client)
    admin = {"Authorization": f"Bearer {admin_token}"}
    bad = await client.patch(f"/admin/products/{product_id}", json={"status": "deleted"}, headers=admin)
    assert bad.status_code == 422

    suspended = await client.post(
        f"/admin/products/{product_id}/suspend", json={"reason": "Vi phạm chính sách"}, headers=admin,
    )
    assert suspended.status_code == 200
    assert suspended.json()["status"] == "suspended"
    no_body = await client.post(f"/admin/products/{product_id}/suspend", headers=admin)
    assert no_body.status_code == 200

    edited = await client.patch(f"/admin/products/{product_id}", json={"title": "Renamed"}, headers=admin)
    assert edited.status_code == 200
    events = [e["event"] for e in (await client.get(f"/admin/products/{product_id}/activity", headers=admin)).json()]
    assert events[:2] == ["admin_product_content_updated", "admin_product_status_changed"]


@pytest.mark.asyncio
async def test_admin_translation_edit_logs_only_changed_fields(client):
    admin_token, _, product_id = await _seller_product(client)
    admin = {"Authorization": f"Bearer {admin_token}"}
    await client.patch(f"/admin/products/{product_id}/translations/vi", json={
        "title": "Original", "description": "Mô tả mới",
    }, headers=admin)
    # Lưu lại y nguyên thì không sinh thêm dòng lịch sử.
    await client.patch(f"/admin/products/{product_id}/translations/vi", json={
        "title": "Original", "description": "Mô tả mới",
    }, headers=admin)
    escrow = (await client.get(f"/admin/products/{product_id}", headers=admin)).json()["escrow_days"]
    await client.patch(f"/admin/products/{product_id}", json={"escrow_days": escrow}, headers=admin)

    history = (await client.get(f"/admin/products/{product_id}/activity", headers=admin)).json()
    content = [e for e in history if e["event"] == "admin_product_content_updated"]
    assert len(content) == 1
    assert content[0]["details"] == {"fields": ["description"], "locale": "vi"}


@pytest.mark.asyncio
async def test_hidden_product_preview_is_owner_and_admin_only(client):
    admin_token, seller_token, product_id = await _seller_product(client)   # status draft
    admin = {"Authorization": f"Bearer {admin_token}"}
    seller = {"Authorization": f"Bearer {seller_token}"}
    ref = (await client.get(f"/admin/products/{product_id}", headers=admin)).json()["public_key"]

    # Khách và mọi người khác vẫn thấy 404 như trước.
    assert (await client.get(f"/products/{ref}")).status_code == 404

    own = await client.get(f"/seller/products/{ref}/preview", headers=seller)
    assert own.status_code == 200
    assert own.json()["id"] == product_id
    assert own.json()["status"] == "draft"

    by_admin = await client.get(f"/admin/products/{ref}/preview", headers=admin)
    assert by_admin.status_code == 200
    assert by_admin.json()["title"] == "Original"

    await register_and_login(client, "mgmt_other_seller@example.com")
    await make_seller("mgmt_other_seller@example.com")
    other = {"Authorization": f"Bearer {await register_and_login(client, 'mgmt_other_seller@example.com')}"}
    assert (await client.get(f"/seller/products/{ref}/preview", headers=other)).status_code == 404
    assert (await client.get(f"/admin/products/{ref}/preview", headers=seller)).status_code == 403

    buyer = {"Authorization": f"Bearer {await register_and_login(client, 'mgmt_preview_buyer@example.com')}"}
    assert (await client.get(f"/seller/products/{ref}/preview", headers=buyer)).status_code == 403
    assert (await client.get(f"/seller/products/{ref}/preview")).status_code == 401


# ── Accounts directory + account 360 ─────────────────────────────────

def _h(token):
    return {"Authorization": f"Bearer {token}"}


async def _account_id(email):
    from sqlalchemy import select

    from src.database import SessionLocal
    from src.models.account import Account

    async with SessionLocal() as db:
        return await db.scalar(select(Account.id).where(Account.email == email))


async def _order(buyer_id, seller_id, amount=50_000, status="pending"):
    from src.database import SessionLocal
    from src.models.order import Order, OrderStatus

    async with SessionLocal() as db:
        order = Order(buyer_id=buyer_id, seller_id=seller_id, quantity=1, total_amount=amount, status=OrderStatus(status))
        db.add(order)
        await db.commit()
        await db.refresh(order)
        return order.id, order.order_code


async def _set_balance(account_id, amount):
    from sqlalchemy import update

    from src.database import SessionLocal
    from src.models.wallet import Wallet

    async with SessionLocal() as db:
        await db.execute(update(Wallet).where(Wallet.account_id == account_id).values(available_balance=amount))
        await db.commit()


@pytest.mark.asyncio
async def test_directory_search_variants_row_fields_and_sort(client):
    from src.database import SessionLocal
    from src.models.login_event import LoginEvent

    admin = _h(await _admin(client, "dir_admin@example.com"))
    await register_and_login(client, "dir_buyer@example.com")
    await register_and_login(client, "dir_seller@example.com")
    await make_seller("dir_seller@example.com")
    buyer_id, seller_id = await _account_id("dir_buyer@example.com"), await _account_id("dir_seller@example.com")
    _, code = await _order(buyer_id, seller_id)
    await _set_balance(buyer_id, 70_000)
    async with SessionLocal() as db:
        db.add(LoginEvent(account_id=buyer_id, kind="login", outcome="success", ip="198.51.100.7"))
        await db.commit()

    async def emails(**params):
        res = await client.get("/admin/accounts", params=params, headers=admin)
        assert res.status_code == 200, res.text
        return sorted(r["email"] for r in res.json()["items"])

    assert await emails(search=f"#{buyer_id}") == ["dir_buyer@example.com"]
    assert await emails(search=code) == ["dir_buyer@example.com", "dir_seller@example.com"]
    assert await emails(search=code.lower()) == ["dir_buyer@example.com", "dir_seller@example.com"]
    assert await emails(search="198.51.100.7") == ["dir_buyer@example.com"]
    assert await emails(search="dir_sel") == ["dir_seller@example.com"]
    assert await emails(search="ORD-NOPE") == []
    assert "dir_seller@example.com" not in await emails(tier="trusted,enterprise")
    assert "dir_seller@example.com" in await emails(tier="new,bogus", role="seller")

    page = (await client.get("/admin/accounts", params={"sort": "balance", "per_page": 100}, headers=admin)).json()
    top = page["items"][0]
    assert top["email"] == "dir_buyer@example.com" and top["available_balance"] == 70_000
    assert top["orders_bought"] == 1 and top["orders_sold"] == 0 and top["risk_flags"] == []
    assert "risky" in page["summary"]
    from datetime import timedelta

    from sqlalchemy import update

    from src.models.account import Account

    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.id == seller_id).values(created_at=Account.created_at - timedelta(days=8)))
        await db.commit()
    fresh = await emails(status="new_7d")
    assert "dir_buyer@example.com" in fresh and "dir_seller@example.com" not in fresh
    assert (await client.get("/admin/accounts", params={"per_page": 101}, headers=admin)).status_code == 422


@pytest.mark.asyncio
async def test_risky_status_failed_logins_and_shared_phone(client):
    from sqlalchemy import update

    from src.database import SessionLocal
    from src.models.account import Account

    admin = _h(await _admin(client, "risky_admin@example.com"))
    await client.post("/auth/register", json={"email": "guessed@example.com", "password": "StrongPass123!"})
    for _ in range(5):
        await client.post("/auth/login", json={"email": "guessed@example.com", "password": "WrongPass123!"})
    await register_and_login(client, "phone_a@example.com")
    await register_and_login(client, "phone_b@example.com")
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email.in_(["phone_a@example.com", "phone_b@example.com"]))
                         .values(phone="0987 654 321"))
        await db.execute(update(Account).where(Account.email == "phone_b@example.com").values(is_active=False))
        await db.commit()
    res = (await client.get("/admin/accounts", params={"status": "risky"}, headers=admin)).json()
    flags = {r["email"]: r["risk_flags"] for r in res["items"]}
    assert flags == {"guessed@example.com": ["failed_logins"], "phone_a@example.com": ["shared_phone"]}
    assert res["summary"]["risky"] == 2


@pytest.mark.asyncio
async def test_lock_persists_reason_and_bulk_skips_self(client):
    token = await _admin(client, "bulk_admin@example.com")
    admin = _h(token)
    me = await _account_id("bulk_admin@example.com")
    await register_and_login(client, "bulk_1@example.com")
    victim = await register_and_login(client, "bulk_2@example.com")
    ids = [await _account_id("bulk_1@example.com"), await _account_id("bulk_2@example.com")]

    res = await client.post("/admin/accounts/bulk-status", json={"ids": [*ids, me, 999999], "active": False,
                                                                 "reason": "Spam ring"}, headers=admin)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["updated"] == ids
    assert {"id": me, "reason": "self"} in body["skipped"] and {"id": 999999, "reason": "not_found"} in body["skipped"]
    assert (await client.get("/me", headers=_h(victim))).status_code == 401  # sessions revoked
    row = (await client.get(f"/admin/accounts/{ids[0]}", headers=admin)).json()
    assert row["is_active"] is False and row["lock_reason"] == "Spam ring"
    assert row["locked_by_email"] == "bulk_admin@example.com" and row["locked_at"]
    again = (await client.post("/admin/accounts/bulk-status", json={"ids": ids, "active": False}, headers=admin)).json()
    assert again["updated"] == [] and all(s["reason"] == "unchanged" for s in again["skipped"])

    unlocked = await client.patch(f"/admin/accounts/{ids[0]}/status", json={"is_active": True}, headers=admin)
    assert unlocked.json()["lock_reason"] is None and unlocked.json()["locked_at"] is None
    assert (await client.post("/admin/accounts/bulk-status", json={"ids": [], "active": False}, headers=admin)).status_code == 422
    assert (await client.post("/admin/accounts/bulk-status", json={"ids": list(range(1, 202)), "active": False},
                              headers=admin)).status_code == 422
    user = await register_and_login(client, "bulk_user@example.com")
    assert (await client.post("/admin/accounts/bulk-status", json={"ids": ids, "active": True},
                              headers=_h(user))).status_code == 403


@pytest.mark.asyncio
async def test_export_csv_same_filters(client):
    admin = _h(await _admin(client, "csv_admin@example.com"))
    await register_and_login(client, "=csv_user@example.com")
    res = await client.get("/admin/accounts/export.csv", params={"search": "csv_user"}, headers=admin)
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    lines = res.text.strip().splitlines()
    assert lines[0] == "id,email,roles,tier,is_active,email_verified,available_balance,orders_bought,orders_sold,created_at,last_login_at"
    assert len(lines) == 2 and "'=csv_user@example.com" in lines[1]
    picked = await _account_id("csv_admin@example.com")
    sel = await client.get("/admin/accounts/export.csv", params={"ids": f"{picked}", "search": "csv_user"}, headers=admin)
    rows = sel.text.strip().splitlines()[1:]
    assert len(rows) == 1 and rows[0].startswith(f"{picked},csv_admin@example.com")
    for bad in ("1,x", ",".join(str(i) for i in range(1, 202))):
        assert (await client.get("/admin/accounts/export.csv", params={"ids": bad}, headers=admin)).status_code == 422
    user = await register_and_login(client, "csv_nonadmin@example.com")
    assert (await client.get("/admin/accounts/export.csv", headers=_h(user))).status_code == 403


@pytest.mark.asyncio
async def test_wallet_debit_ledger_and_overdraft(client):
    from sqlalchemy import select

    from src.database import SessionLocal
    from src.models.wallet import Transaction, TransactionType, Wallet

    admin = _h(await _admin(client, "debit_admin@example.com"))
    user = await register_and_login(client, "debit_user@example.com")
    uid = await _account_id("debit_user@example.com")
    await _set_balance(uid, 30_000)

    over = await client.post(f"/admin/accounts/{uid}/wallet-debit", json={"amount": 30_001, "reason": "Thu hồi"}, headers=admin)
    assert over.status_code == 400
    for bad in ({"amount": 0, "reason": "Thu hồi"}, {"amount": 10, "reason": "x"}, {"amount": 10}):
        assert (await client.post(f"/admin/accounts/{uid}/wallet-debit", json=bad, headers=admin)).status_code == 422
    assert (await client.post(f"/admin/accounts/{uid}/wallet-debit", json={"amount": 1, "reason": "Thu hồi"},
                              headers=_h(user))).status_code == 403
    assert (await client.post("/admin/accounts/999999/wallet-debit", json={"amount": 1, "reason": "Thu hồi"},
                              headers=admin)).status_code == 404

    ok = await client.post(f"/admin/accounts/{uid}/wallet-debit", json={"amount": 30_000, "reason": "Thu hồi khuyến mãi"}, headers=admin)
    assert ok.status_code == 200, ok.text
    assert ok.json()["available_balance"] == 0
    async with SessionLocal() as db:
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == uid))
        tx = await db.scalar(select(Transaction).where(Transaction.wallet_id == wallet.id))
    assert tx.type == TransactionType.adjustment_debit and tx.amount == 30_000
    assert "Thu hồi khuyến mãi" in tx.description


@pytest.mark.asyncio
async def test_removing_seller_role_with_activity_needs_confirm(client):
    admin = _h(await _admin(client, "role409_admin@example.com"))
    await register_and_login(client, "role409_seller@example.com")
    await make_seller("role409_seller@example.com")
    await register_and_login(client, "role409_buyer@example.com")
    sid, bid = await _account_id("role409_seller@example.com"), await _account_id("role409_buyer@example.com")
    await _order(bid, sid, amount=25_000, status="processing")

    res = await client.patch(f"/admin/accounts/{sid}/roles", json={"roles": ["buyer"]}, headers=admin)
    assert res.status_code == 409
    assert res.json()["detail"] == {"code": "seller_has_activity", "active_products": 0, "escrow_incoming": 25_000}
    ok = await client.patch(f"/admin/accounts/{sid}/roles", json={"roles": ["buyer"], "confirm": True}, headers=admin)
    assert ok.status_code == 200 and ok.json()["roles"] == ["buyer"]


@pytest.mark.asyncio
async def test_account_overview_sessions_reset_orders_disputes_notes(client):
    from sqlalchemy import select

    from src.database import SessionLocal
    from src.models.mail import MailOutbox

    admin = _h(await _admin(client, "ov_admin@example.com"))
    user = await register_and_login(client, "ov_user@example.com")
    await register_and_login(client, "ov_seller@example.com")
    await make_seller("ov_seller@example.com")
    uid, sid = await _account_id("ov_user@example.com"), await _account_id("ov_seller@example.com")
    order_id, code = await _order(uid, sid)

    ov = await client.get(f"/admin/accounts/{uid}/overview", headers=admin)
    assert ov.status_code == 200, ov.text
    body = ov.json()
    assert body["account"]["email"] == "ov_user@example.com" and body["lock"] is None
    assert body["kpis"]["orders_bought"] == 1 and body["kpis"]["dispute_rate_pct"] is None
    assert body["sessions_active"] >= 1 and body["application"] is None and body["shop"] is None
    assert any(t["kind"] == "order_bought" and code in t["text"] and t["href"] == f"/admin/orders/{order_id}"
               for t in body["timeline"])
    seller_ov = (await client.get(f"/admin/accounts/{sid}/overview", headers=admin)).json()
    assert seller_ov["kpis"]["orders_sold"] == 1 and seller_ov["kpis"]["gmv_30d"] == 50_000
    assert seller_ov["kpis"]["escrow_incoming"] == 50_000

    orders = (await client.get(f"/admin/accounts/{uid}/orders", params={"side": "buyer"}, headers=admin)).json()
    assert [o["order_code"] for o in orders["items"]] == [code]
    sold = (await client.get(f"/admin/accounts/{uid}/orders", params={"side": "seller"}, headers=admin)).json()
    assert sold["items"] == []
    assert (await client.get(f"/admin/accounts/{uid}/orders", params={"side": "x"}, headers=admin)).status_code == 422
    disputes = (await client.get(f"/admin/accounts/{uid}/disputes", headers=admin)).json()
    assert disputes["items"] == [] and disputes["total"] == 0

    note = await client.post(f"/admin/accounts/{uid}/notes", json={"body": "Khách VIP"}, headers=admin)
    assert note.status_code == 201
    assert [n["body"] for n in (await client.get(f"/admin/accounts/{uid}/notes", headers=admin)).json()] == ["Khách VIP"]
    assert (await client.post(f"/admin/accounts/{uid}/notes", json={"body": ""}, headers=admin)).status_code == 422

    assert (await client.post(f"/admin/accounts/{uid}/password-reset", headers=admin)).status_code == 204
    async with SessionLocal() as db:
        mails = (await db.execute(select(MailOutbox).where(MailOutbox.template == "password_reset"))).scalars().all()
    assert len(mails) == 1 and mails[0].to_email == "ov_user@example.com"

    revoked = await client.post(f"/admin/accounts/{uid}/sessions/revoke", headers=admin)
    assert revoked.status_code == 200 and revoked.json()["revoked"] >= 1
    assert (await client.get("/me", headers=_h(user))).status_code == 401
    timeline = (await client.get(f"/admin/accounts/{uid}/overview", headers=admin)).json()["timeline"]
    assert any(t["kind"] == "admin_action" and "account_sessions_revoked" in t["text"] for t in timeline)

    for path in ("overview", "notes", "orders", "disputes"):
        assert (await client.get(f"/admin/accounts/{uid}/{path}", headers=_h(await register_and_login(client, "ov_x@example.com")))).status_code == 403
        assert (await client.get(f"/admin/accounts/999999/{path}", headers=admin)).status_code == 404
    other = await register_and_login(client, "ov_y@example.com")
    for path in ("sessions/revoke", "password-reset"):
        assert (await client.post(f"/admin/accounts/{uid}/{path}", headers=_h(other))).status_code == 403


@pytest.mark.asyncio
async def test_admin_product_list_hides_seeded_shops_unless_asked(client):
    from sqlalchemy import update

    from src.database import SessionLocal
    from src.models.account import Account

    admin_token, _, product_id = await _seller_product(client)
    admin = {"Authorization": f"Bearer {admin_token}"}
    ids = lambda r: {p["id"] for p in r.json()["items"]}  # noqa: E731
    assert product_id in ids(await client.get("/admin/products", headers=admin))
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == "mgmt_seller@example.com").values(is_seeded=True))
        await db.commit()
    hidden = await client.get("/admin/products", headers=admin)
    assert hidden.status_code == 200 and product_id not in ids(hidden)
    assert hidden.json()["counts"]["all"] == 0
    shown = await client.get("/admin/products", params={"include_seed": "true"}, headers=admin)
    assert product_id in ids(shown)
