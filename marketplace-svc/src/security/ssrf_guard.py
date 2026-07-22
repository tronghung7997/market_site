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

DNS resolution failures fail OPEN (validation is skipped, the actual
request is left to fail on its own connection error) rather than closed — a
host that can't be resolved can't be connected to either way, so blocking
here would add nothing but false positives (every *.example.com fixture the
test suite uses is unresolvable in a sandboxed CI network). Only a
*successful* resolution to a disallowed address is treated as a finding.
"""

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

from fastapi import HTTPException

_ALLOWED_SCHEMES = {"https"}
_RESOLVE_TIMEOUT_SECONDS = 2.0


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


async def validate_seller_base_url(url: str) -> None:
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
    if parts.scheme not in _ALLOWED_SCHEMES:
        _reject("chỉ chấp nhận https")
        return
    hostname = parts.hostname
    if not hostname:
        _reject("thiếu host")
        return

    try:
        literal_ip = ipaddress.ip_address(hostname)
    except ValueError:
        literal_ip = None

    if literal_ip is not None:
        if _is_blocked_ip(str(literal_ip)):
            _reject(f"trỏ tới địa chỉ nội bộ ({literal_ip})")
        return

    try:
        infos = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(hostname, None),
            timeout=_RESOLVE_TIMEOUT_SECONDS,
        )
    except (socket.gaierror, asyncio.TimeoutError, OSError):
        return  # unresolvable — nothing to protect, the real request will fail too

    for info in infos:
        ip_str = info[4][0]
        if _is_blocked_ip(ip_str):
            _reject(f"host '{hostname}' phân giải ra địa chỉ nội bộ ({ip_str})")
            return
