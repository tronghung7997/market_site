"""Two-step approval (maker-checker) for admin settings (src/config_approval).

The suite runs with CONFIG_APPROVAL_REQUIRED=false (conftest); every test here
turns it on, except the one that checks the single-admin escape hatch.
"""
import io
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image
from sqlalchemy import select, update

from src.config import settings
from src.database import SessionLocal
from src.models.alert import Alert
from src.models.config_change_request import ConfigChangeRequest
from src.models.fee_runtime_config import FeeRuntimeConfig
from src.models.log_entry import LogEntry
from tests.conftest import make_admin, make_seller, register_and_login


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def approval_on(monkeypatch):
    monkeypatch.setattr(settings, "config_approval_required", True)


async def _admin(client, email: str) -> str:
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


async def _two_admins(client) -> tuple[str, str]:
    return await _admin(client, "maker@example.com"), await _admin(client, "checker@example.com")


async def _events(name: str) -> list[LogEntry]:
    async with SessionLocal() as db:
        return list((await db.execute(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == name).order_by(LogEntry.id)
        )).scalars())


async def _request_row(request_id: int) -> ConfigChangeRequest:
    async with SessionLocal() as db:
        row = await db.get(ConfigChangeRequest, request_id)
        assert row is not None
        return row


async def _account_id(client, token: str) -> int:
    return (await client.get("/me", headers=_auth(token))).json()["id"]


@pytest.mark.asyncio
async def test_maker_request_waits_and_a_second_admin_applies_it(client, approval_on):
    maker, checker = await _two_admins(client)
    maker_id, checker_id = await _account_id(client, maker), await _account_id(client, checker)

    resp = await client.patch("/admin/fee-config", json={
        "platform_fee_percent": 12.5, "withdraw_min_amount": 50_000, "change_reason": "Điều chỉnh phí quý 4",
    }, headers=_auth(maker))
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "pending_approval" and body["applied_fields"] == []
    req = body["request"]
    assert req["section"] == "fee_config" and req["status"] == "pending" and req["reason"] == "Điều chỉnh phí quý 4"
    assert req["diff"] == {"platform_fee_percent": [0.0, 12.5], "withdraw_min_amount": [0, 50_000]}
    assert req["settings_event"] == "fee_runtime_config_changed"
    assert req["can_cancel"] and not req["can_approve"] and req["requested_by"]["id"] == maker_id
    # Nothing applied yet, for anyone.
    assert body["config"]["platform_fee_percent"] == 0
    assert (await client.get("/admin/fee-config", headers=_auth(checker))).json()["platform_fee_percent"] == 0
    assert (await client.get("/public/fee-config")).json()["platform_fee_percent"] == 0
    assert await _events("fee_runtime_config_changed") == []
    requested = await _events("config_change_requested")
    assert len(requested) == 1 and requested[0].metadata_["actor_id"] == maker_id
    assert requested[0].metadata_["changed"]["platform_fee_percent"] == [0.0, 12.5]

    # The other admins are told: bell alert + work queue.
    async with SessionLocal() as db:
        alert = (await db.execute(select(Alert).where(Alert.type == "config_change_pending"))).scalar_one()
    assert alert.is_active and alert.target_id == req["id"]
    items = (await client.get("/admin/action-items", headers=_auth(checker))).json()
    queue = next(i for i in items if i["key"] == "admin_config_changes_pending")
    assert queue["count"] == 1 and queue["href"] == "/admin/config-changes"
    listed = (await client.get("/admin/config-changes", headers=_auth(checker))).json()
    assert listed["pending_count"] == 1 and listed["approval_required"] is True
    assert listed["items"][0]["can_approve"] and not listed["items"][0]["can_cancel"]

    # No self-approval.
    own = await client.post(f"/admin/config-changes/{req['id']}/approve", json={}, headers=_auth(maker))
    assert own.status_code == 403 and own.json()["error_code"] == "CONFIG_CHANGE_SELF_APPROVAL"
    assert (await client.get("/admin/fee-config", headers=_auth(maker))).json()["platform_fee_percent"] == 0

    ok = await client.post(f"/admin/config-changes/{req['id']}/approve", json={"note": "OK"}, headers=_auth(checker))
    assert ok.status_code == 200, ok.text
    decided = ok.json()
    assert decided["status"] == "approved" and decided["decided_by"]["id"] == checker_id and decided["decision_note"] == "OK"
    cfg = (await client.get("/admin/fee-config", headers=_auth(maker))).json()
    assert cfg["platform_fee_percent"] == 12.5 and cfg["withdraw_min_amount"] == 50_000 and cfg["updated_by_id"] == checker_id

    # Audited twice: the section's own old → new row (actor = approver) and the decision.
    changed = await _events("fee_runtime_config_changed")
    assert len(changed) == 1 and changed[0].metadata_["actor_id"] == checker_id
    assert changed[0].metadata_["changed"]["platform_fee_percent"] == [0.0, 12.5]
    approved = await _events("config_change_approved")
    assert len(approved) == 1
    assert approved[0].metadata_["actor_id"] == checker_id and approved[0].metadata_["requested_by_id"] == maker_id
    async with SessionLocal() as db:
        alert = await db.get(Alert, alert.id)
    assert not alert.is_active and alert.admin_resolved_by_id == checker_id
    items = (await client.get("/admin/action-items", headers=_auth(checker))).json()
    assert not any(i["key"] == "admin_config_changes_pending" for i in items)

    again = await client.post(f"/admin/config-changes/{req['id']}/approve", json={}, headers=_auth(checker))
    assert again.status_code == 409 and again.json()["error_code"] == "CONFIG_CHANGE_NOT_PENDING"


@pytest.mark.asyncio
async def test_request_is_validated_up_front_and_needs_a_reason(client, approval_on):
    maker, _ = await _two_admins(client)
    reason = {"change_reason": "test"}
    # Schema bounds, service-level checks (map keys, platform account) — 422, nothing queued.
    for body in (
        {"platform_fee_percent": 101},
        {"category_fee_percent": {"abc": 5}},
        {"platform_account_id": 999_999},
    ):
        resp = await client.patch("/admin/fee-config", json={**body, **reason}, headers=_auth(maker))
        assert resp.status_code == 422, (body, resp.text)
    bad_rails = await client.patch(
        "/admin/deposit-rail-config", json={"deposit_min_amount": 5, **reason}, headers=_auth(maker),
    )
    assert bad_rails.status_code == 422
    bad_site = await client.patch("/admin/site-status", json={"media_max_upload_mb": 0, **reason}, headers=_auth(maker))
    assert bad_site.status_code == 422

    no_reason = await client.patch("/admin/fee-config", json={"platform_fee_percent": 3}, headers=_auth(maker))
    assert no_reason.status_code == 422 and no_reason.json()["error_code"] == "CONFIG_CHANGE_REASON_REQUIRED"
    async with SessionLocal() as db:
        assert (await db.execute(select(ConfigChangeRequest))).first() is None
        row = await db.get(FeeRuntimeConfig, 1)
        assert row is None or float(row.platform_fee_percent) == 0

    # Saving the values already in force creates nothing and answers like before.
    same = await client.patch("/admin/fee-config", json={"platform_fee_percent": 0}, headers=_auth(maker))
    assert same.status_code == 200 and same.json()["platform_fee_percent"] == 0


@pytest.mark.asyncio
async def test_non_admins_cannot_request_or_decide(client, approval_on):
    maker, _ = await _two_admins(client)
    user = await register_and_login(client, "plain@example.com")
    assert (await client.patch(
        "/admin/fee-config", json={"platform_fee_percent": 1, "change_reason": "xyz"}, headers=_auth(user),
    )).status_code == 403
    req = (await client.patch(
        "/admin/affiliate-config", json={"commission_percent_of_fee": 9, "change_reason": "KOL push"}, headers=_auth(maker),
    )).json()["request"]
    assert (await client.get("/admin/config-changes", headers=_auth(user))).status_code == 403
    for action in ("approve", "reject", "cancel"):
        resp = await client.post(f"/admin/config-changes/{req['id']}/{action}", json={"note": "nope"}, headers=_auth(user))
        assert resp.status_code == 403, action
    assert (await client.post("/admin/config-changes/1/approve", json={})).status_code == 401
    assert (await _request_row(req["id"])).status == "pending"


@pytest.mark.asyncio
async def test_one_pending_request_per_section(client, approval_on):
    maker, checker = await _two_admins(client)
    first = await client.patch(
        "/admin/affiliate-config", json={"commission_percent_of_fee": 9, "change_reason": "first"}, headers=_auth(maker),
    )
    assert first.status_code == 202
    second = await client.patch(
        "/admin/affiliate-config", json={"attribution_days": 60, "change_reason": "second"}, headers=_auth(checker),
    )
    assert second.status_code == 409 and second.json()["error_code"] == "CONFIG_CHANGE_PENDING"
    # Another section is independent.
    other = await client.patch(
        "/admin/seller-config", json={"low_stock_threshold": 5, "change_reason": "low stock"}, headers=_auth(checker),
    )
    assert other.status_code == 202


@pytest.mark.asyncio
async def test_stale_request_is_refused_and_superseded(client, approval_on):
    maker, checker = await _two_admins(client)
    req = (await client.patch(
        "/admin/fee-config", json={"platform_fee_percent": 7, "change_reason": "raise fee"}, headers=_auth(maker),
    )).json()["request"]
    # The section changes by another path after the request was made.
    async with SessionLocal() as db:
        await db.execute(update(FeeRuntimeConfig).where(FeeRuntimeConfig.id == 1).values(withdraw_fee_fixed=1_000))
        await db.commit()
    resp = await client.post(f"/admin/config-changes/{req['id']}/approve", json={}, headers=_auth(checker))
    assert resp.status_code == 409 and resp.json()["error_code"] == "CONFIG_CHANGE_STALE"
    row = await _request_row(req["id"])
    assert row.status == "superseded"
    async with SessionLocal() as db:
        fee = await db.get(FeeRuntimeConfig, 1)
    assert float(fee.platform_fee_percent) == 0 and fee.withdraw_fee_fixed == 1_000
    superseded = await _events("config_change_superseded")
    assert superseded[0].metadata_["changed_since_request"] == {"withdraw_fee_fixed": [0, 1_000]}
    # The section is free for a fresh request.
    again = await client.patch(
        "/admin/fee-config", json={"platform_fee_percent": 7, "change_reason": "raise fee"}, headers=_auth(maker),
    )
    assert again.status_code == 202


@pytest.mark.asyncio
async def test_reject_and_cancel(client, approval_on):
    maker, checker = await _two_admins(client)
    req = (await client.patch(
        "/admin/seller-config", json={"low_stock_threshold": 5, "change_reason": "fewer alerts"}, headers=_auth(maker),
    )).json()["request"]
    no_note = await client.post(f"/admin/config-changes/{req['id']}/reject", json={}, headers=_auth(checker))
    assert no_note.status_code == 422 and no_note.json()["error_code"] == "CONFIG_CHANGE_NOTE_REQUIRED"
    own = await client.post(f"/admin/config-changes/{req['id']}/reject", json={"note": "meh"}, headers=_auth(maker))
    assert own.status_code == 403
    rejected = await client.post(f"/admin/config-changes/{req['id']}/reject", json={"note": "Too low"}, headers=_auth(checker))
    assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"
    assert (await client.get("/admin/seller-config", headers=_auth(maker))).json()["low_stock_threshold"] == 20
    assert len(await _events("config_change_rejected")) == 1

    req = (await client.patch(
        "/admin/seller-config", json={"low_stock_threshold": 8, "change_reason": "try again"}, headers=_auth(maker),
    )).json()["request"]
    not_mine = await client.post(f"/admin/config-changes/{req['id']}/cancel", json={}, headers=_auth(checker))
    assert not_mine.status_code == 403 and not_mine.json()["error_code"] == "CONFIG_CHANGE_NOT_REQUESTER"
    cancelled = await client.post(f"/admin/config-changes/{req['id']}/cancel", json={}, headers=_auth(maker))
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    late = await client.post(f"/admin/config-changes/{req['id']}/approve", json={}, headers=_auth(checker))
    assert late.status_code == 409 and late.json()["error_code"] == "CONFIG_CHANGE_NOT_PENDING"
    assert (await client.get("/admin/seller-config", headers=_auth(maker))).json()["low_stock_threshold"] == 20
    history = (await client.get("/admin/config-changes?state=history", headers=_auth(maker))).json()
    assert [i["status"] for i in history["items"]] == ["cancelled", "rejected"]
    async with SessionLocal() as db:
        open_alerts = (await db.execute(select(Alert).where(Alert.type == "config_change_pending", Alert.is_active.is_(True)))).all()
    assert open_alerts == []


@pytest.mark.asyncio
async def test_emergency_switches_apply_at_once_and_mixed_saves_split(client, approval_on):
    maker, checker = await _two_admins(client)
    maker_id = await _account_id(client, maker)
    # Maintenance flipped from the full settings form (every other field sent
    # unchanged, blank texts included): immediate, no reason needed, flagged.
    resp = await client.patch("/admin/site-status", json={
        "maintenance_enabled": True, "announcement_enabled": False, "announcement_level": "info",
        "announcement_text_vi": "", "announcement_text_en": "", "announcement_link_url": "",
        "clear_announcement_window": True, "media_max_upload_mb": 10,
    }, headers=_auth(maker))
    assert resp.status_code == 200 and resp.json()["maintenance_enabled"] is True
    flagged = await _events("config_change_applied_immediately")
    assert flagged[0].level == "warning" and flagged[0].metadata_["emergency"] is True
    assert flagged[0].metadata_["fields"] == ["maintenance_enabled"] and flagged[0].metadata_["actor_id"] == maker_id
    assert len(await _events("site_runtime_config_changed")) == 1

    # Freeze + announcement in one save: the freeze applies, the banner waits.
    mixed = await client.patch("/admin/site-status", json={
        "orders_frozen": True, "freeze_reason": "incident",
        "announcement_enabled": True, "announcement_text_vi": "Bảo trì lúc 22h", "change_reason": "Báo khách",
    }, headers=_auth(maker))
    assert mixed.status_code == 202, mixed.text
    body = mixed.json()
    assert body["applied_fields"] == ["freeze_reason", "orders_frozen"]
    assert body["config"]["orders_frozen"] is True and body["config"]["announcement_enabled"] is False
    assert body["request"]["diff"] == {
        "announcement_enabled": [False, True], "announcement_text_vi": [None, "Bảo trì lúc 22h"],
    }
    public = (await client.get("/public/site-status")).json()
    assert public["orders_frozen"] is True and public["announcement"] is None

    # Emergency switches keep working while the banner request is pending and
    # do not make it stale.
    assert (await client.patch("/admin/site-status", json={"maintenance_enabled": False}, headers=_auth(checker))).status_code == 200
    ok = await client.post(f"/admin/config-changes/{body['request']['id']}/approve", json={}, headers=_auth(checker))
    assert ok.status_code == 200, ok.text
    public = (await client.get("/public/site-status")).json()
    assert public["announcement"]["text_vi"] == "Bảo trì lúc 22h" and public["orders_frozen"] is True
    assert public["maintenance_enabled"] is False

    # The settings form resends every switch with each save: unchanged switches
    # are not an emergency bypass and are not logged as one.
    flagged_before = len(await _events("config_change_applied_immediately"))
    changed_before = len(await _events("site_runtime_config_changed"))
    gated = await client.patch("/admin/site-status", json={
        "maintenance_enabled": False, "orders_frozen": True, "freeze_reason": "incident",
        "media_max_upload_mb": 8, "change_reason": "Ảnh nhỏ hơn",
    }, headers=_auth(maker))
    assert gated.status_code == 202, gated.text
    assert gated.json()["applied_fields"] == [] and gated.json()["request"]["diff"] == {"media_max_upload_mb": [10, 8]}
    assert len(await _events("config_change_applied_immediately")) == flagged_before
    assert len(await _events("site_runtime_config_changed")) == changed_before


@pytest.mark.asyncio
async def test_flag_off_keeps_direct_apply_for_single_admin_installs(client):
    assert settings.config_approval_required is False
    admin = await _admin(client, "solo@example.com")
    resp = await client.patch("/admin/fee-config", json={"platform_fee_percent": 4}, headers=_auth(admin))
    assert resp.status_code == 200 and resp.json()["platform_fee_percent"] == 4
    listed = (await client.get("/admin/config-changes", headers=_auth(admin))).json()
    assert listed["approval_required"] is False and listed["items"] == []


@pytest.mark.asyncio
async def test_pending_requests_lapse(client, approval_on):
    maker, checker = await _two_admins(client)
    req = (await client.patch(
        "/admin/auth-config", json={"verification_link_hours": 48, "change_reason": "longer links"}, headers=_auth(maker),
    )).json()["request"]
    async with SessionLocal() as db:
        await db.execute(update(ConfigChangeRequest).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        await db.commit()
    listed = (await client.get("/admin/config-changes", headers=_auth(checker))).json()
    assert listed["items"] == [] and listed["pending_count"] == 0
    assert (await _request_row(req["id"])).status == "expired"
    late = await client.post(f"/admin/config-changes/{req['id']}/approve", json={}, headers=_auth(checker))
    assert late.status_code == 409
    assert (await client.get("/admin/auth-config", headers=_auth(maker))).json()["verification_link_hours"] != 48
    assert len(await _events("config_change_expired")) == 1


@pytest.mark.asyncio
async def test_tier_levers_money_reset_and_trust_go_through_approval(client, approval_on):
    maker, checker = await _two_admins(client)
    tier = await client.patch("/admin/seller-tier-config", json={
        "tiers": {"verified": {"fee_percent": 3}}, "change_reason": "reward verified sellers",
    }, headers=_auth(maker))
    assert tier.status_code == 202, tier.text
    before_fee = (await client.get("/public/seller-tiers")).json()
    assert tier.json()["request"]["diff"] == {"verified": {"fee_percent": [
        next(r["fee_percent"] for r in before_fee["tiers"] if r["tier"] == "verified"), 3]}}
    ok = await client.post(f"/admin/config-changes/{tier.json()['request']['id']}/approve", json={}, headers=_auth(checker))
    assert ok.status_code == 200
    rules = {r["tier"]: r for r in (await client.get("/admin/seller-tier-config", headers=_auth(maker))).json()["tiers"]}
    assert rules["verified"]["fee_percent"] == 3

    trust_cfg = (await client.get("/admin/seller-trust-config", headers=_auth(maker))).json()
    trust_cfg["window_days"] = 60
    queued = await client.put(
        "/admin/seller-trust-config", json={**trust_cfg, "change_reason": "shorter window"}, headers=_auth(maker),
    )
    assert queued.status_code == 202 and queued.json()["request"]["diff"] == {"window_days": [90, 60]}
    assert (await client.get("/admin/seller-trust-config", headers=_auth(maker))).json()["window_days"] == 90
    bad = await client.put("/admin/seller-trust-config", json={**trust_cfg, "window_days": 1}, headers=_auth(checker))
    assert bad.status_code == 422
    ok = await client.post(f"/admin/config-changes/{queued.json()['request']['id']}/approve", json={}, headers=_auth(checker))
    assert ok.status_code == 200
    assert (await client.get("/admin/seller-trust-config", headers=_auth(maker))).json()["window_days"] == 60

    money = (await client.get("/admin/money-config", headers=_auth(maker))).json()
    target = money["display_fx_rate"] + 100 if money["display_fx_rate"] + 100 <= money["rate_max"] else money["display_fx_rate"] - 100
    fx = await client.patch(
        "/admin/money-config", json={"display_fx_rate": target, "change_reason": "new FX"}, headers=_auth(maker),
    )
    assert fx.status_code == 202 and fx.json()["request"]["diff"] == {"display_fx_rate": [money["display_fx_rate"], target]}
    assert (await client.get("/public/money-config")).json()["display_fx_rate"] == money["display_fx_rate"]
    ok = await client.post(f"/admin/config-changes/{fx.json()['request']['id']}/approve", json={}, headers=_auth(checker))
    assert ok.status_code == 200
    assert (await client.get("/public/money-config")).json()["display_fx_rate"] == target


@pytest.mark.asyncio
async def test_buyer_tier_settings_go_through_approval_but_promos_and_locks_do_not(client, approval_on):
    maker, checker = await _two_admins(client)
    cfg = (await client.get("/admin/buyer-tier-config", headers=_auth(maker))).json()
    cfg["levels"]["l2"]["cashback_percent"] = 2
    queued = await client.put(
        "/admin/buyer-tier-config", json={**cfg, "change_reason": "bigger cashback"}, headers=_auth(maker),
    )
    assert queued.status_code == 202, queued.text
    assert queued.json()["request"]["diff"] == {"levels.l2.cashback_percent": [1, 2]}
    assert (await client.get("/public/buyer-tiers")).json()["levels"][1]["cashback_percent"] == 1
    bad = {**cfg, "criterion": "total_bought", "change_reason": "typo"}
    assert (await client.put("/admin/buyer-tier-config", json=bad, headers=_auth(maker))).status_code == 422
    req_id = queued.json()["request"]["id"]
    assert (await client.post(f"/admin/config-changes/{req_id}/approve", json={}, headers=_auth(maker))).status_code == 403
    ok = await client.post(f"/admin/config-changes/{req_id}/approve", json={}, headers=_auth(checker))
    assert ok.status_code == 200
    assert (await client.get("/public/buyer-tiers")).json()["levels"][1]["cashback_percent"] == 2
    assert len(await _events("buyer_tier_config_changed")) == 1

    # Per-account admin actions stay immediate (and audited).
    await register_and_login(client, "promo_seller@example.com")
    await make_seller("promo_seller@example.com")
    seller_id = (await client.get("/me", headers=_auth(await register_and_login(client, "promo_seller@example.com")))).json()["id"]
    promo = await client.put(f"/admin/sellers/{seller_id}/fee-promo", json={}, headers=_auth(maker))
    assert promo.status_code == 200 and promo.json()["fee_percent"] == 0
    lock = await client.patch(f"/admin/sellers/{seller_id}/tier-lock", json={"locked": True}, headers=_auth(maker))
    assert lock.status_code == 200 and lock.json() == {"locked": True}


@pytest.mark.asyncio
async def test_hold_floor_and_ip_flood_guard_go_through_approval(client, approval_on):
    """The new fee-config hold floor and the buyer-tier per-IP API limit are
    ordinary fields of their sections: queued, validated up front, applied by
    a second admin and audited with old → new."""
    maker, checker = await _two_admins(client)
    queued = await client.patch(
        "/admin/fee-config", json={"escrow_floor_hours": 12, "change_reason": "cho phép giữ 12 giờ"}, headers=_auth(maker),
    )
    assert queued.status_code == 202, queued.text
    assert queued.json()["request"]["diff"] == {"escrow_floor_hours": [24, 12]}
    assert (await client.get("/public/fee-config")).json()["escrow_floor_hours"] == 24
    bad = await client.patch("/admin/fee-config", json={"escrow_floor_hours": 0, "change_reason": "typo"}, headers=_auth(checker))
    assert bad.status_code == 422
    ok = await client.post(f"/admin/config-changes/{queued.json()['request']['id']}/approve", json={}, headers=_auth(checker))
    assert ok.status_code == 200, ok.text
    assert (await client.get("/public/fee-config")).json()["escrow_floor_hours"] == 12
    changed = await _events("fee_runtime_config_changed")
    assert changed[-1].metadata_["changed"] == {"escrow_floor_hours": [24, 12]}

    cfg = (await client.get("/admin/buyer-tier-config", headers=_auth(maker))).json()
    queued = await client.put(
        "/admin/buyer-tier-config", json={**cfg, "ip_requests_per_minute": 1_000, "change_reason": "more bots"},
        headers=_auth(maker),
    )
    assert queued.status_code == 202, queued.text
    assert queued.json()["request"]["diff"] == {"ip_requests_per_minute": [500, 1_000]}
    ok = await client.post(f"/admin/config-changes/{queued.json()['request']['id']}/approve", json={}, headers=_auth(checker))
    assert ok.status_code == 200, ok.text
    assert (await client.get("/admin/buyer-tier-config", headers=_auth(maker))).json()["ip_requests_per_minute"] == 1_000
    assert (await _events("buyer_tier_config_changed"))[-1].metadata_["changed"] == {"ip_requests_per_minute": [500, 1_000]}


@pytest.mark.asyncio
async def test_tier_badge_saved_with_a_lever_applies_at_once_while_the_lever_waits(client, approval_on):
    maker, checker = await _two_admins(client)
    buf = io.BytesIO()
    Image.new("RGB", (200, 200), (200, 30, 30)).save(buf, "PNG")
    up = await client.post(
        "/media/uploads?purpose=tier_badge", content=buf.getvalue(),
        headers={**_auth(maker), "Content-Type": "image/png"},
    )
    assert up.status_code == 201, up.text
    badge_id = up.json()["id"]

    saved = await client.patch("/admin/seller-tier-config", json={
        "tiers": {"verified": {"fee_percent": 3, "badge_image_id": badge_id}}, "change_reason": "badge and fee",
    }, headers=_auth(maker))
    assert saved.status_code == 202, saved.text
    # The badge is cosmetic: live now. Only the fee is queued.
    assert saved.json()["request"]["payload"] == {"tiers": {"verified": {"fee_percent": 3}}}
    rules = {r["tier"]: r for r in (await client.get("/admin/seller-tier-config", headers=_auth(maker))).json()["tiers"]}
    assert rules["verified"]["badge"]["id"] == badge_id
    assert rules["verified"]["fee_percent"] != 3

    # Resending the same badge with the same fee is not a new change.
    again = await client.patch("/admin/seller-tier-config", json={
        "tiers": {"verified": {"badge_image_id": badge_id}}, "change_reason": "resend",
    }, headers=_auth(maker))
    assert again.status_code == 200, again.text
    ok = await client.post(f"/admin/config-changes/{saved.json()['request']['id']}/approve", json={}, headers=_auth(checker))
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_mixed_save_blocked_by_a_pending_request_applies_nothing(client, approval_on):
    maker, checker = await _two_admins(client)
    first = await client.patch("/admin/site-status", json={
        "media_max_upload_mb": 7, "change_reason": "first, waits",
    }, headers=_auth(maker))
    assert first.status_code == 202, first.text
    # Same section, now with an emergency switch: the conflict (409) must stop
    # the whole save, not apply the freeze and then fail.
    blocked = await client.patch("/admin/site-status", json={
        "media_max_upload_mb": 9, "withdrawals_frozen": True, "change_reason": "second, conflicts",
    }, headers=_auth(maker))
    assert blocked.status_code == 409, blocked.text
    assert (await client.get("/admin/site-status", headers=_auth(maker))).json()["withdrawals_frozen"] is False
    assert await _events("config_change_applied_immediately") == []
