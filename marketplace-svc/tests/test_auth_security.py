"""Signed-in account security: change password, change email, TOTP 2FA,
the admin-console and withdrawal 2FA policies, and Turnstile gating."""
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account
from src.models.mail import MailOutbox
from tests.conftest import make_admin, make_seller, register_and_login

PW = "StrongPass123!"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _outbox(template: str) -> list[MailOutbox]:
    async with SessionLocal() as db:
        rows = await db.execute(select(MailOutbox).where(MailOutbox.template == template).order_by(MailOutbox.id))
        return list(rows.scalars().all())


def _token_from_url(url: str) -> str:
    return parse_qs(urlparse(url).query)["token"][0]


async def _admin(client, email="sec_admin@example.com"):
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


async def _enable_totp(client, token: str) -> tuple[str, list[str]]:
    setup = await client.post("/auth/2fa/setup", json={"password": PW}, headers=_auth(token))
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    assert "otpauth://totp/GMMO:" in setup.json()["otpauth_uri"]
    enabled = await client.post("/auth/2fa/enable", json={"code": pyotp.TOTP(secret).now()}, headers=_auth(token))
    assert enabled.status_code == 200, enabled.text
    codes = enabled.json()["backup_codes"]
    assert len(codes) == 10
    return secret, codes


# ── change password ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_change_password_keeps_current_session_and_kills_others(client):
    await register_and_login(client, "sec_pw@example.com")
    other = (await client.post("/auth/login", json={"email": "sec_pw@example.com", "password": PW})).json()["access_token"]
    mine = (await client.post("/auth/login", json={"email": "sec_pw@example.com", "password": PW})).json()["access_token"]

    wrong = await client.post("/auth/change-password", json={"current_password": "nope-nope-1", "new_password": "NewPass456!"}, headers=_auth(mine))
    assert wrong.status_code == 400 and wrong.json()["error_code"] == "PASSWORD_INCORRECT"

    ok = await client.post("/auth/change-password", json={"current_password": PW, "new_password": "NewPass456!", "locale": "en"}, headers=_auth(mine))
    assert ok.status_code == 204, ok.text
    assert (await client.get("/me", headers=_auth(mine))).status_code == 200
    assert (await client.get("/me", headers=_auth(other))).status_code == 401
    assert (await client.post("/auth/login", json={"email": "sec_pw@example.com", "password": PW})).status_code == 401
    assert (await client.post("/auth/login", json={"email": "sec_pw@example.com", "password": "NewPass456!"})).status_code == 200
    assert len(await _outbox("password_changed")) == 1


# ── change email ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_change_email_confirms_from_new_mailbox_and_warns_old(client):
    token = await register_and_login(client, "sec_old@example.com")
    await register_and_login(client, "sec_taken@example.com")

    dup = await client.post("/auth/change-email", json={"new_email": "sec_taken@example.com", "password": PW}, headers=_auth(token))
    assert dup.status_code == 409
    bad_pw = await client.post("/auth/change-email", json={"new_email": "sec_new@example.com", "password": "wrong-wrong-1"}, headers=_auth(token))
    assert bad_pw.status_code == 400

    ok = await client.post("/auth/change-email", json={"new_email": "sec_new@example.com", "password": PW, "locale": "vi"}, headers=_auth(token))
    assert ok.status_code == 204, ok.text
    confirm = (await _outbox("email_change_confirm"))[-1]
    assert confirm.to_email == "sec_new@example.com"
    notice = (await _outbox("email_change_notice"))[-1]
    assert notice.to_email == "sec_old@example.com"
    assert notice.payload["new_email"] == "sec_new@example.com"
    # Nothing changed yet.
    assert (await client.get("/me", headers=_auth(token))).json()["email"] == "sec_old@example.com"

    verified = await client.post("/auth/verify-email", json={"token": _token_from_url(confirm.payload["action_url"])})
    assert verified.status_code == 200, verified.text
    assert verified.json()["email"] == "sec_new@example.com"
    assert verified.json()["email_verified"] is True
    assert (await client.post("/auth/login", json={"email": "sec_new@example.com", "password": PW})).status_code == 200
    assert (await client.post("/auth/login", json={"email": "sec_old@example.com", "password": PW})).status_code == 401


# ── TOTP ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_totp_setup_login_challenge_backup_codes_and_disable(client):
    token = await register_and_login(client, "sec_totp@example.com")
    bad_code = await client.post("/auth/2fa/enable", json={"code": "000000"}, headers=_auth(token))
    assert bad_code.status_code == 400  # nothing pending
    secret, codes = await _enable_totp(client, token)
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["totp_enabled"] is True

    # Password alone no longer signs in.
    challenge = await client.post("/auth/login", json={"email": "sec_totp@example.com", "password": PW})
    assert challenge.status_code == 200, challenge.text
    assert challenge.json()["mfa_required"] is True and "access_token" not in challenge.json()
    mfa_token = challenge.json()["mfa_token"]

    wrong = await client.post("/auth/login/2fa", json={"mfa_token": mfa_token, "code": "123456"})
    assert wrong.status_code == 400 and wrong.json()["error_code"] == "MFA_CODE_INVALID"
    garbage = await client.post("/auth/login/2fa", json={"mfa_token": "x" * 40, "code": "123456"})
    assert garbage.status_code == 401

    ok = await client.post("/auth/login/2fa", json={"mfa_token": mfa_token, "code": pyotp.TOTP(secret).now()})
    assert ok.status_code == 200 and ok.json()["access_token"]

    # A backup code works once.
    challenge2 = (await client.post("/auth/login", json={"email": "sec_totp@example.com", "password": PW})).json()
    via_backup = await client.post("/auth/login/2fa", json={"mfa_token": challenge2["mfa_token"], "code": codes[0]})
    assert via_backup.status_code == 200
    challenge3 = (await client.post("/auth/login", json={"email": "sec_totp@example.com", "password": PW})).json()
    reused = await client.post("/auth/login/2fa", json={"mfa_token": challenge3["mfa_token"], "code": codes[0]})
    assert reused.status_code == 400

    # Login history shows the two stages.
    async with SessionLocal() as db:
        from src.models.login_event import LoginEvent

        outcomes = [r.outcome for r in (await db.execute(select(LoginEvent).order_by(LoginEvent.id))).scalars()]
    assert "mfa_pending" in outcomes and "mfa_failed" in outcomes

    session = ok.json()["access_token"]
    regen = await client.post("/auth/2fa/backup-codes", json={"code": pyotp.TOTP(secret).now()}, headers=_auth(session))
    assert regen.status_code == 200 and len(regen.json()["backup_codes"]) == 10

    off = await client.post("/auth/2fa/disable", json={"password": PW, "code": pyotp.TOTP(secret).now()}, headers=_auth(session))
    assert off.status_code == 204
    plain = await client.post("/auth/login", json={"email": "sec_totp@example.com", "password": PW})
    assert plain.status_code == 200 and plain.json().get("access_token")


@pytest.mark.asyncio
async def test_admin_console_locked_until_totp_when_policy_on(client):
    admin_token = await _admin(client)
    on = await client.patch("/admin/auth-config", json={"require_admin_2fa": True}, headers=_auth(admin_token))
    assert on.status_code == 200
    # Every admin route is now shut for this admin…
    assert (await client.get("/admin/accounts", headers=_auth(admin_token))).status_code == 403
    assert (await client.get("/admin/accounts", headers=_auth(admin_token))).json()["error_code"] == "MFA_SETUP_REQUIRED"
    assert (await client.get("/me", headers=_auth(admin_token))).json()["mfa_setup_required"] is True
    # …but the setup endpoints still work, and enabling reopens it.
    secret, _ = await _enable_totp(client, admin_token)
    assert (await client.get("/admin/accounts", headers=_auth(admin_token))).status_code == 200
    assert (await client.get("/me", headers=_auth(admin_token))).json()["mfa_setup_required"] is False
    # Admin entrance goes through the challenge and refuses the buyer entrance.
    challenge = await client.post("/auth/admin/login", json={"email": "sec_admin@example.com", "password": PW})
    assert challenge.json()["mfa_required"] is True
    done = await client.post("/auth/login/2fa", json={"mfa_token": challenge.json()["mfa_token"], "code": pyotp.TOTP(secret).now()})
    assert done.status_code == 200
    buyer_side = await client.post("/auth/login", json={"email": "sec_admin@example.com", "password": PW})
    assert buyer_side.status_code == 403


@pytest.mark.asyncio
async def test_withdrawal_requires_totp_when_policy_on(client):
    admin_token = await _admin(client)
    seller_token = await register_and_login(client, "sec_seller@example.com")
    await make_seller("sec_seller@example.com")
    seller_token = await register_and_login(client, "sec_seller@example.com")
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": seller_id, "amount": 500_000}, headers=_auth(admin_token))
    body = {"amount": 100_000, "bank_name": "MB", "bank_account_number": "0123456789", "bank_account_holder": "SELLER"}

    await client.patch("/admin/auth-config", json={"require_2fa_for_withdrawal": True}, headers=_auth(admin_token))
    no_totp = await client.post("/wallet/withdraw", json=body, headers=_auth(seller_token))
    assert no_totp.status_code == 403 and no_totp.json()["error_code"] == "MFA_SETUP_REQUIRED"

    secret, _ = await _enable_totp(client, seller_token)
    missing = await client.post("/wallet/withdraw", json=body, headers=_auth(seller_token))
    assert missing.status_code == 400 and missing.json()["error_code"] == "MFA_REQUIRED"
    wrong = await client.post("/wallet/withdraw", json={**body, "totp_code": "000000"}, headers=_auth(seller_token))
    assert wrong.status_code == 400 and wrong.json()["error_code"] == "MFA_CODE_INVALID"
    ok = await client.post("/wallet/withdraw", json={**body, "totp_code": pyotp.TOTP(secret).now()}, headers=_auth(seller_token))
    assert ok.status_code == 200, ok.text

    await client.patch("/admin/auth-config", json={"require_2fa_for_withdrawal": False}, headers=_auth(admin_token))
    relaxed = await client.post("/wallet/withdraw", json=body, headers=_auth(seller_token))
    assert relaxed.status_code == 200, relaxed.text


# ── Turnstile ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_turnstile_enforced_only_when_site_key_and_secret_exist(client, monkeypatch):
    from src.config import settings
    from src.security import turnstile

    admin_token = await _admin(client)
    # Site key alone (no secret) does nothing.
    await client.patch("/admin/auth-config", json={"turnstile_site_key": "1x00000000000000000000AA"}, headers=_auth(admin_token))
    assert (await client.get("/public/auth-config")).json()["turnstile_site_key"] == ""
    assert (await client.post("/auth/register", json={"email": "sec_cap1@example.com", "password": PW})).status_code == 201

    monkeypatch.setattr(settings, "turnstile_secret_key", "1x0000000000000000000000000000000AA")
    assert (await client.get("/public/auth-config")).json()["turnstile_site_key"] == "1x00000000000000000000AA"
    missing = await client.post("/auth/register", json={"email": "sec_cap2@example.com", "password": PW})
    assert missing.status_code == 400 and missing.json()["error_code"] == "CAPTCHA_REQUIRED"

    async def fake_verify(token, *, remote_ip=None):
        return token == "good"
    monkeypatch.setattr(turnstile, "verify_token", fake_verify)
    bad = await client.post("/auth/register", json={"email": "sec_cap2@example.com", "password": PW, "captcha_token": "bad"})
    assert bad.status_code == 400 and bad.json()["error_code"] == "CAPTCHA_FAILED"
    good = await client.post("/auth/register", json={"email": "sec_cap2@example.com", "password": PW, "captcha_token": "good"})
    assert good.status_code == 201
    login = await client.post("/auth/login", json={"email": "sec_cap2@example.com", "password": PW, "captcha_token": "good"})
    assert login.status_code == 200
    forgot = await client.post("/auth/forgot-password", json={"email": "sec_cap2@example.com", "locale": "vi"})
    assert forgot.status_code == 400
    # Admin console is exempt: internal network cannot reach Cloudflare.
    await make_admin("sec_cap2@example.com")
    admin_login = await client.post("/auth/admin/login", json={"email": "sec_cap2@example.com", "password": PW})
    assert admin_login.status_code == 200, admin_login.text


@pytest.mark.asyncio
async def test_mfa_switch_off_disables_setup_challenge_and_policies(client):
    """The marketplace-wide switch ships off: nobody can enable TOTP, an
    account that already has it signs in with the password alone, and the
    admin/withdrawal policies are inert until the switch is on."""
    admin_token = await _admin(client)
    token = await register_and_login(client, "sec_switch@example.com")
    secret, _ = await _enable_totp(client, token)

    off = await client.patch(
        "/admin/auth-config",
        json={"mfa_feature_enabled": False, "require_admin_2fa": True, "require_2fa_for_withdrawal": True},
        headers=_auth(admin_token),
    )
    assert off.status_code == 200 and off.json()["mfa_feature_enabled"] is False
    assert (await client.get("/public/auth-config")).json()["mfa_enabled"] is False

    # Password alone signs in, even though the account has TOTP configured.
    plain = await client.post("/auth/login", json={"email": "sec_switch@example.com", "password": PW})
    assert plain.status_code == 200 and plain.json().get("access_token")
    me = (await client.get("/me", headers=_auth(plain.json()["access_token"]))).json()
    assert me["mfa_available"] is False and me["totp_enabled"] is True

    # Nobody can start a setup, and the admin policy does not lock the console.
    setup = await client.post("/auth/2fa/setup", json={"password": PW}, headers=_auth(token))
    assert setup.status_code == 403 and setup.json()["error_code"] == "MFA_FEATURE_DISABLED"
    assert (await client.get("/admin/accounts", headers=_auth(admin_token))).status_code == 200
    assert (await client.get("/me", headers=_auth(admin_token))).json()["mfa_setup_required"] is False

    # Switch back on: the stored policy bites immediately.
    await client.patch("/admin/auth-config", json={"mfa_feature_enabled": True}, headers=_auth(admin_token))
    assert (await client.get("/admin/accounts", headers=_auth(admin_token))).status_code == 403
    challenge = await client.post("/auth/login", json={"email": "sec_switch@example.com", "password": PW})
    assert challenge.json()["mfa_required"] is True
