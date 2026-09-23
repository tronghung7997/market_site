import base64
import hashlib
import hmac
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from src.config import settings

# Field names inside Provider.config considered sensitive enough to encrypt at
# rest — everything else (base_url, health_endpoint, ...) stays plain so admin
# UI can read it back without decrypting the whole blob.
SENSITIVE_CONFIG_KEYS = {"api_key", "api_secret", "secret_key", "token", "webhook_secret"}

DEFAULT_ENCRYPTION_KEY = "dev-encryption-key-change-in-production"


def using_default_encryption_key() -> bool:
    return settings.encryption_key == DEFAULT_ENCRYPTION_KEY


def _fernet() -> Fernet:
    return _fernet_for(settings.encryption_key)


@lru_cache(maxsize=4)
def _fernet_for(secret: str) -> Fernet:
    # Fernet requires a 32-byte urlsafe-base64 key; derive one deterministically
    # from the configured (arbitrary-length) encryption_key string. Cached: stock
    # lists decrypt hundreds of rows per request.
    key = hashlib.sha256(secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


@lru_cache(maxsize=8)
def _subkey(secret: str, purpose: str) -> bytes:
    return hmac.new(hashlib.sha256(secret.encode()).digest(), purpose.encode(), hashlib.sha256).digest()


def keyed_digest(purpose: str, value: str, *, secret: str | None = None) -> str:
    """HMAC-SHA256 under a per-purpose subkey of the encryption key: equality
    lookups (duplicate detection, exact search) without storing a plain hash
    that could be brute-forced back to a short password."""
    key = _subkey(settings.encryption_key if secret is None else secret, purpose)
    return hmac.new(key, value.encode("utf-8"), hashlib.sha256).hexdigest()


# Every Fernet token starts with the version byte 0x80, i.e. "gAAAAA" in base64.
FERNET_PREFIX = "gAAAAA"


def encrypt_str(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_str(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()


def is_encrypted(value: str) -> bool:
    """Best-effort check so encrypt_config/data migrations stay idempotent —
    a value already produced by encrypt_str will decrypt successfully."""
    try:
        _fernet().decrypt(value.encode())
        return True
    except (InvalidToken, ValueError):
        return False


def encrypt_config(config: dict) -> dict:
    """Encrypt only the sensitive fields inside a Provider.config dict, leaving
    the rest readable without decryption. Idempotent — already-encrypted
    values are left as-is."""
    out = dict(config)
    for key in SENSITIVE_CONFIG_KEYS:
        value = out.get(key)
        if isinstance(value, str) and value and not is_encrypted(value):
            out[key] = encrypt_str(value)
    return out


def decrypt_config(config: dict) -> dict:
    out = dict(config)
    for key in SENSITIVE_CONFIG_KEYS:
        value = out.get(key)
        if isinstance(value, str) and value and is_encrypted(value):
            out[key] = decrypt_str(value)
    return out
