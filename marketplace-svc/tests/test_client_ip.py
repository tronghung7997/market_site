"""Unit tests for trusted-proxy client IP resolution."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from src.config import Settings
from src.security import client_ip as cip


def _req(*, peer: str | None, xff: str | None = None):
    req = MagicMock()
    req.client = SimpleNamespace(host=peer) if peer else None
    headers = {}
    if xff is not None:
        headers["x-forwarded-for"] = xff
    req.headers = headers
    return req


def _settings_kwargs(**overrides):
    values = {
        "deployment_environment": "test",
        "jwt_secret": "j" * 40,
        "internal_api_key": "i" * 40,
        "encryption_key": "e" * 40,
        "enable_demo_topup": False,
        "auth_rate_limit_enabled": True,
    }
    values.update(overrides)
    return values


@pytest.fixture(autouse=True)
def _clear_ip_cache():
    cip.reset_trusted_proxy_cache()
    yield
    cip.reset_trusted_proxy_cache()


@pytest.mark.no_db
def test_client_ip_uses_peer_when_no_trusted_proxies():
    cip.reset_trusted_proxy_cache(trusted_proxy_cidrs="")
    # Even with XFF, untrusted peer must not switch bucket.
    assert cip.client_ip(_req(peer="1.2.3.4", xff="9.9.9.9")) == "1.2.3.4"


@pytest.mark.no_db
def test_client_ip_rightmost_untrusted_ignores_spoofed_left_hop():
    """Attacker-sent left hop must not become the rate-limit identity.

    nginx $proxy_add_x_forwarded_for keeps client XFF and appends $remote_addr:
        X-Forwarded-For: 1.1.1.1, 203.0.113.9
    Peer is the trusted reverse proxy (10.0.0.5).
    """
    cip.reset_trusted_proxy_cache(trusted_proxy_cidrs="10.0.0.0/8")

    assert (
        cip.client_ip(_req(peer="10.0.0.5", xff="1.1.1.1, 203.0.113.9"))
        == "203.0.113.9"
    )
    # Multiple spoofed left hops still collapse to first untrusted from the right.
    assert (
        cip.client_ip(_req(peer="10.0.0.5", xff="8.8.8.8, 1.1.1.1, 203.0.113.50"))
        == "203.0.113.50"
    )


@pytest.mark.no_db
def test_client_ip_skips_trusted_hops_from_the_right():
    cip.reset_trusted_proxy_cache(trusted_proxy_cidrs="10.0.0.0/8,172.16.0.0/12")
    # client, internal proxy (trusted), edge peer (trusted)
    assert (
        cip.client_ip(_req(peer="10.0.0.5", xff="203.0.113.9, 172.16.1.2, 10.0.0.5"))
        == "203.0.113.9"
    )


@pytest.mark.no_db
def test_client_ip_trusts_xff_only_from_trusted_peer():
    cip.reset_trusted_proxy_cache(trusted_proxy_cidrs="10.0.0.0/8")
    assert cip.client_ip(_req(peer="10.0.0.5", xff="203.0.113.9, 10.0.0.5")) == "203.0.113.9"
    # Untrusted peer with spoofed XFF is ignored entirely.
    assert cip.client_ip(_req(peer="8.8.8.8", xff="203.0.113.9")) == "8.8.8.8"


@pytest.mark.no_db
def test_client_from_xff_all_trusted_returns_none():
    cip.reset_trusted_proxy_cache(trusted_proxy_cidrs="10.0.0.0/8")
    assert cip.client_from_xff("10.0.0.1, 10.0.0.2", peer="10.0.0.5") is None
    # Falls back to peer in client_ip().
    assert cip.client_ip(_req(peer="10.0.0.5", xff="10.0.0.1, 10.0.0.2")) == "10.0.0.5"


@pytest.mark.no_db
def test_client_ip_unknown_without_peer():
    cip.reset_trusted_proxy_cache(trusted_proxy_cidrs="")
    assert cip.client_ip(_req(peer=None)) == "unknown"


@pytest.mark.no_db
def test_parse_trusted_proxy_cidrs_rejects_invalid():
    with pytest.raises(ValueError, match="TRUSTED_PROXY_CIDRS"):
        cip.parse_trusted_proxy_cidrs("10.0.0.0/8, not-an-ip")


@pytest.mark.no_db
def test_settings_rejects_invalid_trusted_proxy_cidrs_at_startup():
    with pytest.raises(ValidationError, match="TRUSTED_PROXY_CIDRS"):
        Settings(
            _env_file=None,
            **_settings_kwargs(trusted_proxy_cidrs="999.999.999.999"),
        )


@pytest.mark.no_db
def test_settings_accepts_valid_trusted_proxy_cidrs():
    s = Settings(
        _env_file=None,
        **_settings_kwargs(trusted_proxy_cidrs="10.0.0.0/8, 192.168.1.1"),
    )
    assert "10.0.0.0/8" in s.trusted_proxy_cidrs
