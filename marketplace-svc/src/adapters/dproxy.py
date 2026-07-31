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
from datetime import datetime, timezone
from urllib.parse import urlsplit
from uuid import UUID

import httpx
import structlog
from fastapi import HTTPException

from src.adapters.base import ProvisionResult, ProxyAssignment, RotatableProxyAdapter
from src.adapters.real_api import RealApiAdapter

logger = structlog.get_logger()

# Fixed supplier contract — NOT configurable. An earlier revision let admins
# override `list_path` while rotate-path construction/validation stayed
# hard-coded to this constant, so a custom list_path silently broke rotation
# (list() would work, every parsed rotate_endpoint would fail the exact-match
# check). Per docs/superpowers/plans/2026-07-22-dproxy-review-fixes.md Medium
# A: one fixed contract used everywhere, not a config knob that can drift.
_LIST_PATH = "/api/v1/proxies/user"
_CATALOG_PATH = "/api/v1/catalog"
_PURCHASE_PATH = "/api/v1/proxies/order"
_DEFAULT_ROTATE_METHOD = "POST"
_ALLOWED_AUTH_TYPES = {"bearer", "header"}
_ALLOWED_ROTATE_METHODS = {"GET", "POST", "PUT"}


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
    `rotate_endpoint` in _parse_assignment and to validate the
    buyer-triggered rotate route against the bound external_id.

    Requires `external_id` to be a canonical UUID (the supplied DProxy
    contract's `id` field) — raises ValueError otherwise. This is the
    enforcement point, not just a convention: a slash, `..`, query string,
    or fragment embedded in an unvalidated external_id could otherwise
    redirect this call to a different path on the same provider origin
    (see docs/superpowers/plans/2026-07-22-dproxy-review-fixes.md Blocker 3).
    Every caller — parse-time validation here, and the rotate call itself,
    whether the external_id came fresh off the wire or out of
    ProxyAllocation.external_id in the DB — goes through this same check."""
    canonical = str(UUID(str(external_id)))
    return f"{_LIST_PATH}/{canonical}/rotate"


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
    """Defensively parse one item from GET /api/v1/proxies/user into a
    ProxyAssignment REGARDLESS of whether it's currently usable — status/
    is_active/online/expiry become the `online` flag and `expires_at`
    field, not a filter here. Returns None — never raises — only for
    structurally invalid rows (missing/malformed identity, credentials,
    host/port, or timestamp): a single bad row must not break the whole
    inventory read (that's what DProxyContractError, raised only for a bad
    top-level shape, is for). See review fixes Blocker 2 (two-stage
    parsing: structural validity here, usability via
    ProxyAssignment.is_usable() at each call site) and Blocker 3 (external
    id must be a canonical UUID before it can ever reach a request path)."""
    if not isinstance(item, dict):
        return None
    proxies = item.get("proxies")
    if not isinstance(proxies, dict):
        return None

    raw_external_id = item.get("id")
    username = item.get("username")
    password = item.get("password")
    host = proxies.get("host")
    port_raw = proxies.get("port")
    expires_at = _parse_dt(item.get("expired_at"))

    if not raw_external_id or not username or not password or not host or port_raw is None or expires_at is None:
        return None
    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        return None
    try:
        # Canonicalizes AND rejects anything that isn't a valid UUID —
        # slashes, "..", query strings, excessive length, control
        # characters are all impossible in a value that survives this.
        external_id = str(UUID(str(raw_external_id)))
    except (ValueError, AttributeError, TypeError):
        return None

    status_obj = proxies.get("status")
    online = (
        item.get("status") == "active"
        and item.get("is_active") is True
        and isinstance(status_obj, dict) and status_obj.get("msg") == "online"
    )

    rotation = proxies.get("rotation")
    rotation = rotation if isinstance(rotation, dict) else {}
    rotate_path = rotation.get("rotate_endpoint")
    # Untrusted supplier data — only accept the EXACT path we'd construct
    # ourselves for this external_id, never propagate an unexpected shape
    # (absolute URL, different id, query string, ...) toward the rotate call.
    if rotate_path != expected_rotate_path(external_id):
        rotate_path = None
    cooldown = rotation.get("cooldown_seconds")
    if not isinstance(cooldown, int):
        cooldown = None

    # Descriptive-only metadata — DProxy's real contract has both as
    # nullable (a fresh assignment can carry `"country": null` before the
    # supplier tags it). Never required for a row to parse; absence just
    # means the buyer-facing summary/filter can't use that dimension yet.
    country = proxies.get("country")
    country = country if isinstance(country, str) and country else None
    proxies_type = proxies.get("proxies_type")
    proxy_type = proxies_type.get("name") if isinstance(proxies_type, dict) else None
    proxy_type = proxy_type if isinstance(proxy_type, str) and proxy_type else None

    return ProxyAssignment(
        external_id=external_id,
        proxy_id=proxies.get("proxy_id"),
        host=str(host),
        port=port,
        username=str(username),
        password=str(password),
        public_ip=proxies.get("ip_public"),
        assigned_at=_parse_dt(item.get("assigned_at")),
        expires_at=expires_at,
        online=online,
        rotation_available=bool(rotation.get("available")) and rotate_path is not None,
        rotation_mode=rotation.get("mode"),
        cooldown_seconds=cooldown,
        last_rotated_at=_parse_dt(rotation.get("last_rotated_at")),
        rotate_path=rotate_path,
        country=country,
        proxy_type=proxy_type,
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
    legitimate part of a base_url, just noise or a paste mistake) and
    allowed auth/HTTP methods. `list_path` is intentionally not a config
    option at all (see Medium A) — nothing to validate there."""
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


class DProxyAdapter(RealApiAdapter, RotatableProxyAdapter):
    # provision() mua/bind một proxy thật ở thượng nguồn — nút Test không được gọi.
    provision_has_purchase_side_effect = True

    def __init__(
        self, config: dict, *, db=None, provider_id: int | None = None, seller_owned: bool = False,
    ):
        super().__init__(config, db=db, provider_id=provider_id, seller_owned=seller_owned)
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
        """Returns every structurally-valid assignment from the supplier's
        inventory — online AND offline/inactive/expired alike. Callers that
        only want deliverable ones must filter with
        `ProxyAssignment.is_usable()`; reconciliation deliberately wants the
        unfiltered list (see review fixes Blocker 2)."""
        try:
            resp = await self._request_with_retry(
                "GET", _LIST_PATH, operation="list_assignments", headers=self._headers(),
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

    async def list_catalog(self) -> dict:
        """Advisory only — never raises, never blocks a purchase. A `None`
        for any key means "this DProxy deployment's support for that
        selection dimension is unknown/unsupported", not an error. Contract
        for /api/v1/catalog is assumed (see docs/superpowers/plans/
        2026-07-22-dproxy-integration.md 'Open contract questions'); this
        method's only job is to survive whatever shape actually comes back
        and degrade to "nothing supported" rather than crash the caller
        (check_health, which merges this into the admin-facing health dict)."""
        empty = {"countries": None, "types": None, "durations_days": None}
        try:
            resp = await self._request_with_retry(
                "GET", _CATALOG_PATH, operation="list_catalog", headers=self._headers(),
            )
        except httpx.HTTPError:
            return empty
        if resp.status_code >= 400:
            return empty
        try:
            body = resp.json()
        except ValueError:
            return empty
        if not isinstance(body, dict):
            return empty

        def _str_list(value) -> list[str] | None:
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                return None
            return value or None

        def _int_list(value) -> list[int] | None:
            if not isinstance(value, list) or not all(isinstance(v, int) for v in value):
                return None
            return value or None

        return {
            "countries": _str_list(body.get("countries")),
            "types": _str_list(body.get("types")),
            "durations_days": _int_list(body.get("durations_days")),
        }

    async def purchase_assignment(
        self, *, country: str | None, proxy_type: str | None, duration_days: int, idempotency_key: str,
    ) -> ProxyAssignment:
        """Buys ONE fresh assignment matching the buyer's chosen
        country/type/duration — used by the `config`-strategy path in
        provision(), never by the `credit` (first-available) path. Unlike
        list_assignments, a structurally invalid response here is fatal —
        there's exactly one row and it must parse or the purchase failed."""
        try:
            resp = await self._request_with_retry(
                "POST", _PURCHASE_PATH, operation="purchase_assignment",
                idempotency_key=idempotency_key, headers=self._headers(idempotency_key),
                json={"country": country, "type": proxy_type, "duration_days": duration_days, "quantity": 1},
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
            raise DProxyContractError("Phản hồi mua proxy không phải JSON hợp lệ") from e
        assignment = _parse_assignment(body)
        if assignment is None:
            raise DProxyContractError("Phản hồi mua proxy không đúng định dạng")
        return assignment

    async def rotate_assignment(self, external_id: str) -> ProxyAssignment:
        try:
            path = expected_rotate_path(external_id)
        except ValueError as e:
            # Only reachable if external_id came from somewhere that skipped
            # _parse_assignment's UUID canonicalization (e.g. a tampered DB
            # row) — never let a malformed id reach _request_with_retry.
            raise DProxyContractError(f"external_id không hợp lệ: {external_id!r}") from e

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
        # "type"/"network"/"days" are ConfigPricing's user_config keys (see
        # src/pricing/config_pricing.py) — their presence means the admin
        # configured this product with the `config` strategy and the buyer
        # picked a country/type/duration, which only a fresh on-demand
        # purchase can honor (an existing pool assignment's expiry is fixed
        # at whatever it was when admin bought it). Otherwise this is the
        # `credit` (no-selection) flow, unchanged: pick first-available from
        # the existing pool.
        if "type" in user_config and "network" in user_config and "days" in user_config:
            return await self._provision_via_purchase(order_id, user_config)

        from src.resources.proxy_service import bind_first_available_assignment

        try:
            assignments = await self.list_assignments()
        except DProxyAuthError:
            return ProvisionResult(success=False, error="Sai thông tin xác thực với nhà cung cấp proxy")
        except DProxyContractError:
            return ProvisionResult(success=False, error="Nhà cung cấp proxy trả về dữ liệu không hợp lệ")
        # DProxyUnavailableError intentionally propagates — see class docstring.

        # bind_first_available_assignment gets the FULL (unfiltered) list —
        # it applies is_usable() itself when picking a NEW candidate, and
        # needs the unfiltered list to tell "temporarily offline" apart from
        # "genuinely gone" on an idempotent retry (review fixes Blocker 2).
        allocation = await bind_first_available_assignment(self.provider_id, order_id, assignments, self.db)
        if allocation is None:
            return ProvisionResult(
                success=False, error="Hết proxy khả dụng — vui lòng thử lại sau",
                buyer_message="Sản phẩm tạm hết hàng, vui lòng thử lại sau ít phút.",
            )

        assignment = next((a for a in assignments if a.external_id == allocation.external_id), None)
        if assignment is None:
            # Idempotent retry matched an existing binding whose external_id
            # is no longer in the fresh list at all — never silently
            # substitute a different credential for an order that may
            # already have received the first one.
            return ProvisionResult(success=False, error="Proxy đã cấp không còn khả dụng")

        return ProvisionResult(
            success=True,
            data=assignment.delivered_text(),
            resource_id=assignment.external_id,
            metadata={"provider": "dproxy", "proxy_allocation_id": allocation.id},
        )

    async def _provision_via_purchase(self, order_id: int, user_config: dict) -> ProvisionResult:
        """`config`-strategy path: buy a fresh assignment matching the
        buyer's chosen country/type/duration and bind it exclusively to
        this order. Never buys a second proxy on retry."""
        from src.resources.proxy_service import bind_first_available_assignment, bind_purchased_assignment, get_order_proxy_allocation

        existing = await get_order_proxy_allocation(order_id, self.db)
        if existing is not None:
            # Idempotent retry — bind_first_available_assignment's existing-
            # allocation branch already does exactly the "refresh from a
            # fresh list, never pick a different candidate" dance this needs
            # too; how the original assignment was obtained (purchase vs
            # pool-pick) doesn't matter to that refresh logic.
            try:
                assignments = await self.list_assignments()
            except DProxyAuthError:
                return ProvisionResult(success=False, error="Sai thông tin xác thực với nhà cung cấp proxy")
            except DProxyContractError:
                return ProvisionResult(success=False, error="Nhà cung cấp proxy trả về dữ liệu không hợp lệ")
            allocation = await bind_first_available_assignment(self.provider_id, order_id, assignments, self.db)
            if allocation is None:
                return ProvisionResult(success=False, error="Proxy đã cấp không còn khả dụng")
            assignment = next((a for a in assignments if a.external_id == allocation.external_id), None)
            if assignment is None:
                return ProvisionResult(success=False, error="Proxy đã cấp không còn khả dụng")
            return ProvisionResult(
                success=True, data=assignment.delivered_text(), resource_id=assignment.external_id,
                metadata={"provider": "dproxy", "proxy_allocation_id": allocation.id},
            )

        try:
            assignment = await self.purchase_assignment(
                # DProxy bán theo QUỐC GIA thật (payload nhà cung cấp là
                # "country") — field `network` của ConfigPricing chỉ là tên ô
                # chọn phía buyer. Khác TopProxy, nơi `network` là nhà mạng
                # (loaiproxy) và được mang bằng ProxyAssignment.network.
                country=user_config.get("network"), proxy_type=user_config.get("type"),
                duration_days=int(user_config["days"]), idempotency_key=f"order-{order_id}",
            )
        except DProxyAuthError:
            return ProvisionResult(success=False, error="Sai thông tin xác thực với nhà cung cấp proxy")
        except DProxyContractError:
            return ProvisionResult(success=False, error="Nhà cung cấp proxy trả về dữ liệu không hợp lệ")
        # DProxyUnavailableError intentionally propagates — see class docstring.

        allocation = await bind_purchased_assignment(self.provider_id, order_id, assignment, self.db)
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

        usable = [a for a in assignments if a.is_usable()]
        rotation_capable = sum(1 for a in usable if a.rotation_available)
        earliest_expiry = min((a.expires_at for a in usable), default=None)
        catalog = await self.list_catalog()
        if not usable:
            return {
                "status": "warning", "message": "Không còn proxy khả dụng", "usable": 0,
                "total": len(assignments), **catalog,
            }
        return {
            "status": "healthy",
            "message": f"{len(usable)}/{len(assignments)} proxy khả dụng ({rotation_capable} hỗ trợ đổi IP)",
            "usable": len(usable),
            "total": len(assignments),
            "rotation_capable": rotation_capable,
            "earliest_expiry": earliest_expiry.isoformat() if earliest_expiry else None,
            **catalog,
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
