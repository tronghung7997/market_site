"""Resolve the client IP for rate limiting behind reverse proxies.

By default we only use ``request.client.host`` (the direct TCP peer). We never
trust ``X-Forwarded-For`` unless that peer is listed in
``TRUSTED_PROXY_CIDRS`` — spoofed XFF from the open internet would otherwise
let attackers pick their rate-limit bucket.

When the peer *is* a trusted proxy, XFF is parsed **right-to-left**: trusted
proxy hops (and the connecting peer) are skipped, and the first untrusted hop
is the client. That defeats:

    X-Forwarded-For: 1.1.1.1          # attacker-chosen
    # nginx appends the real remote → "1.1.1.1, 203.0.113.9"

Left-most parsing would rate-limit ``1.1.1.1`` (bypass); right-most untrusted
selects ``203.0.113.9``.

Prefer also configuring the proxy to *overwrite* XFF with the trusted client
IP when possible; this parser is defense-in-depth for append-style proxies.
"""

from __future__ import annotations

import ipaddress

from fastapi import Request

_parsed_trusted: list[ipaddress.IPv4Network | ipaddress.IPv6Network] | None = None
# Optional override for unit tests (avoids importing settings at module load).
_trusted_cidrs_override: str | None = None


def parse_trusted_proxy_cidrs(raw: str) -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    """Parse ``TRUSTED_PROXY_CIDRS`` (comma-separated IPs or CIDRs).

    Raises ``ValueError`` on any invalid entry so misconfiguration fails at
    startup rather than on the first authenticated request.
    """
    nets: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    text = (raw or "").strip()
    if not text:
        return nets
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            if "/" not in part:
                ip = ipaddress.ip_address(part)
                part = f"{part}/{'32' if ip.version == 4 else '128'}"
            nets.append(ipaddress.ip_network(part, strict=False))
        except ValueError as exc:
            raise ValueError(
                f"TRUSTED_PROXY_CIDRS entry {part!r} is not a valid IP or CIDR: {exc}"
            ) from exc
    return nets


def _configured_trusted_cidrs() -> str:
    if _trusted_cidrs_override is not None:
        return _trusted_cidrs_override
    # Lazy import: config.Settings validates using parse_trusted_proxy_cidrs at
    # boot; importing settings at module top would circular-import.
    from src.config import settings
    return settings.trusted_proxy_cidrs


def _trusted_networks() -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    global _parsed_trusted
    if _parsed_trusted is not None:
        return _parsed_trusted
    # Settings already validates at boot; re-parse here for monkeypatched tests.
    _parsed_trusted = parse_trusted_proxy_cidrs(_configured_trusted_cidrs())
    return _parsed_trusted


def reset_trusted_proxy_cache(*, trusted_proxy_cidrs: str | None = None) -> None:
    """Test helper — clear cache; optionally pin CIDRs without touching Settings."""
    global _parsed_trusted, _trusted_cidrs_override
    _parsed_trusted = None
    _trusted_cidrs_override = trusted_proxy_cidrs


def _ip_in_trusted(host: str) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(addr in net for net in _trusted_networks())


def _normalize_hop(hop: str) -> str | None:
    candidate = hop.strip()
    if not candidate:
        return None
    # Strip optional port / brackets for IPv6 "[::1]:1234"
    if candidate.startswith("["):
        end = candidate.find("]")
        if end != -1:
            candidate = candidate[1:end]
    elif candidate.count(":") == 1 and candidate.rsplit(":", 1)[-1].isdigit():
        candidate = candidate.rsplit(":", 1)[0]
    try:
        ipaddress.ip_address(candidate)
        return candidate
    except ValueError:
        return None


def client_from_xff(xff: str, *, peer: str | None = None) -> str | None:
    """Pick the client IP from an XFF chain by walking right → left.

    Skips hops that belong to ``TRUSTED_PROXY_CIDRS`` (and skips the direct
    TCP peer if it appears). Returns the right-most untrusted hop, or
    ``None`` if none remains.
    """
    hops: list[str] = []
    for raw in xff.split(","):
        hop = _normalize_hop(raw)
        if hop is not None:
            hops.append(hop)
    if not hops:
        return None

    for hop in reversed(hops):
        if peer and hop == peer:
            continue
        if _ip_in_trusted(hop):
            continue
        return hop
    return None


def client_ip(request: Request) -> str:
    """Return the best-effort client IP for rate-limit buckets."""
    peer = request.client.host if request.client else None
    if not peer:
        return "unknown"

    if _trusted_networks() and _ip_in_trusted(peer):
        xff = request.headers.get("x-forwarded-for")
        if xff:
            original = client_from_xff(xff, peer=peer)
            if original:
                return original

    return peer
