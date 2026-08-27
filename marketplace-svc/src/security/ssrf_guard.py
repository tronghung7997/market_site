"""SSRF guard for seller-controlled outbound base_url.

Sellers register `config.base_url` for `seller_gateway`/`seller_task_webhook`
providers (src/adapters/real_api.py, src/adapters/seller_task_webhook.py) —
this platform's own backend then makes authenticated HTTP requests to
whatever host that config says, both at self-test time (before any admin
review — src/providers/router.py::test_seller_provider) and on every buyer
gateway call afterwards. Without this guard a seller can point base_url at
127.0.0.1, an RFC1918 address, or a cloud metadata endpoint
(169.254.169.254) and use the platform server as an SSRF proxy against its
own infrastructure, with the platform's own Bearer api_key attached.

Only applied where `provider.seller_id is not None` (see
src/adapters/factory.py, src/providers/service.py) — admin-created providers
are trusted input and intentionally allowed to point at http://localhost for
local dev against scripts/mock_seller.py.

At call time the resolved public IP is returned to the HTTP transport, which
connects to that exact address while preserving the original hostname for
TLS SNI and certificate verification. This removes the validation/request
DNS TOCTOU gap. Resolution failures fail closed outside the test environment.
"""

import asyncio
from dataclasses import dataclass
import ipaddress
import socket
from urllib.parse import urlsplit

from fastapi import HTTPException

_ALLOWED_SCHEMES = {"https"}
_LOCAL_LOOPBACK_SCHEMES = {"http", "https"}
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
_RESOLVE_TIMEOUT_SECONDS = 2.0


def _seller_loopback_allowed() -> bool:
    # Local mock_seller.py only. Staging/production/test keep the closed guard.
    from src.config import settings
    return settings.deployment_environment == "development"


@dataclass(frozen=True)
class ResolvedTarget:
    hostname: str
    ip_address: str


def _is_blocked_ip(ip_str: str) -> bool:
    addr = ipaddress.ip_address(ip_str)
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def _reject(reason: str) -> None:
    raise HTTPException(status_code=400, detail=f"config.base_url không hợp lệ: {reason}")


async def validate_seller_base_url(
    url: str,
    *,
    require_resolution: bool = False,
) -> ResolvedTarget | None:
    """Raise HTTPException(400) if `url` is unsafe for the platform to call.

    Call this both when a seller's provider config is written (create/update
    — src/providers/service.py) and again immediately before every outbound
    call (src/adapters/real_api.py::_request_with_retry). The call-time check
    is what actually closes the DNS-rebinding gap: a hostname that resolved
    to a public IP at signup time can be repointed at an internal address
    later by anyone who controls its DNS — which, for a seller's own domain,
    is by definition the seller.
    """
    if not url:
        _reject("thiếu base_url")
        return
    parts = urlsplit(url)
    hostname = parts.hostname
    if not hostname:
        _reject("thiếu host")
        return
    loopback = hostname.lower() in _LOOPBACK_HOSTS
    if loopback and _seller_loopback_allowed():
        if parts.scheme not in _LOCAL_LOOPBACK_SCHEMES:
            _reject("localhost chỉ chấp nhận http(s)")
            return None
        if parts.username is not None or parts.password is not None:
            _reject("không chấp nhận userinfo trong URL")
        if parts.query or parts.fragment:
            _reject("base_url không được chứa query hoặc fragment")
        try:
            parts.port
        except ValueError:
            _reject("cổng không hợp lệ")
            return None
        ip_address = "::1" if hostname == "::1" else "127.0.0.1"
        return ResolvedTarget(hostname=hostname, ip_address=ip_address)
    if parts.scheme not in _ALLOWED_SCHEMES:
        _reject("chỉ chấp nhận https")
        return
    if parts.username is not None or parts.password is not None:
        _reject("không chấp nhận userinfo trong URL")
    if parts.query or parts.fragment:
        _reject("base_url không được chứa query hoặc fragment")
    try:
        port = parts.port
    except ValueError:
        _reject("cổng không hợp lệ")
        return None
    if port not in (None, 443):
        _reject("seller endpoint HTTPS chỉ được dùng cổng 443")

    try:
        literal_ip = ipaddress.ip_address(hostname)
    except ValueError:
        literal_ip = None

    if literal_ip is not None:
        if _is_blocked_ip(str(literal_ip)):
            from src.security.events import security_event
            security_event(
                "ssrf_blocked",
                level="warning",
                host=hostname,
                reason="literal_private_ip",
            )
            _reject(f"trỏ tới địa chỉ nội bộ ({literal_ip})")
        return ResolvedTarget(hostname=hostname, ip_address=str(literal_ip))

    try:
        infos = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(hostname, None),
            timeout=_RESOLVE_TIMEOUT_SECONDS,
        )
    except (socket.gaierror, asyncio.TimeoutError, OSError):
        if require_resolution:
            _reject(f"không thể phân giải host '{hostname}' an toàn")
        return None

    public_ips: list[str] = []
    for info in infos:
        ip_str = info[4][0]
        if _is_blocked_ip(ip_str):
            from src.security.events import security_event
            security_event(
                "ssrf_blocked",
                level="warning",
                host=hostname,
                reason="resolved_private_ip",
            )
            _reject(f"host '{hostname}' phân giải ra địa chỉ nội bộ ({ip_str})")
        if ip_str not in public_ips:
            public_ips.append(ip_str)

    if not public_ips:
        if require_resolution:
            _reject(f"host '{hostname}' không có địa chỉ IP hợp lệ")
        return None
    return ResolvedTarget(hostname=hostname, ip_address=public_ips[0])
