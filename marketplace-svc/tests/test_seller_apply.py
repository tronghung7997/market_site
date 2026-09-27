import pytest
from tests.conftest import make_admin, make_seller, register_and_login


@pytest.mark.asyncio
async def test_buyer_can_apply_for_seller(client):
    token = await register_and_login(client, "apply1@example.com")
    resp = await client.post("/seller/apply", json={
        "business_name": "My Shop",
        "description": "Selling accounts",
        "contact": "telegram @myshop",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    assert resp.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_admin_can_list_applications(client):
    token = await register_and_login(client, "admin_list@example.com")
    await make_admin("admin_list@example.com")
    token = await register_and_login(client, "admin_list@example.com")
    resp = await client.get("/admin/seller-applications", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_admin_approve_application(client):
    buyer_token = await register_and_login(client, "toapprove@example.com")
    await client.post("/seller/apply", json={
        "business_name": "Approve Me",
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    admin_token = await register_and_login(client, "admin_approve@example.com")
    await make_admin("admin_approve@example.com")
    admin_token = await register_and_login(client, "admin_approve@example.com")

    apps = await client.get("/admin/seller-applications", headers={"Authorization": f"Bearer {admin_token}"})
    app_id = apps.json()[-1]["id"]

    resp = await client.post(f"/admin/seller-applications/{app_id}/approve",
                             headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"

    # Verify buyer now has seller role
    buyer_token2 = await register_and_login(client, "toapprove@example.com")
    me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token2}"})
    assert "seller" in me.json()["roles"]


@pytest.mark.asyncio
async def test_non_admin_cannot_approve(client):
    token = await register_and_login(client, "nonadmin@example.com")
    resp = await client.post("/admin/seller-applications/1/approve",
                             headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def _admin_headers(client, email="apply_wizard_admin@example.com"):
    await register_and_login(client, email)
    await make_admin(email)
    return {"Authorization": f"Bearer {await register_and_login(client, email)}"}


@pytest.mark.asyncio
async def test_wizard_answers_are_stored_and_shown_to_the_applicant_and_admin(client):
    admin = await _admin_headers(client)
    await client.post("/admin/categories", json={"name": "Proxy", "slug": "proxy-wizard"}, headers=admin)
    await client.post("/admin/categories", json={"name": "Accounts", "slug": "accounts-wizard"}, headers=admin)
    cats = [c["id"] for c in (await client.get("/categories")).json()]

    token = await register_and_login(client, "wizard@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    resp = await client.post("/seller/apply", json={
        "business_name": "Wizard Shop",
        "description": "Residential proxies, delivered by API",
        "contact": "telegram @wizard",
        "seller_type": "business",
        "category_ids": [cats[1], cats[0], cats[1]],
        "experience": "1_3y",
        "phone": "+84 912 345 678",
        "warranty_policy": "  Replace within 24h  ",
        "referral_source": "community",
        "accept_rules": True,
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["seller_type"] == "business"
    assert body["category_ids"] == [cats[1], cats[0]]
    assert body["experience"] == "1_3y" and body["referral_source"] == "community"
    assert body["phone"] == "+84 912 345 678"
    assert body["warranty_policy"] == "Replace within 24h"
    assert body["rules_accepted_at"] is not None

    mine = (await client.get("/seller/applications/me", headers=headers)).json()
    assert mine["category_ids"] == [cats[1], cats[0]]
    listed = next(a for a in (await client.get("/admin/seller-applications", headers=admin)).json() if a["id"] == body["id"])
    assert listed["seller_type"] == "business" and listed["warranty_policy"] == "Replace within 24h"


@pytest.mark.asyncio
async def test_wizard_rejects_unknown_values_and_categories(client):
    token = await register_and_login(client, "wizard_bad@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    base = {"business_name": "Bad Wizard"}
    for bad in (
        {"seller_type": "company"},
        {"experience": "forever"},
        {"referral_source": "billboard"},
        {"phone": "call me maybe"},
        {"category_ids": list(range(1, 14))},
    ):
        res = await client.post("/seller/apply", json={**base, **bad}, headers=headers)
        assert res.status_code == 422, (bad, res.text)
    unknown = await client.post("/seller/apply", json={**base, "category_ids": [999999]}, headers=headers)
    assert unknown.status_code == 422
    # Nothing was stored by the rejected attempts, so a clean submission still works.
    ok = await client.post("/seller/apply", json=base, headers=headers)
    assert ok.status_code == 201, ok.text
    assert ok.json()["rules_accepted_at"] is None and ok.json()["category_ids"] is None


@pytest.mark.asyncio
async def test_wizard_requires_a_signed_in_account(client):
    assert (await client.post("/seller/apply", json={"business_name": "Nobody"})).status_code == 401


@pytest.mark.asyncio
async def test_admin_can_ask_for_more_information_and_the_applicant_resubmits(client):
    from sqlalchemy import select

    from src.database import SessionLocal
    from src.models.mail import MailOutbox

    admin = await _admin_headers(client, "apply_info_admin@example.com")
    applicant = {"Authorization": f"Bearer {await register_and_login(client, 'apply_info@example.com')}"}
    first = await client.post("/seller/apply", json={"business_name": "Kho Mơ Hồ"}, headers=applicant)
    app_id = first.json()["id"]

    asked = await client.post(
        f"/admin/seller-applications/{app_id}/request-info",
        json={"note": "  Cho biết nguồn hàng và cách bảo hành  "}, headers=admin,
    )
    assert asked.status_code == 200, asked.text
    body = asked.json()
    assert body["status"] == "needs_info"
    assert body["info_request"] == "Cho biết nguồn hàng và cách bảo hành"
    assert body["info_requested_at"] is not None and body["info_responded_at"] is None
    # It cannot be approved while the applicant owes an answer.
    early = await client.post(f"/admin/seller-applications/{app_id}/approve", headers=admin)
    assert early.status_code == 400

    mine = (await client.get("/seller/applications/me", headers=applicant)).json()
    assert mine["status"] == "needs_info" and mine["info_request"].startswith("Cho biết")
    alerts = (await client.get("/me/action-items", headers=applicant)).json()
    assert any(item.get("href") == "/seller/apply" for item in alerts)
    async with SessionLocal() as db:
        mails = (await db.execute(
            select(MailOutbox).where(MailOutbox.template == "seller_application_needs_info")
        )).scalars().all()
    assert len(mails) == 1

    again = await client.post("/seller/apply", json={
        "business_name": "Kho Rõ Ràng",
        "description": "Gmail tự tạo, đổi mới trong 24 giờ",
        "warranty_policy": "Đổi mới 24 giờ",
        "accept_rules": True,
    }, headers=applicant)
    assert again.status_code == 201, again.text
    resubmitted = again.json()
    assert resubmitted["id"] == app_id
    assert resubmitted["status"] == "pending"
    assert resubmitted["business_name"] == "Kho Rõ Ràng"
    assert resubmitted["info_responded_at"] is not None
    alerts = (await client.get("/me/action-items", headers=applicant)).json()
    assert not any(item.get("href") == "/seller/apply" for item in alerts)
    approved = await client.post(f"/admin/seller-applications/{app_id}/approve", headers=admin)
    assert approved.status_code == 200


@pytest.mark.asyncio
async def test_info_request_rules(client):
    admin = await _admin_headers(client, "apply_info_admin2@example.com")
    applicant = {"Authorization": f"Bearer {await register_and_login(client, 'apply_info2@example.com')}"}
    app_id = (await client.post("/seller/apply", json={"business_name": "Shop"}, headers=applicant)).json()["id"]

    assert (await client.post(
        f"/admin/seller-applications/{app_id}/request-info", json={"note": "x"}, headers=applicant,
    )).status_code == 403
    assert (await client.post(
        f"/admin/seller-applications/{app_id}/request-info", json={"note": "   "}, headers=admin,
    )).status_code == 422
    assert (await client.post(
        "/admin/seller-applications/999999/request-info", json={"note": "x"}, headers=admin,
    )).status_code == 404

    await client.post(f"/admin/seller-applications/{app_id}/request-info", json={"note": "Thêm SĐT"}, headers=admin)
    # Asking twice needs a resubmission in between.
    assert (await client.post(
        f"/admin/seller-applications/{app_id}/request-info", json={"note": "Nữa"}, headers=admin,
    )).status_code == 400
    # An applicant who never answers can still be turned down.
    rejected = await client.post(
        f"/admin/seller-applications/{app_id}/reject", json={"reason": "Không phản hồi"}, headers=admin,
    )
    assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"
    alerts = (await client.get("/me/action-items", headers=applicant)).json()
    assert not any(item.get("href") == "/seller/apply" for item in alerts)
