"""Part A của docs/superpowers/specs/2026-07-21-seller-connect-gateway-design.md
— seller tự đăng ký provider của họ (thay vì provider 100% do admin tạo),
admin duyệt, chỉ provider approved mới gắn được vào product, và chỉ gắn được
vào product của CHÍNH seller sở hữu provider đó.
"""
import pytest
from sqlalchemy import update

from src.database import SessionLocal
from src.models.product import Product
from src.models.provider import Provider
from src.providers.schemas import ProviderTestResponse

from tests.conftest import make_admin, make_seller, register_and_login, set_seller_tier


async def _trusted_seller(client, email):
    token = await register_and_login(client, email)
    await make_seller(email)
    await set_seller_tier(email, "trusted")
    return await register_and_login(client, email)


async def _admin(client, email):
    token = await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


async def _mark_pending(provider_id: int) -> None:
    async with SessionLocal() as db:
        await db.execute(
            update(Provider).where(Provider.id == provider_id).values(review_status="pending_review")
        )
        await db.commit()


async def _product_for_seller(client, admin_token, seller_token, suffix):
    await client.post("/admin/categories", json={"name": f"SS{suffix}", "slug": f"ss{suffix}"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]
    resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": f"Product {suffix}", "status": "active", "escrow_days": 2,
        "service_type": "endpoint",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestSellerProviderCreation:
    @pytest.mark.asyncio
    async def test_requires_trusted_tier(self, client):
        seller_token = await register_and_login(client, "ss_newbie@example.com")
        await make_seller("ss_newbie@example.com")
        seller_token = await register_and_login(client, "ss_newbie@example.com")

        resp = await client.post("/seller/providers", json={
            "name": "My Backend", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://x.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_starts_as_draft(self, client):
        seller_token = await _trusted_seller(client, "ss_a1@example.com")
        resp = await client.post("/seller/providers", json={
            "name": "My Backend", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://x.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["review_status"] == "draft"
        assert body["seller_id"] is not None

    @pytest.mark.asyncio
    async def test_requires_successful_test_before_review_submission(self, client, monkeypatch):
        seller_token = await _trusted_seller(client, "ss_workflow@example.com")
        created = await client.post("/seller/providers", json={
            "name": "Workflow API", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://x.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        provider_id = created.json()["id"]

        too_early = await client.post(
            f"/seller/providers/{provider_id}/submit",
            headers={"Authorization": f"Bearer {seller_token}"},
        )
        assert too_early.status_code == 409

        async def failing_test(_provider_id, _db):
            return ProviderTestResponse(
                health={"status": "unhealthy", "message": "HTTP 401"},
                provision_test=None,
            )

        monkeypatch.setattr("src.providers.router._run_provider_test", failing_test)
        failed = await client.post(
            f"/seller/providers/{provider_id}/test",
            headers={"Authorization": f"Bearer {seller_token}"},
        )
        assert failed.status_code == 200
        failed_detail = await client.get(
            f"/seller/providers/{provider_id}",
            headers={"Authorization": f"Bearer {seller_token}"},
        )
        assert failed_detail.json()["review_status"] == "test_failed"
        assert failed_detail.json()["last_test_result"]["passed"] is False

        async def passing_test(_provider_id, _db):
            return ProviderTestResponse(
                health={"status": "healthy"},
                provision_test={"success": True},
            )

        monkeypatch.setattr("src.providers.router._run_provider_test", passing_test)
        tested = await client.post(
            f"/seller/providers/{provider_id}/test",
            headers={"Authorization": f"Bearer {seller_token}"},
        )
        assert tested.status_code == 200
        detail = await client.get(
            f"/seller/providers/{provider_id}",
            headers={"Authorization": f"Bearer {seller_token}"},
        )
        assert detail.json()["review_status"] == "tested"
        assert detail.json()["last_test_result"]["passed"] is True

        submitted = await client.post(
            f"/seller/providers/{provider_id}/submit",
            headers={"Authorization": f"Bearer {seller_token}"},
        )
        assert submitted.status_code == 200
        assert submitted.json()["review_status"] == "pending_review"

    @pytest.mark.asyncio
    async def test_rejects_disallowed_adapter_types(self, client):
        seller_token = await _trusted_seller(client, "ss_a2@example.com")
        for bad_type in ("mock", "seller_pool", "manual", "topproxy", "scrapecreators"):
            resp = await client.post("/seller/providers", json={
                "name": "x", "adapter_type": bad_type, "config": {},
            }, headers={"Authorization": f"Bearer {seller_token}"})
            assert resp.status_code == 400, f"{bad_type} should be rejected"

    @pytest.mark.asyncio
    async def test_seller_task_webhook_still_requires_webhook_secret(self, client):
        seller_token = await _trusted_seller(client, "ss_a3@example.com")
        resp = await client.post("/seller/providers", json={
            "name": "x", "adapter_type": "seller_task_webhook",
            "config": {"base_url": "https://x.example.com"},  # no webhook_secret
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert resp.status_code == 400


class TestSellerProviderOwnershipIsolation:
    @pytest.mark.asyncio
    async def test_seller_b_cannot_see_or_edit_seller_a_provider(self, client):
        seller_a = await _trusted_seller(client, "ss_ownA@example.com")
        seller_b = await _trusted_seller(client, "ss_ownB@example.com")

        create_resp = await client.post("/seller/providers", json={
            "name": "A's backend", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://a.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_a}"})
        provider_id = create_resp.json()["id"]

        get_resp = await client.get(f"/seller/providers/{provider_id}", headers={"Authorization": f"Bearer {seller_b}"})
        assert get_resp.status_code == 403  # NotOwner

        put_resp = await client.put(f"/seller/providers/{provider_id}", json={
            "config": {"base_url": "https://hijacked.example.com"},
        }, headers={"Authorization": f"Bearer {seller_b}"})
        assert put_resp.status_code == 403

        test_resp = await client.post(f"/seller/providers/{provider_id}/test", headers={"Authorization": f"Bearer {seller_b}"})
        assert test_resp.status_code == 403

        list_resp = await client.get("/seller/providers", headers={"Authorization": f"Bearer {seller_b}"})
        assert list_resp.json() == []


class TestApprovalGatesProductAttachment:
    @pytest.mark.asyncio
    async def test_seller_cannot_attach_unapproved_provider(self, client):
        admin_token = await _admin(client, "ss_gate_admin1@example.com")
        seller_token = await _trusted_seller(client, "ss_gate_s1@example.com")
        product_id = await _product_for_seller(client, admin_token, seller_token, "g1")

        provider_resp = await client.post("/seller/providers", json={
            "name": "Not yet approved", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://x.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        provider_id = provider_resp.json()["id"]

        resp = await client.put(f"/seller/products/{product_id}/pricing", json={
            "pricing_strategy": "credit", "pricing_params": {"credit_price": 100},
            "provider_id": provider_id,
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert resp.status_code == 400
        assert "duyệt" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_seller_can_attach_own_provider_once_approved(self, client):
        admin_token = await _admin(client, "ss_gate_admin2@example.com")
        seller_token = await _trusted_seller(client, "ss_gate_s2@example.com")
        product_id = await _product_for_seller(client, admin_token, seller_token, "g2")

        provider_resp = await client.post("/seller/providers", json={
            "name": "Will be approved", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://x.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        provider_id = provider_resp.json()["id"]
        await _mark_pending(provider_id)

        approve_resp = await client.post(f"/admin/providers/{provider_id}/approve", json={
            "note": "looks fine",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        assert approve_resp.status_code == 200
        assert approve_resp.json()["review_status"] == "approved"

        resp = await client.put(f"/seller/products/{product_id}/pricing", json={
            "pricing_strategy": "credit", "pricing_params": {"credit_price": 100},
            "provider_id": provider_id,
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert resp.status_code == 200, resp.text

        async with SessionLocal() as db:
            product = await db.get(Product, product_id)
            assert product.provider_id == provider_id

    @pytest.mark.asyncio
    async def test_seller_cannot_attach_another_sellers_provider(self, client):
        admin_token = await _admin(client, "ss_gate_admin3@example.com")
        seller_a = await _trusted_seller(client, "ss_gate_s3a@example.com")
        seller_b = await _trusted_seller(client, "ss_gate_s3b@example.com")
        product_b = await _product_for_seller(client, admin_token, seller_b, "g3b")

        provider_resp = await client.post("/seller/providers", json={
            "name": "A's backend", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://a.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_a}"})
        provider_id = provider_resp.json()["id"]
        await _mark_pending(provider_id)
        await client.post(f"/admin/providers/{provider_id}/approve", json={},
                          headers={"Authorization": f"Bearer {admin_token}"})

        resp = await client.put(f"/seller/products/{product_b}/pricing", json={
            "pricing_strategy": "credit", "pricing_params": {"credit_price": 100},
            "provider_id": provider_id,
        }, headers={"Authorization": f"Bearer {seller_b}"})
        assert resp.status_code == 400
        assert "seller khác" in resp.json()["detail"] or "chính mình" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_admin_cannot_attach_seller_owned_provider_to_a_different_sellers_product(self, client):
        """Even admin, who CAN attach any provider via the operations endpoint,
        must not be able to point seller A's private backend at seller B's
        product — that constraint exists regardless of who is doing the
        attaching."""
        admin_token = await _admin(client, "ss_gate_admin4@example.com")
        seller_a = await _trusted_seller(client, "ss_gate_s4a@example.com")
        seller_b = await _trusted_seller(client, "ss_gate_s4b@example.com")
        product_b = await _product_for_seller(client, admin_token, seller_b, "g4b")

        provider_resp = await client.post("/seller/providers", json={
            "name": "A's backend", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://a.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_a}"})
        provider_id = provider_resp.json()["id"]
        await _mark_pending(provider_id)
        await client.post(f"/admin/providers/{provider_id}/approve", json={},
                          headers={"Authorization": f"Bearer {admin_token}"})

        resp = await client.put(f"/admin/products/{product_b}/operations", json={
            "provider_id": provider_id, "pricing_strategy": "credit",
            "pricing_params": {"credit_price": 100},
        }, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_editing_config_after_approval_is_blocked(self, client):
        admin_token = await _admin(client, "ss_gate_admin5@example.com")
        seller_token = await _trusted_seller(client, "ss_gate_s5@example.com")

        provider_resp = await client.post("/seller/providers", json={
            "name": "x", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://x.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        provider_id = provider_resp.json()["id"]
        await _mark_pending(provider_id)
        await client.post(f"/admin/providers/{provider_id}/approve", json={},
                          headers={"Authorization": f"Bearer {admin_token}"})

        update_resp = await client.put(f"/seller/providers/{provider_id}", json={
            "config": {"base_url": "https://x.example.com", "api_key": "rotated-key"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert update_resp.status_code == 409
        assert "tạo tích hợp mới" in update_resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_admin_reject_records_note(self, client):
        admin_token = await _admin(client, "ss_gate_admin6@example.com")
        seller_token = await _trusted_seller(client, "ss_gate_s6@example.com")

        provider_resp = await client.post("/seller/providers", json={
            "name": "x", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://x.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        provider_id = provider_resp.json()["id"]
        await _mark_pending(provider_id)

        reject_resp = await client.post(f"/admin/providers/{provider_id}/reject", json={
            "note": "base_url không phản hồi",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        assert reject_resp.status_code == 200
        assert reject_resp.json()["review_status"] == "rejected"
        assert reject_resp.json()["review_note"] == "base_url không phản hồi"

    @pytest.mark.asyncio
    async def test_admin_reject_requires_an_actionable_note(self, client):
        admin_token = await _admin(client, "ss_gate_admin_note@example.com")
        seller_token = await _trusted_seller(client, "ss_gate_s_note@example.com")

        provider_resp = await client.post("/seller/providers", json={
            "name": "x", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://x.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        await _mark_pending(provider_resp.json()["id"])

        reject_resp = await client.post(
            f"/admin/providers/{provider_resp.json()['id']}/reject", json={},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert reject_resp.status_code == 400
        assert "phải kèm lý do" in reject_resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_review_endpoint_rejects_admin_owned_providers(self, client):
        """approve/reject only makes sense for a seller-submitted provider —
        an admin-created one was never pending anything."""
        admin_token = await _admin(client, "ss_gate_admin7@example.com")
        provider_resp = await client.post("/admin/providers", json={
            "name": "Admin infra", "type": "endpoint", "config": {}, "priority": 1, "adapter_type": "mock",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        provider_id = provider_resp.json()["id"]

        resp = await client.post(f"/admin/providers/{provider_id}/approve", json={},
                                 headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 400


class TestSellerBaseUrlSSRFGuard:
    """A seller's config.base_url is untrusted input the platform's own
    server calls with a Bearer api_key attached (src/adapters/real_api.py) —
    both at self-test time (before any admin has reviewed the provider) and
    on every buyer gateway call afterwards. Must not be usable to make the
    platform hit its own internal network. See src/security/ssrf_guard.py."""

    @pytest.mark.asyncio
    async def test_rejects_non_https_scheme(self, client):
        seller_token = await _trusted_seller(client, "ss_ssrf_scheme@example.com")
        resp = await client.post("/seller/providers", json={
            "name": "x", "adapter_type": "seller_gateway",
            "config": {"base_url": "http://x.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_development_allows_localhost_mock_seller(self, client, monkeypatch):
        from src.config import settings
        monkeypatch.setattr(settings, "deployment_environment", "development")
        seller_token = await _trusted_seller(client, "ss_ssrf_local_dev@example.com")
        resp = await client.post("/seller/providers", json={
            "name": "Local mock", "adapter_type": "seller_gateway",
            "config": {"base_url": "http://localhost:9100", "api_key": "mock-seller-secret"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert resp.status_code == 201, resp.text
        assert resp.json()["review_status"] == "draft"

    @pytest.mark.asyncio
    async def test_rejects_loopback_literal_ip_on_create(self, client):
        seller_token = await _trusted_seller(client, "ss_ssrf_loopback@example.com")
        resp = await client.post("/seller/providers", json={
            "name": "x", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://127.0.0.1:8080", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_cloud_metadata_literal_ip_on_create(self, client):
        seller_token = await _trusted_seller(client, "ss_ssrf_metadata@example.com")
        resp = await client.post("/seller/providers", json={
            "name": "x", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://169.254.169.254", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_private_ip_on_update(self, client):
        seller_token = await _trusted_seller(client, "ss_ssrf_update@example.com")

        provider_resp = await client.post("/seller/providers", json={
            "name": "x", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://x.example.com", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        provider_id = provider_resp.json()["id"]

        resp = await client.put(f"/seller/providers/{provider_id}", json={
            "config": {"base_url": "https://10.0.0.5", "api_key": "k"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert resp.status_code == 400

        async with SessionLocal() as db:
            provider = await db.get(Provider, provider_id)
            # rejected update must not have partially applied
            assert provider.review_status == "draft"

    @pytest.mark.asyncio
    async def test_admin_created_provider_may_target_localhost_for_local_dev(self, client):
        """Admin-created providers (seller_id is None) are trusted input —
        this is the documented workflow for scripts/mock_seller.py during
        local dev/QA and must keep working."""
        admin_token = await _admin(client, "ss_ssrf_admin_localhost@example.com")
        resp = await client.post("/admin/providers", json={
            "name": "Local mock seller", "type": "seller_gateway",
            "adapter_type": "seller_gateway",
            "config": {"base_url": "http://localhost:9100", "api_key": "mock-seller-secret"},
            "priority": 1,
        }, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 201, resp.text
