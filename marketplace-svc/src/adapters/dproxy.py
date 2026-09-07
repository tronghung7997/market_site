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
_CATALOG_PATH = "/api/v1/store/plans"
_PURCHASE_PATH = "/api/v1/customer/marketplace/partner-purchase"
_DEFAULT_ROTATE_METHOD = "POST"
_ALLOWED_AUTH_TYPES = {"bearer", "header"}
_ALLOWED_ROTATE_METHODS = {"GET", "POST", "PUT"}


class DProxyContractError(Exception):
    """Supplier response doesn't match the expected status or JSON shape."""


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


def _parse_purchase_assignment(body) -> ProxyAssignment | None:
    """Parse the M2M partner-purchase response documented by DProxy.

    The contract returns an order UUID rather than an assignment UUID, so
    freshly purchased rows are deliberately not marked rotatable.  Using the
    order UUID for a rotate URL would guess at an undocumented relationship.
    """
    if not isinstance(body, dict) or body.get("success") is not True:
        return None
    data = body.get("data")
    if not isinstance(data, dict) or data.get("status") != "fulfilled" or data.get("quantity") != 1:
        return None
    proxies = data.get("proxies")
    if not isinstance(proxies, list) or len(proxies) != 1 or not isinstance(proxies[0], dict):
        return None

    proxy = proxies[0]
    raw_order_id = data.get("order_id")
    host = proxy.get("ip")
    port_raw = proxy.get("port")
    username = proxy.get("username")
    password = proxy.get("password")
    expires_at = _parse_dt(proxy.get("expires_at"))
    if not raw_order_id or not host or port_raw is None or not username or not password or expires_at is None:
        return None
    try:
        external_id = str(UUID(str(raw_order_id)))
        port = int(port_raw)
    except (ValueError, AttributeError, TypeError):
        return None
    if not 1 <= port <= 65535:
        return None

    return ProxyAssignment(
        external_id=external_id,
        proxy_id=None,
        host=str(host),
        port=port,
        username=str(username),
        password=str(password),
        public_ip=str(host),
        assigned_at=datetime.now(timezone.utc),
        expires_at=expires_at,
        online=True,
        rotation_available=False,
        rotation_mode=None,
        cooldown_seconds=None,
        last_rotated_at=None,
        rotate_path=None,
        country=None,
        proxy_type=None,
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

    plan_id = config.get("plan_id")
    if plan_id is not None:
        try:
            UUID(str(plan_id))
        except (ValueError, AttributeError, TypeError) as e:
            raise HTTPException(status_code=400, detail="config.plan_id phải là UUID hợp lệ") from e
    plan_ids = config.get("plan_ids")
    if plan_ids is not None:
        if not isinstance(plan_ids, dict) or not plan_ids:
            raise HTTPException(status_code=400, detail="config.plan_ids phải là object không rỗng")
        try:
            for key, value in plan_ids.items():
                if not isinstance(key, str) or not key:
                    raise ValueError
                UUID(str(value))
        except (ValueError, AttributeError, TypeError) as e:
            raise HTTPException(status_code=400, detail="Mỗi giá trị config.plan_ids phải là UUID hợp lệ") from e

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
        self.plan_id = config.get("plan_id")
        self.plan_ids = config.get("plan_ids") or {}
        self.channel = config.get("channel") or "proxora"

    def _resolve_plan_id(self, user_config: dict) -> str | None:
        selection_key = "|".join(
            str(user_config.get(field, "")) for field in ("type", "network", "days")
        )
        return self.plan_ids.get(selection_key) or self.plan_id

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
        """Return the live M2M sales plans as advisory health metadata."""
        empty = {"plans": None}
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
        if not isinstance(body, list):
            return empty
        plans = [
            {key: item.get(key) for key in ("id", "name", "proxy_count", "duration_days", "price", "currency")}
            for item in body
            if isinstance(item, dict) and isinstance(item.get("id"), str) and isinstance(item.get("name"), str)
        ]
        return {"plans": plans or None}

    async def purchase_assignment(
        self, *, plan_id: str, partner_order_id: str,
    ) -> ProxyAssignment:
        """Buy exactly one proxy through DProxy's marketplace M2M API."""
        try:
            resp = await self._request_with_retry(
                "POST", _PURCHASE_PATH, operation="purchase_assignment",
                idempotency_key=partner_order_id, headers=self._headers(partner_order_id),
                json={
                    "partner_order_id": partner_order_id,
                    "plan_id": plan_id,
                    "quantity": 1,
                    "channel": self.channel,
                    "metadata": {
                        "proxora_order_id": partner_order_id.removeprefix("proxora-").removeprefix("order-")
                    },
                },
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
        assignment = _parse_purchase_assignment(body)
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
            plan_id = self._resolve_plan_id(user_config)
            if not plan_id:
                raise DProxyContractError("Nhà cung cấp DProxy chưa cấu hình plan_id")
            assignment = await self.purchase_assignment(
                plan_id=plan_id, partner_order_id=f"proxora-{order_id}",
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
