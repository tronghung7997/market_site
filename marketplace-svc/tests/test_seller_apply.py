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
    body = resp.json()
    assert isinstance(body["items"], list) and body["counts"]["pending"] == 0


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
    app_id = apps.json()["items"][-1]["id"]

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
    listed = next(a for a in (await client.get("/admin/seller-applications", headers=admin)).json()["items"] if a["id"] == body["id"])
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


# ── Review queue (admin accounts review) ─────────────────────────────────────

async def _apply(client, email, **extra):
    headers = {"Authorization": f"Bearer {await register_and_login(client, email)}"}
    resp = await client.post("/seller/apply", json={"business_name": extra.pop("name", "Shop " + email), **extra}, headers=headers)
    assert resp.status_code == 201, resp.text
    return headers, resp.json()["id"]


@pytest.mark.asyncio
async def test_review_queue_lists_counts_search_and_sorts_oldest_first(client):
    admin = await _admin_headers(client, "queue_admin@example.com")
    _, first = await _apply(client, "queue_a@example.com", name="Alpha Proxy", phone="0912 000 111")
    _, second = await _apply(client, "queue_b@example.com", name="Beta Mail")
    page = (await client.get("/admin/seller-applications", headers=admin)).json()
    assert [r["id"] for r in page["items"]] == [first, second]
    assert page["total"] == 2 and page["counts"] == {"pending": 2, "needs_info": 0, "approved": 0, "rejected": 0}
    row = page["items"][0]
    assert row["applicant"]["email"] == "queue_a@example.com"
    assert row["resubmitted"] is False and row["prior_rejections"] == 0
    assert row["risk_count"] == (0 if row["applicant"]["email_verified"] else 1)
    assert page["avg_review_hours"] is None

    for term, expected in (("alpha", [first]), ("queue_b@", [second]), ("0912", [first]), ("nothing", [])):
        res = (await client.get("/admin/seller-applications", params={"search": term}, headers=admin)).json()
        assert [r["id"] for r in res["items"]] == expected, term
    assert (await client.get("/admin/seller-applications", params={"status": "bogus"}, headers=admin)).status_code == 422

    await client.post(f"/admin/seller-applications/{first}/approve", headers=admin)
    approved = (await client.get("/admin/seller-applications", params={"status": "approved"}, headers=admin)).json()
    assert approved["items"][0]["reviewed_by_email"] == "queue_admin@example.com"
    assert approved["items"][0]["reviewed_at"] is not None
    assert approved["avg_review_hours"] is not None


@pytest.mark.asyncio
async def test_reject_requires_reason_and_sets_cooldown(client):
    from datetime import datetime, timezone

    from sqlalchemy import select

    from src.database import SessionLocal
    from src.models.mail import MailOutbox

    admin = await _admin_headers(client, "cool_admin@example.com")
    applicant, app_id = await _apply(client, "cool@example.com")
    for bad in ({}, {"reason": ""}, {"reason": "  a "}, {"reason": "Lý do hợp lệ", "resubmit_after_days": 91}):
        assert (await client.post(f"/admin/seller-applications/{app_id}/reject", json=bad, headers=admin)).status_code == 422
    assert (await client.post(
        f"/admin/seller-applications/{app_id}/reject", json={"reason": "Spam"}, headers=applicant,
    )).status_code == 403

    res = await client.post(
        f"/admin/seller-applications/{app_id}/reject", json={"reason": "Thiếu giấy tờ", "resubmit_after_days": 7}, headers=admin,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "rejected" and body["reviewed_by_email"] == "cool_admin@example.com"
    until = datetime.fromisoformat(body["resubmit_after"])
    assert 6 <= (until - datetime.now(timezone.utc)).days <= 7

    # A second decision (approve after reject) is refused.
    assert (await client.post(f"/admin/seller-applications/{app_id}/approve", headers=admin)).status_code == 400
    again = await client.post("/seller/apply", json={"business_name": "Retry"}, headers=applicant)
    assert again.status_code == 400 and "nộp lại" in again.json()["detail"]
    mine = (await client.get("/seller/applications/me", headers=applicant)).json()
    assert mine["resubmit_after"] is not None
    async with SessionLocal() as db:
        mail = (await db.execute(select(MailOutbox).where(MailOutbox.template == "seller_application_rejected"))).scalar_one()
    assert "Thiếu giấy tờ" in mail.payload["reason"] and "nộp lại" in mail.payload["reason"]
    assert mail.payload["resubmit_after"]


@pytest.mark.asyncio
async def test_reject_without_cooldown_allows_immediate_reapply_and_counts_prior(client):
    admin = await _admin_headers(client, "prior_admin@example.com")
    applicant, app_id = await _apply(client, "prior@example.com")
    assert (await client.post(
        f"/admin/seller-applications/{app_id}/reject", json={"reason": "Chưa rõ"}, headers=admin,
    )).status_code == 200
    second = await client.post("/seller/apply", json={"business_name": "Again"}, headers=applicant)
    assert second.status_code == 201
    detail = (await client.get(f"/admin/seller-applications/{second.json()['id']}", headers=admin)).json()
    assert detail["prior_rejections"] == 1 and detail["risk_count"] >= 1
    assert detail["prior_applications"][0]["reject_reason"] == "Chưa rõ"


@pytest.mark.asyncio
async def test_request_info_fields_snapshot_history_and_notes(client):
    admin = await _admin_headers(client, "detail_admin@example.com")
    applicant, app_id = await _apply(client, "detail@example.com", name="Old Name", description="old bio")
    bad = await client.post(
        f"/admin/seller-applications/{app_id}/request-info", json={"note": "x", "fields": ["password"]}, headers=admin,
    )
    assert bad.status_code == 422
    asked = await client.post(
        f"/admin/seller-applications/{app_id}/request-info",
        json={"note": "Bổ sung chính sách", "fields": ["warranty_policy", "description"]}, headers=admin,
    )
    assert asked.status_code == 200 and asked.json()["info_fields"] == ["warranty_policy", "description"]
    mine = (await client.get("/seller/applications/me", headers=applicant)).json()
    assert mine["info_fields"] == ["warranty_policy", "description"]

    await client.post("/seller/apply", json={"business_name": "New Name", "description": "new bio"}, headers=applicant)
    detail = (await client.get(f"/admin/seller-applications/{app_id}", headers=admin)).json()
    assert detail["resubmitted"] is True
    assert detail["previous_snapshot"]["business_name"] == "Old Name"
    assert detail["previous_snapshot"]["description"] == "old bio"
    kinds = [h["kind"] for h in detail["history"]]
    assert kinds == ["submitted", "info_requested", "resubmitted"]
    assert detail["history"][1]["actor_email"] == "detail_admin@example.com"
    assert detail["history"][1]["text"] == "Bổ sung chính sách"
    assert set(detail["risk"]) >= {"email_verified", "totp_enabled", "account_age_days", "orders_bought", "spent",
                                  "disputes_opened", "same_phone_accounts", "shared_ip_locked_accounts"}

    assert (await client.post(f"/admin/seller-applications/{app_id}/notes", json={"body": "  "}, headers=admin)).status_code == 422
    assert (await client.post(f"/admin/seller-applications/{app_id}/notes", json={"body": "x"}, headers=applicant)).status_code == 403
    assert (await client.post("/admin/seller-applications/999999/notes", json={"body": "x"}, headers=admin)).status_code == 404
    note = await client.post(f"/admin/seller-applications/{app_id}/notes", json={"body": "Gọi xác minh"}, headers=admin)
    assert note.status_code == 201 and note.json()["author_email"] == "detail_admin@example.com"
    notes = (await client.get(f"/admin/seller-applications/{app_id}/notes", headers=admin)).json()
    assert [n["body"] for n in notes] == ["Gọi xác minh"]
    assert (await client.get(f"/admin/seller-applications/{app_id}", headers=admin)).json()["notes"][0]["body"] == "Gọi xác minh"
    assert (await client.get(f"/admin/seller-applications/{app_id}", headers=applicant)).status_code == 403
    assert (await client.get("/admin/seller-applications/999999", headers=admin)).status_code == 404


@pytest.mark.asyncio
async def test_applicant_risk_shared_phone_and_locked_ip(client):
    from src.database import SessionLocal
    from src.models.account import Account
    from src.models.login_event import LoginEvent
    from sqlalchemy import select

    admin = await _admin_headers(client, "risk_admin@example.com")
    await _apply(client, "risk_other@example.com", phone="+84 900 111 222")
    _, app_id = await _apply(client, "risk_me@example.com", phone="0900.111.222")
    await register_and_login(client, "risk_locked@example.com")
    async with SessionLocal() as db:
        me = await db.scalar(select(Account).where(Account.email == "risk_me@example.com"))
        locked = await db.scalar(select(Account).where(Account.email == "risk_locked@example.com"))
        locked.is_active = False
        db.add(LoginEvent(account_id=me.id, kind="login", outcome="success", ip="203.0.113.9"))
        db.add(LoginEvent(account_id=locked.id, kind="login", outcome="success", ip="203.0.113.9"))
        await db.commit()
    detail = (await client.get(f"/admin/seller-applications/{app_id}", headers=admin)).json()
    assert [a["email"] for a in detail["risk"]["same_phone_accounts"]] == ["risk_other@example.com"]
    assert "risk_locked@example.com" in [a["email"] for a in detail["risk"]["shared_ip_locked_accounts"]]
    assert detail["risk_count"] >= 2


@pytest.mark.asyncio
async def test_concurrent_approve_and_reject_only_one_wins(client):
    import asyncio

    admin = await _admin_headers(client, "race_admin@example.com")
    _, app_id = await _apply(client, "race@example.com")
    results = await asyncio.gather(
        client.post(f"/admin/seller-applications/{app_id}/approve", headers=admin),
        client.post(f"/admin/seller-applications/{app_id}/reject", json={"reason": "Trùng lặp"}, headers=admin),
    )
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 400], [r.text for r in results]
    loser = next(r for r in results if r.status_code == 400)
    assert loser.json()["detail"] == "Đơn đăng ký đã được xử lý"
