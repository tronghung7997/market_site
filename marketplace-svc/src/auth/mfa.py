"""TOTP two-factor authentication (RFC 6238) plus one-time backup codes.

Secrets are Fernet-encrypted at rest with the shared ENCRYPTION_KEY. The
sign-in challenge is a short-lived JWT (`purpose=mfa`) that only unlocks
`POST /auth/login/2fa`; it never grants access to anything else.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt
import pyotp

from src.config import settings
from src.models.account import Account
from src.security.crypto import decrypt_str, encrypt_str

ISSUER = "GMMO"
BACKUP_CODE_COUNT = 10
MFA_TOKEN_TTL_MINUTES = 5
_BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def _hash_backup(code: str) -> str:
    return hashlib.sha256(code.replace("-", "").strip().lower().encode()).hexdigest()


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=ISSUER)


def store_pending_secret(account: Account, secret: str) -> None:
    account.totp_secret = encrypt_str(secret)
    account.totp_enabled_at = None
    account.totp_backup_hashes = None


def pending_or_active_secret(account: Account) -> str | None:
    if not account.totp_secret:
        return None
    return decrypt_str(account.totp_secret)


def verify_totp(account: Account, code: str) -> bool:
    secret = pending_or_active_secret(account)
    if not secret:
        return False
    digits = "".join(ch for ch in code if ch.isdigit())
    if len(digits) != 6:
        return False
    return pyotp.TOTP(secret).verify(digits, valid_window=1)


def generate_backup_codes() -> list[str]:
    codes = []
    for _ in range(BACKUP_CODE_COUNT):
        raw = "".join(secrets.choice(_BACKUP_ALPHABET) for _ in range(10))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def enable(account: Account, backup_codes: list[str]) -> None:
    account.totp_enabled_at = datetime.now(timezone.utc)
    account.totp_backup_hashes = [_hash_backup(code) for code in backup_codes]


def disable(account: Account) -> None:
    account.totp_secret = None
    account.totp_enabled_at = None
    account.totp_backup_hashes = None


def consume_backup_code(account: Account, code: str) -> bool:
    """True and burns the code if it is one of the unused backup codes."""
    hashes = list(account.totp_backup_hashes or [])
    digest = _hash_backup(code)
    if digest not in hashes:
        return False
    hashes.remove(digest)
    account.totp_backup_hashes = hashes
    return True


def verify_code(account: Account, code: str) -> bool:
    """A 6-digit TOTP, or a backup code (consumed). Only for enabled accounts."""
    if account.totp_enabled_at is None:
        return False
    if verify_totp(account, code):
        return True
    return consume_backup_code(account, code)


def issue_mfa_token(account_id: int, *, kind: str) -> str:
    payload = {
        "sub": str(account_id),
        "purpose": "mfa",
        "kind": kind,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=MFA_TOKEN_TTL_MINUTES),
        "nonce": secrets.token_hex(8),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_mfa_token(token: str) -> tuple[int, str] | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != "mfa":
        return None
    try:
        return int(payload["sub"]), str(payload.get("kind") or "login")
    except (KeyError, ValueError):
        return None
