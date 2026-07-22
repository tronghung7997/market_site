"""DProxy — admin-curated rotatable proxy provider. See
docs/superpowers/specs/2026-07-22-dproxy-integration.md.

Subclasses RealApiAdapter purely for its HTTP mechanics (retry/backoff,
Idempotency-Key, ProviderCallLog tracing) — provision()/check_health()/
get_usage()/revoke() are fully overridden here with DProxy's own contract;
none of RealApiAdapter's `/provision` response-shape assumptions carry over.
Same pattern SellerTaskWebhookAdapter already uses for its own supplier
contract.

dproxy is admin-curated only (never added to SELLER_ALLOWED_ADAPTER_TYPES,
see src/providers/schemas.py) so `seller_owned` is always False when built —
the SSRF call-time guard in RealApiAdapter only applies to seller-supplied
config; DProxy's base_url is admin-authored and validated separately at
config-write time (validate_dproxy_config below, wired into
src/providers/service.py).
"""
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx
import structlog
from fastapi import HTTPException

from src.adapters.base import ProvisionResult, ProxyAssignment, RotatableProxyAdapter
from src.adapters.real_api import RealApiAdapter

logger = structlog.get_logger()

_DEFAULT_LIST_PATH = "/api/v1/proxies/user"
_DEFAULT_ROTATE_METHOD = "POST"
_ALLOWED_AUTH_TYPES = {"bearer", "header"}
_ALLOWED_ROTATE_METHODS = {"GET", "POST", "PUT"}
_RELATIVE_PATH_RE = re.compile(r"^/[A-Za-z0-9/_\-.]*$")


class DProxyContractError(Exception):
    """Supplier response doesn't match the expected shape (bad status code,
    non-JSON body, top-level object isn't a list)."""


class DProxyAuthError(Exception):
    """Supplier rejected our credentials (401/403) — never worth retrying
    automatically, an admin has to fix the provider config."""


class DProxyUnavailableError(Exception):
    """Transient: network error or 5xx from the supplier. Safe to retry —
    left to propagate out of provision() so the existing
    provision_sweep_job retry/deadline machinery (src/scheduler.py) picks
    it up unchanged, same as any other RealApiAdapter subclass."""


def expected_rotate_path(external_id: str) -> str:
    """The only rotate path this adapter will ever call for a given
    assignment — reused both to validate the supplier-returned
    `rotate_endpoint` in _parse_assignment and, in Task 5, to validate the
    buyer-triggered rotate route against the bound external_id. `external_id`
    is expected to already be an opaque supplier-issued token (UUID in the
    sample contract); still built with urlsplit-safe string formatting only,
    never interpolated into a path with separators trusted."""
    return f"{_DEFAULT_LIST_PATH}/{external_id}/rotate"


def _parse_dt(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_assignment(item) -> ProxyAssignment | None:
    """Defensively parse one item from GET /api/v1/proxies/user. Returns
    None — never raises — for anything malformed, inactive, offline, or
    expired: a single bad row must not break the whole inventory read
    (that's what DProxyContractError, raised only for a bad top-level shape,
    is for)."""
    if not isinstance(item, dict):
        return None
    proxies = item.get("proxies")
    if not isinstance(proxies, dict):
        return None

    external_id = item.get("id")
    username = item.get("username")
    password = item.get("password")
    host = proxies.get("host")
    port_raw = proxies.get("port")
    expires_at = _parse_dt(item.get("expired_at"))

    if not external_id or not username or not password or not host or port_raw is None or expires_at is None:
        return None
    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        return None

    status_obj = proxies.get("status")
    online = isinstance(status_obj, dict) and status_obj.get("msg") == "online"
    if item.get("status") != "active" or item.get("is_active") is not True or not online:
        return None
    if expires_at <= datetime.now(timezone.utc):
        return None

    rotation = proxies.get("rotation")
    rotation = rotation if isinstance(rotation, dict) else {}
    rotate_path = rotation.get("rotate_endpoint")
    # Untrusted supplier data — only accept the EXACT path we'd construct
    # ourselves for this external_id, never propagate an unexpected shape
    # (absolute URL, different id, query string, ...) toward the rotate
    # endpoint in Task 5.
    if rotate_path != expected_rotate_path(str(external_id)):
        rotate_path = None
    cooldown = rotation.get("cooldown_seconds")
    if not isinstance(cooldown, int):
        cooldown = None

    return ProxyAssignment(
        external_id=str(external_id),
        proxy_id=proxies.get("proxy_id"),
        host=str(host),
        port=port,
        username=str(username),
        password=str(password),
        public_ip=proxies.get("ip_public"),
        assigned_at=_parse_dt(item.get("assigned_at")),
        expires_at=expires_at,
        rotation_available=bool(rotation.get("available")) and rotate_path is not None,
        rotation_mode=rotation.get("mode"),
        cooldown_seconds=cooldown,
        last_rotated_at=_parse_dt(rotation.get("last_rotated_at")),
        rotate_path=rotate_path,
    )


async def validate_dproxy_config(config: dict) -> None:
    """Admin-authoring validation for adapter_type=dproxy, wired into
    src/providers/service.py create_provider/update_provider.

    Deliberately does NOT reject http:// or loopback/private addresses —
    admin-created providers are trusted input, same boundary
    scripts/mock_seller.py already relies on for seller_gateway/
    seller_task_webhook (http://localhost:PORT during local dev). The
    SSRF guard (src/security/ssrf_guard.py) exists to stop UNTRUSTED
    seller-supplied config, not admin-authored config; applying it here
    would just break docs/dproxy-mock-runbook.md's documented
    http://127.0.0.1:9200 workflow for no real security benefit — an
    admin who wants to attack their own infrastructure doesn't need to
    go through this form to do it.

    What IS validated: structural hygiene independent of that trust
    boundary — credentials/query/fragment embedded in the URL (never a
    legitimate part of a base_url, just noise or a paste mistake),
    allowed auth/HTTP methods, and a relative-only list_path."""
    base_url = config.get("base_url") or ""
    parts = urlsplit(base_url)
    if parts.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="config.base_url phải dùng http hoặc https")
    if not parts.hostname:
        raise HTTPException(status_code=400, detail="config.base_url thiếu host")
    if parts.username or parts.password:
        raise HTTPException(status_code=400, detail="config.base_url không được chứa thông tin đăng nhập")
    if parts.query or parts.fragment:
        raise HTTPException(status_code=400, detail="config.base_url không được chứa query string hoặc fragment")

    auth_type = config.get("auth_type") or "bearer"
    if auth_type not in _ALLOWED_AUTH_TYPES:
        raise HTTPException(
            status_code=400, detail=f"auth_type phải là một trong: {', '.join(sorted(_ALLOWED_AUTH_TYPES))}",
        )
    if auth_type == "header" and not config.get("auth_header"):
        raise HTTPException(status_code=400, detail="auth_type=header yêu cầu config.auth_header")

    rotate_method = (config.get("rotate_method") or _DEFAULT_ROTATE_METHOD).upper()
    if rotate_method not in _ALLOWED_ROTATE_METHODS:
        raise HTTPException(
            status_code=400, detail=f"rotate_method phải là một trong: {', '.join(sorted(_ALLOWED_ROTATE_METHODS))}",
        )

    list_path = config.get("list_path") or _DEFAULT_LIST_PATH
    if not _RELATIVE_PATH_RE.match(list_path) or ".." in list_path:
        raise HTTPException(status_code=400, detail="list_path phải là đường dẫn tương đối hợp lệ, không chứa '..'")


class DProxyAdapter(RealApiAdapter, RotatableProxyAdapter):
    def __init__(self, config: dict, *, db, provider_id: int | None = None):
        super().__init__(config, provider_id=provider_id, seller_owned=False)
        self.db = db
        self.list_path = config.get("list_path") or _DEFAULT_LIST_PATH
        self.rotate_method = (config.get("rotate_method") or _DEFAULT_ROTATE_METHOD).upper()
        self.auth_type = config.get("auth_type") or "bearer"
        self.auth_header = config.get("auth_header") or "X-API-Key"

    def _headers(self, idempotency_key: str | None = None) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            if self.auth_type == "header":
                headers[self.auth_header] = self.api_key
            else:
                headers["Authorization"] = f"Bearer {self.api_key}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    async def list_assignments(self) -> list[ProxyAssignment]:
        try:
            resp = await self._request_with_retry(
                "GET", self.list_path, operation="list_assignments", headers=self._headers(),
            )
        except httpx.HTTPError as e:
            raise DProxyUnavailableError(str(e)) from e

        if resp.status_code in (401, 403):
            raise DProxyAuthError(f"HTTP {resp.status_code}")
        if resp.status_code >= 500:
            raise DProxyUnavailableError(f"HTTP {resp.status_code}")
        if resp.status_code >= 400:
            raise DProxyContractError(f"HTTP {resp.status_code}")

        try:
            body = resp.json()
        except ValueError as e:
            raise DProxyContractError("Phản hồi không phải JSON hợp lệ") from e
        if not isinstance(body, list):
            raise DProxyContractError("Phản hồi list assignments không phải mảng JSON")

        return [a for item in body if (a := _parse_assignment(item)) is not None]

    async def rotate_assignment(self, external_id: str) -> ProxyAssignment:
        path = expected_rotate_path(external_id)
        try:
            resp = await self._request_with_retry(
                self.rotate_method, path, operation="rotate_assignment", headers=self._headers(),
            )
        except httpx.HTTPError as e:
            raise DProxyUnavailableError(str(e)) from e

        if resp.status_code in (401, 403):
            raise DProxyAuthError(f"HTTP {resp.status_code}")
        if resp.status_code >= 500:
            raise DProxyUnavailableError(f"HTTP {resp.status_code}")
        if resp.status_code >= 400 or 300 <= resp.status_code < 400:
            # The client (RealApiAdapter._request_with_retry) never follows
            # redirects — a 3xx here means the supplier tried to redirect the
            # rotate call somewhere we didn't validate. Treat exactly like
            # any other unexpected status: a provider error, never followed.
            raise DProxyContractError(f"HTTP {resp.status_code}")

        # Authoritative new state (new IP, refreshed expiry/rotation flags)
        # comes from re-listing, not from the rotate response body — the
        # supplier contract doesn't guarantee the rotate call itself returns
        # the updated assignment.
        assignments = await self.list_assignments()
        for a in assignments:
            if a.external_id == external_id:
                return a
        raise DProxyContractError("Không tìm thấy assignment sau khi rotate")

    # --- ProviderAdapter (admin curation lifecycle) ---

    async def provision(self, order_id: int, user_config: dict) -> ProvisionResult:
        from src.resources.proxy_service import bind_first_available_assignment

        try:
            assignments = await self.list_assignments()
        except DProxyAuthError:
            return ProvisionResult(success=False, error="Sai thông tin xác thực với nhà cung cấp proxy")
        except DProxyContractError:
            return ProvisionResult(success=False, error="Nhà cung cấp proxy trả về dữ liệu không hợp lệ")
        # DProxyUnavailableError intentionally propagates — see class docstring.

        allocation = await bind_first_available_assignment(self.provider_id, order_id, assignments, self.db)
        if allocation is None:
            return ProvisionResult(success=False, error="Hết proxy khả dụng — vui lòng thử lại sau")

        assignment = next((a for a in assignments if a.external_id == allocation.external_id), None)
        if assignment is None:
            # Idempotent retry matched an existing binding whose external_id
            # is no longer in the fresh list (bind_first_available_assignment
            # already flagged it `error`) — never silently substitute a
            # different credential for an order that may already have
            # received the first one.
            return ProvisionResult(success=False, error="Proxy đã cấp không còn khả dụng")

        return ProvisionResult(
            success=True,
            data=assignment.delivered_text(),
            resource_id=assignment.external_id,
            metadata={"provider": "dproxy", "proxy_allocation_id": allocation.id},
        )

    async def check_health(self) -> dict:
        try:
            assignments = await self.list_assignments()
        except DProxyAuthError:
            return {"status": "unhealthy", "message": "Sai thông tin xác thực"}
        except DProxyUnavailableError:
            return {"status": "unhealthy", "message": "Không thể kết nối nhà cung cấp"}
        except DProxyContractError:
            return {"status": "unhealthy", "message": "Dữ liệu trả về không hợp lệ"}

        usable = len(assignments)
        rotation_capable = sum(1 for a in assignments if a.rotation_available)
        earliest_expiry = min((a.expires_at for a in assignments), default=None)
        if usable == 0:
            return {"status": "warning", "message": "Không còn proxy khả dụng", "usable": 0}
        return {
            "status": "healthy",
            "message": f"{usable} proxy khả dụng ({rotation_capable} hỗ trợ đổi IP)",
            "usable": usable,
            "rotation_capable": rotation_capable,
            "earliest_expiry": earliest_expiry.isoformat() if earliest_expiry else None,
        }

    async def get_usage(self, resource_id: str) -> dict | None:
        assignments = await self.list_assignments()
        for a in assignments:
            if a.external_id == resource_id:
                return {
                    "external_id": a.external_id,
                    "public_ip": a.public_ip,
                    "expires_at": a.expires_at.isoformat(),
                    "rotation_available": a.rotation_available,
                }
        return None

    async def revoke(self, resource_id: str) -> bool:
        from src.resources.proxy_service import release_allocation

        await release_allocation(self.provider_id, resource_id, self.db)
        return True
