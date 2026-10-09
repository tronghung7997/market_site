"""Maintenance mode, money kill-switches and the announcement bar."""
import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from src.database import SessionLocal, engine
from src.models.log_entry import LogEntry
from src.models.site_runtime_config import SiteRuntimeConfig
from src.runtime_config import clear_all_process_config_caches
from src.site_status import pausable
from src.site_status.html import sanitize_announcement_html
from src.site_status.service import announcement_is_live
from tests.conftest import make_admin, make_seller, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@contextmanager
def _config_reads():
    """Count the statements that read ``site_runtime_config``."""
    seen: list[str] = []

    def before(conn, cursor, statement, params, context, executemany):
        if "FROM site_runtime_config" in statement:
            seen.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", before)
    try:
        yield seen
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", before)


async def _set_switches_elsewhere(**values) -> None:
    """Flip switches the way another process's admin write would: committed
    in the DB, but without invalidating this process's cache."""
    async with SessionLocal() as db:
        await db.execute(
            pg_insert(SiteRuntimeConfig).values(id=1, **values)
            .on_conflict_do_update(index_elements=["id"], set_=values)
        )
        await db.commit()


async def _admin(client, email="st_admin@example.com"):
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


@pytest.mark.asyncio
async def test_kill_switches_block_only_their_flow_and_are_audited(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": seller_id, "amount": 500_000}, headers=_auth(admin_token))
    withdraw_body = {"amount": 100_000, "bank_name": "MB", "bank_account_number": "0123456789", "bank_account_holder": "SELLER"}

    on = await client.patch(
        "/admin/site-status",
        json={"withdrawals_frozen": True, "orders_frozen": True, "freeze_reason": "suspected ledger bug"},
        headers=_auth(admin_token),
    )
    assert on.status_code == 200, on.text
    assert on.json()["withdrawals_frozen"] is True and on.json()["deposits_frozen"] is False

    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert order.status_code == 503 and order.json()["error_code"] == "ORDERS_FROZEN"
    withdraw = await client.post("/wallet/withdraw", json=withdraw_body, headers=_auth(seller_token))
    assert withdraw.status_code == 503 and withdraw.json()["error_code"] == "WITHDRAWALS_FROZEN"
    # Deposits untouched, browsing untouched, admin untouched.
    assert (await client.get("/wallet/deposit-methods", headers=_auth(buyer_token))).status_code == 200
    assert (await client.get("/products")).status_code == 200
    assert (await client.get("/admin/withdrawals", headers=_auth(admin_token))).status_code == 200
    # Public status never leaks the internal reason.
    public = (await client.get("/public/site-status")).json()
    assert public["orders_frozen"] is True and "freeze_reason" not in public

    off = await client.patch("/admin/site-status", json={"withdrawals_frozen": False, "orders_frozen": False}, headers=_auth(admin_token))
    assert off.status_code == 200
    assert (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))).status_code == 201
    assert (await client.post("/wallet/withdraw", json=withdraw_body, headers=_auth(seller_token))).status_code == 200

    async with SessionLocal() as db:
        rows = list((await db.execute(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == "site_runtime_config_changed").order_by(LogEntry.id)
        )).scalars())
    assert len(rows) == 2
    assert rows[0].level == "warning"
    assert rows[0].metadata_["changed"]["orders_frozen"] == [False, True]
    assert rows[0].metadata_["changed"]["freeze_reason"] == ["", "suspected ledger bug"]


@pytest.mark.asyncio
async def test_maintenance_blocks_non_admins_but_keeps_ops_paths_open(client):
    buyer_token, _, admin_token, instant_vid, _ = await setup_buyable_product(client)
    on = await client.patch(
        "/admin/site-status",
        json={"maintenance_enabled": True, "maintenance_message_vi": "Bảo trì ngân hàng", "maintenance_message_en": "Bank maintenance"},
        headers=_auth(admin_token),
    )
    assert on.status_code == 200, on.text

    # Storefront and buyer APIs are shut…
    for path, headers in (("/products", None), ("/wallet", _auth(buyer_token)), ("/orders", _auth(buyer_token))):
        resp = await client.get(path, headers=headers)
        assert resp.status_code == 503, path
        assert resp.json()["error_code"] == "MAINTENANCE"
    assert (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))).status_code == 503
    # …but health, the public status, /me, sign-in and the admin console are not.
    assert (await client.get("/health")).status_code == 200
    public = (await client.get("/public/site-status")).json()
    assert public["maintenance_enabled"] is True and public["maintenance_message_vi"] == "Bảo trì ngân hàng"
    assert (await client.get("/me", headers=_auth(buyer_token))).status_code == 200
    assert (await client.post("/auth/login", json={"email": "ord_buyer@example.com", "password": "StrongPass123!"})).status_code == 200
    assert (await client.get("/admin/accounts", headers=_auth(admin_token))).status_code == 200
    # An admin token opens every route, even storefront ones.
    assert (await client.get("/products", headers=_auth(admin_token))).status_code == 200
    # Payment webhooks are not gated (a bad signature is still a 4xx, never 503).
    hook = await client.post("/webhooks/sepay", json={})
    assert hook.status_code != 503

    off = await client.patch("/admin/site-status", json={"maintenance_enabled": False}, headers=_auth(admin_token))
    assert off.status_code == 200
    assert (await client.get("/products")).status_code == 200


@pytest.mark.asyncio
async def test_pausable_job_skips_during_maintenance(client):
    admin_token = await _admin(client)
    calls: list[int] = []

    async def job() -> None:
        calls.append(1)

    wrapped = pausable(job)
    await wrapped()
    assert calls == [1]
    await client.patch("/admin/site-status", json={"maintenance_enabled": True}, headers=_auth(admin_token))
    await wrapped()
    assert calls == [1]
    await client.patch("/admin/site-status", json={"maintenance_enabled": False}, headers=_auth(admin_token))
    await wrapped()
    assert calls == [1, 1]


@pytest.mark.asyncio
async def test_announcement_schedule_version_and_public_shape(client):
    admin_token = await _admin(client)
    assert (await client.get("/public/site-status")).json()["announcement"] is None

    now = datetime.now(timezone.utc)
    resp = await client.patch(
        "/admin/site-status",
        json={
            "announcement_enabled": True, "announcement_level": "warn",
            "announcement_text_vi": "Ngân hàng bảo trì 23h–1h", "announcement_text_en": "Bank maintenance 23:00–01:00",
            "announcement_link_url": "/legal/escrow",
            "announcement_starts_at": (now - timedelta(hours=1)).isoformat(),
            "announcement_ends_at": (now + timedelta(hours=1)).isoformat(),
        },
        headers=_auth(admin_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["announcement_version"] == 2
    live = (await client.get("/public/site-status")).json()["announcement"]
    assert live == {"level": "warn", "format": "text", "text_vi": "Ngân hàng bảo trì 23h–1h", "text_en": "Bank maintenance 23:00–01:00", "link_url": "/legal/escrow", "version": 2}

    # Editing only the schedule keeps the version; editing the text bumps it.
    same = await client.patch("/admin/site-status", json={"announcement_ends_at": (now + timedelta(hours=2)).isoformat()}, headers=_auth(admin_token))
    assert same.json()["announcement_version"] == 2
    bumped = await client.patch("/admin/site-status", json={"announcement_text_vi": "Đã xong"}, headers=_auth(admin_token))
    assert bumped.json()["announcement_version"] == 3

    # A window in the future hides it; clearing the window shows it again.
    future = await client.patch("/admin/site-status", json={"announcement_starts_at": (now + timedelta(days=1)).isoformat()}, headers=_auth(admin_token))
    assert future.status_code == 200
    assert (await client.get("/public/site-status")).json()["announcement"] is None
    cleared = await client.patch("/admin/site-status", json={"clear_announcement_window": True}, headers=_auth(admin_token))
    assert cleared.json()["announcement_starts_at"] is None
    assert (await client.get("/public/site-status")).json()["announcement"]["version"] == 3

    bad = await client.patch("/admin/site-status", json={"announcement_level": "purple"}, headers=_auth(admin_token))
    assert bad.status_code == 422
    user_token = await register_and_login(client, "st_user@example.com")
    assert (await client.patch("/admin/site-status", json={"maintenance_enabled": True}, headers=_auth(user_token))).status_code == 403


@pytest.mark.asyncio
async def test_read_paths_share_one_config_read(client):
    """The maintenance gate and the public banner read the row once per TTL
    window, and concurrent cold misses collapse into a single query."""
    with _config_reads() as reads:
        for _ in range(10):
            assert (await client.get("/products")).status_code == 200
    assert len(reads) == 1

    clear_all_process_config_caches()
    with _config_reads() as reads:
        responses = await asyncio.gather(*(client.get("/public/site-status") for _ in range(8)))
    assert all(r.status_code == 200 for r in responses)
    assert len(reads) == 1


@pytest.mark.asyncio
async def test_admin_update_is_visible_at_once_in_this_process(client):
    admin_token = await _admin(client)
    await register_and_login(client, "st_seller@example.com")
    await make_seller("st_seller@example.com")
    seller_token = await register_and_login(client, "st_seller@example.com")

    # Neither a signed-out caller nor a non-admin can read or flip a switch.
    assert (await client.patch("/admin/site-status", json={"orders_frozen": True})).status_code == 401
    assert (await client.patch(
        "/admin/site-status", json={"orders_frozen": True}, headers=_auth(seller_token),
    )).status_code == 403
    assert (await client.get("/admin/site-status", headers=_auth(seller_token))).status_code == 403
    assert (await client.get("/public/site-status")).json()["orders_frozen"] is False

    assert (await client.get("/products")).status_code == 200  # warm cache
    on = await client.patch("/admin/site-status", json={"maintenance_enabled": True}, headers=_auth(admin_token))
    assert on.status_code == 200
    with _config_reads() as reads:
        assert (await client.get("/products")).status_code == 503
        assert (await client.get("/public/site-status")).json()["maintenance_enabled"] is True
        assert (await client.get("/products")).status_code == 503
    assert len(reads) == 1  # one reload after the invalidation, then cached again


@pytest.mark.asyncio
async def test_money_gates_read_the_switch_fresh_despite_a_warm_cache(client):
    """A freeze committed by another process must stop money at once, even
    while this process still caches "open" for the banner/gate."""
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": seller_id, "amount": 500_000}, headers=_auth(admin_token))
    withdraw_body = {"amount": 100_000, "bank_name": "MB", "bank_account_number": "0123456789", "bank_account_holder": "SELLER"}

    assert (await client.get("/public/site-status")).json()["orders_frozen"] is False  # warm cache
    await _set_switches_elsewhere(orders_frozen=True, withdrawals_frozen=True, deposits_frozen=True)
    # Read paths may lag by up to the TTL…
    assert (await client.get("/public/site-status")).json()["orders_frozen"] is False

    # …money paths never do.
    with _config_reads() as reads:
        order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert order.status_code == 503 and order.json()["error_code"] == "ORDERS_FROZEN"
    assert len(reads) == 1  # the gate stayed cached; the freeze check went to the row
    withdraw = await client.post("/wallet/withdraw", json=withdraw_body, headers=_auth(seller_token))
    assert withdraw.status_code == 503 and withdraw.json()["error_code"] == "WITHDRAWALS_FROZEN"
    deposit = await client.post("/wallet/deposits", json={"amount": 50_000}, headers=_auth(buyer_token))
    assert deposit.status_code == 503 and deposit.json()["error_code"] == "DEPOSITS_FROZEN"

    # Lifting the freeze elsewhere reopens money at once too.
    await _set_switches_elsewhere(orders_frozen=False, withdrawals_frozen=False, deposits_frozen=False)
    assert (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))).status_code == 201
    assert (await client.post("/wallet/withdraw", json=withdraw_body, headers=_auth(seller_token))).status_code == 200
    assert (await client.post("/wallet/deposits", json={"amount": 50_000}, headers=_auth(buyer_token))).status_code != 503


@pytest.mark.no_db
def test_announcement_is_live_pure():
    base = {"announcement_enabled": True, "announcement_text_vi": "x", "announcement_text_en": "",
            "announcement_starts_at": None, "announcement_ends_at": None}
    now = datetime(2026, 9, 18, 12, tzinfo=timezone.utc)
    assert announcement_is_live(base, now)
    assert not announcement_is_live({**base, "announcement_enabled": False}, now)
    assert not announcement_is_live({**base, "announcement_text_vi": ""}, now)
    assert not announcement_is_live({**base, "announcement_starts_at": "2026-09-18T13:00:00+00:00"}, now)
    assert not announcement_is_live({**base, "announcement_ends_at": "2026-09-18T11:00:00+00:00"}, now)


@pytest.mark.no_db
@pytest.mark.parametrize("raw, expected", [
    ("<b>Sale</b> <script>alert(1)</script>today", "<b>Sale</b> today"),
    ('<img src=x onerror="alert(1)">ok', "ok"),
    ('<span onmouseover="alert(1)" style="color:red">hi</span>', "<span>hi</span>"),
    ('<a href="javascript:alert(1)">click</a>', "click"),
    ('<a href="java&#09;script:alert(1)">tab</a>', "tab"),
    ('<a href="  JAVASCRIPT:alert(1)">upper</a>', "upper"),
    ('<a href="data:text/html,<script>alert(1)</script>">data</a>', "data"),
    ('<a href="//evil.example">proto-relative</a>', "proto-relative"),
    (
        '<a href="https://gmmo.info/sale?a=1&amp;b=2" target="_self" rel="opener" onclick="x()">Sale</a>',
        '<a href="https://gmmo.info/sale?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Sale</a>',
    ),
    ('<a href="mailto:help@gmmo.info">mail</a>', '<a href="mailto:help@gmmo.info" target="_blank" rel="noopener noreferrer">mail</a>'),
    ("<iframe src=https://x></iframe><style>*{}</style><svg onload=alert(1)><a href=https://x>s</a></svg>after", "after"),
    ("<!-- note --><u>u</u><br/><i>i</i><em>e</em><strong>s</strong>", "<u>u</u><br><i>i</i><em>e</em><strong>s</strong>"),
    ("<b><i>mis</b>nested</i> 1 < 2 & 3", "<b><i>mis</i></b>nested 1 &lt; 2 &amp; 3"),
    ("<b>unclosed", "<b>unclosed</b>"),
])
def test_announcement_html_allowlist(raw, expected):
    clean = sanitize_announcement_html(raw)
    assert clean == expected
    assert sanitize_announcement_html(clean) == clean  # idempotent


@pytest.mark.asyncio
async def test_html_announcement_is_sanitized_on_save_and_served_as_html(client):
    admin_token = await _admin(client)
    hostile = '<b>Bảo trì</b> <a href="javascript:alert(1)" onclick="x()">xem</a><script>steal()</script><img src=x onerror=alert(1)>'
    resp = await client.patch("/admin/site-status", json={
        "announcement_enabled": True, "announcement_format": "html",
        "announcement_text_vi": hostile, "announcement_text_en": '<a href="https://gmmo.info">Details</a>',
    }, headers=_auth(admin_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["announcement_format"] == "html"
    assert body["announcement_text_vi"] == "<b>Bảo trì</b> xem"
    assert body["announcement_text_en"] == '<a href="https://gmmo.info" target="_blank" rel="noopener noreferrer">Details</a>'
    live = (await client.get("/public/site-status")).json()["announcement"]
    assert live["format"] == "html" and live["text_vi"] == "<b>Bảo trì</b> xem"

    # Up to 1000 typed characters in HTML; plain text keeps its 300 cap.
    assert (await client.patch("/admin/site-status", json={"announcement_text_vi": "<b>x</b>" * 120}, headers=_auth(admin_token))).status_code == 200
    assert (await client.patch("/admin/site-status", json={"announcement_text_vi": "x" * 1001}, headers=_auth(admin_token))).status_code == 422
    to_text = await client.patch("/admin/site-status", json={"announcement_format": "text"}, headers=_auth(admin_token))
    assert to_text.status_code == 422 and "300" in to_text.text
    ok = await client.patch("/admin/site-status", json={"announcement_format": "text", "announcement_text_vi": "Plain <b>"}, headers=_auth(admin_token))
    assert ok.status_code == 200 and ok.json()["announcement_text_vi"] == "Plain <b>"
    assert (await client.patch("/admin/site-status", json={"announcement_format": "markdown"}, headers=_auth(admin_token))).status_code == 422

    async with SessionLocal() as db:
        entry = (await db.execute(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == "site_runtime_config_changed").order_by(LogEntry.id)
        )).scalars().all()[0]
    assert entry.metadata_["changed"]["announcement_format"] == ["text", "html"]


@pytest.mark.asyncio
async def test_public_view_resanitizes_html_written_outside_the_api(client):
    await _set_switches_elsewhere(
        announcement_enabled=True, announcement_format="html",
        announcement_text_vi='<script>alert(1)</script><b onclick="x()">hi</b>', announcement_text_en="",
    )
    clear_all_process_config_caches()
    live = (await client.get("/public/site-status")).json()["announcement"]
    assert live["text_vi"] == "<b>hi</b>"


@pytest.mark.asyncio
async def test_announcement_preview_is_admin_only_and_sanitized(client):
    admin_token = await _admin(client)
    preview = await client.post("/admin/site-status/announcement-preview", json={"html": '<i>x</i><img src=x onerror=alert(1)>'}, headers=_auth(admin_token))
    assert preview.status_code == 200 and preview.json() == {"html": "<i>x</i>"}
    assert (await client.post("/admin/site-status/announcement-preview", json={"html": "x" * 1001}, headers=_auth(admin_token))).status_code == 422
    user_token = await register_and_login(client, "st_preview_user@example.com")
    assert (await client.post("/admin/site-status/announcement-preview", json={"html": "x"}, headers=_auth(user_token))).status_code == 403
    assert (await client.post("/admin/site-status/announcement-preview", json={"html": "x"})).status_code == 401


@pytest.mark.asyncio
async def test_public_status_carries_the_effective_upload_cap(client):
    admin_token = await _admin(client)
    assert (await client.get("/public/site-status")).json()["media_max_upload_mb"] == 10
    assert (await client.patch("/admin/site-status", json={"media_max_upload_mb": 3}, headers=_auth(admin_token))).status_code == 200
    assert (await client.get("/public/site-status")).json()["media_max_upload_mb"] == 3
