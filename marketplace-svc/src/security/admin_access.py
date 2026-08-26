"""Network allowlist for admin-only HTTP surfaces."""

from __future__ import annotations

import ipaddress
from functools import lru_cache

from fastapi import Request

from src.security.client_ip import client_ip

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def parse_admin_allowed_ips(raw: str) -> frozenset[IPAddress]:
    """Parse comma-separated exact IPs and fail fast on invalid config."""
    addresses: set[IPAddress] = set()
    for part in (raw or "").split(","):
        candidate = part.strip()
        if not candidate:
            continue
        try:
            address = ipaddress.ip_address(candidate)
        except ValueError as exc:
            raise ValueError(
                f"ADMIN_ALLOWED_IPS entry {candidate!r} is not a valid IP address: {exc}"
            ) from exc
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        addresses.add(address)
    return frozenset(addresses)


@lru_cache(maxsize=8)
def _allowed_ips(raw: str) -> frozenset[IPAddress]:
    return parse_admin_allowed_ips(raw)


def is_admin_network_path(path: str) -> bool:
    """Return whether a backend path belongs to the admin network boundary."""
    return path == "/auth/admin/login" or path == "/admin" or path.startswith("/admin/")


def admin_request_allowed(request: Request) -> bool:
    """Allow all traffic until ADMIN_ALLOWED_IPS is configured."""
    # Lazy import avoids a cycle while Settings validates this parser at boot.
    from src.config import settings

    allowed = _allowed_ips(settings.admin_allowed_ips)
    if not allowed:
        return True

    try:
        address = ipaddress.ip_address(client_ip(request))
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return address in allowed
