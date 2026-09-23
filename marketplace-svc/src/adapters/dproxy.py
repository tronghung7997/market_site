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
from src.adapters.supplier import ProxyPlanCatalog, UpstreamListing
from src.config import settings

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
_DISPUTE_PATH = "/api/v1/customer/marketplace/partner-dispute"
_DEFAULT_ROTATE_METHOD = "POST"
# Lệnh mua M2M cấp node thật nên có thể chậm hơn 5s mặc định của
# RealApiAdapter. Timeout ngắn ở đây là NGUY HIỂM chứ không chỉ chậm: timeout
# → retry cùng partner_order_id → nếu DProxy đã fulfill lần đầu thì kết quả
# phụ thuộc hoàn toàn vào việc họ có replay theo partner_order_id hay không
# (chưa verify với live). Kéo dài timeout để hạn chế rơi vào tình huống đó.
_DEFAULT_TIMEOUT_SECONDS = 30.0
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


class DProxyPurchaseRejected(Exception):
    """DProxy trả 4xx cho lệnh mua: hết credit/hạn mức, plan sai, hết hàng,
    trùng partner_order_id... Khác DProxyContractError ở chỗ đây là lỗi VẬN
    HÀNH — không đơn nào sau đó tự khỏi được, admin phải nhìn thấy. Giữ
    status + detail (đã cắt ngắn) để đưa vào alert."""

    def __init__(self, status_code: int, detail: str | None = None):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"HTTP {status_code}" + (f": {detail}" if detail else ""))


def _error_detail(resp: httpx.Response, limit: int = 200) -> str | None:
    """`detail` từ body lỗi FastAPI-style của DProxy, cắt ngắn để đưa vào
    alert/log — không bao giờ lộ nguyên body ra ngoài."""
    try:
        body = resp.json()
    except ValueError:
        return None
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, list):
        detail = "; ".join(str(d.get("msg", d)) if isinstance(d, dict) else str(d) for d in detail)
    if not isinstance(detail, str) or not detail:
        return None
    return detail[:limit]


def default_partner_order_prefix() -> str:
    """Prefix mặc định cho partner_order_id, có tên MÔI TRƯỜNG: staging và
    prod thường dùng chung một tài khoản DProxy, mà order id ở hai DB thì
    trùng nhau (đơn #140 ở cả hai) — nếu DProxy replay theo partner_order_id
    thì prod sẽ nhận đúng proxy staging đã mua. Production giữ `proxora-`
    trần cho gọn; mọi môi trường khác gắn thêm tên. Admin override qua
    config.partner_order_prefix."""
    env = settings.deployment_environment
    return "proxora-" if env == "production" else f"proxora-{env}-"


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


def _parse_purchase_assignment(
    body, *, expected_partner_order_id: str | None = None,
) -> ProxyAssignment | None:
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
    if (
        expected_partner_order_id is not None
        and data.get("partner_order_id") != expected_partner_order_id
    ):
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
                if not isinstance(key, str):
                    raise ValueError
                proxy_type, network, days = key.split("|")
                if not proxy_type or not network or int(days) <= 0:
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


class DProxyAdapter(RealApiAdapter, RotatableProxyAdapter, ProxyPlanCatalog):
    # provision() mua/bind một proxy thật ở thượng nguồn — nút Test không được gọi.
    provision_has_purchase_side_effect = True

    def __init__(
        self, config: dict, *, db=None, provider_id: int | None = None, seller_owned: bool = False,
    ):
        super().__init__(config, db=db, provider_id=provider_id, seller_owned=seller_owned)
        if not config.get("timeout_seconds"):
            self.timeout = _DEFAULT_TIMEOUT_SECONDS
        self.rotate_method = (config.get("rotate_method") or _DEFAULT_ROTATE_METHOD).upper()
        self.auth_type = config.get("auth_type") or "bearer"
        self.auth_header = config.get("auth_header") or "X-API-Key"
        self.plan_id = config.get("plan_id")
        self.plan_ids = config.get("plan_ids") or {}
        self.channel = config.get("channel") or "proxora"
        self.partner_order_prefix = config.get("partner_order_prefix") or default_partner_order_prefix()

    def partner_order_id_for(self, order_id: int) -> str:
        """ID đơn phía sàn gửi cho DProxy — deterministic theo order id để
        retry replay được, và là thứ duy nhất DProxy biết về đơn của mình
        (dùng để partner-dispute / đối soát qua marketplace/orders)."""
        return f"{self.partner_order_prefix}{order_id}"

    @staticmethod
    def is_purchase_config(user_config: dict) -> bool:
        """`config` strategy → mua on-demand qua M2M. `credit` → bind từ pool."""
        return "type" in user_config and "network" in user_config and "days" in user_config

    def _resolve_plan_id(self, user_config: dict) -> str | None:
        selection_key = "|".join(
            str(user_config.get(field, "")) for field in ("type", "network", "days")
        )
        # An explicit matrix is authoritative: silently falling back to a
        # default plan can deliver a different country/type/duration than the
        # buyer paid for.  A single plan_id remains valid for products that do
        # not expose a selection matrix.
        if self.plan_ids:
            return self.plan_ids.get(selection_key)
        return self.plan_id

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

    async def fetch_plan_catalog(self) -> list[UpstreamListing]:
        """Gói M2M (`GET /api/v1/store/plans`, `ProxySalesPlanResponse`) chuẩn
        hoá cho /admin/sources. Giá vốn = `price` khi `currency` là VND; tiền
        khác giữ 0 và để nguyên ở attributes để admin tự quy đổi. DProxy không
        báo tồn theo gói → amount = -1 ("không đếm")."""
        resp = await self._request_with_retry(
            "GET", _CATALOG_PATH, operation="fetch_plan_catalog", headers=self._headers(),
        )
        if resp.status_code in (401, 403):
            raise DProxyAuthError(f"HTTP {resp.status_code}")
        if resp.status_code >= 400:
            raise DProxyUnavailableError(f"HTTP {resp.status_code}")
        try:
            body = resp.json()
        except ValueError as e:
            raise DProxyContractError("Catalog không phải JSON hợp lệ") from e
        if not isinstance(body, list):
            raise DProxyContractError("Catalog gói không phải mảng JSON")
        out: list[UpstreamListing] = []
        for item in body:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not isinstance(item.get("name"), str):
                continue
            currency = str(item.get("currency") or "VND").upper()
            try:
                price = int(round(float(item.get("price") or 0)))
            except (TypeError, ValueError):
                price = 0
            try:
                duration = int(item.get("duration_days") or 0)
            except (TypeError, ValueError):
                duration = 0
            attrs = {
                "duration_days": duration,
                "proxy_count": item.get("proxy_count"),
                "currency": currency,
                "price": item.get("price"),
                "country": item.get("country") or item.get("country_code") or item.get("country_name"),
                "proxy_type": item.get("proxy_type") or item.get("proxies_type") or item.get("type"),
                "is_active": item.get("is_active"),
            }
            label = item["name"] if not duration else f"{item['name']} · {duration} ngày"
            out.append(UpstreamListing(
                external_id=item["id"], name=label,
                cost_price=price if currency == "VND" else 0, amount=-1,
                min_qty=1, max_qty=100, format_hint="ip:port:user:pass",
                category_path=("DProxy", str(attrs["country"] or "")) if attrs["country"] else ("DProxy",),
                attributes={k: v for k, v in attrs.items() if v is not None},
            ))
        return out

    async def purchase_assignment(
        self, *, plan_id: str, partner_order_id: str, order_id: int,
    ) -> ProxyAssignment:
        """Buy exactly one proxy through DProxy's marketplace M2M API."""
        try:
            resp = await self._request_with_retry(
                "POST", _PURCHASE_PATH, operation="purchase_assignment",
                order_id=order_id,
                idempotency_key=partner_order_id, headers=self._headers(partner_order_id),
                json={
                    "partner_order_id": partner_order_id,
                    "plan_id": plan_id,
                    "quantity": 1,
                    "channel": self.channel,
                    "metadata": {"proxora_order_id": str(order_id)},
                },
            )
        except httpx.HTTPError as e:
            raise DProxyUnavailableError(str(e)) from e

        if resp.status_code in (401, 403):
            raise DProxyAuthError(f"HTTP {resp.status_code}")
        if resp.status_code >= 500:
            raise DProxyUnavailableError(f"HTTP {resp.status_code}")
        if resp.status_code >= 400:
            raise DProxyPurchaseRejected(resp.status_code, _error_detail(resp))

        try:
            body = resp.json()
        except ValueError as e:
            raise DProxyContractError("Phản hồi mua proxy không phải JSON hợp lệ") from e
        assignment = _parse_purchase_assignment(
            body, expected_partner_order_id=partner_order_id,
        )
        if assignment is None:
            raise DProxyContractError("Phản hồi mua proxy không đúng định dạng")
        return assignment

    async def dispute_purchase(self, partner_order_id: str, *, reason: str | None = None) -> bool:
        """`POST partner-dispute` — DProxy thu hồi node + hoàn credit cho một
        đơn M2M (docs/dproxy/api.md §"Đi kèm M2M"). Gọi khi sàn đã hoàn tiền
        buyer (dispute refund) hoặc huỷ đơn quá hạn provision mà lệnh mua
        CÓ THỂ đã fulfill (timeout sau khi DProxy cấp node). 404 = DProxy
        không có đơn này → không có gì để thu hồi, coi như xong (True).
        4xx khác → False (admin đối soát tay); auth/5xx raise như mọi call."""
        try:
            resp = await self._request_with_retry(
                "POST", _DISPUTE_PATH, operation="dispute_purchase",
                idempotency_key=f"{partner_order_id}-dispute", headers=self._headers(),
                json={"partner_order_id": partner_order_id, "reason": reason or "marketplace refund"},
            )
        except httpx.HTTPError as e:
            raise DProxyUnavailableError(str(e)) from e
        if resp.status_code in (401, 403):
            raise DProxyAuthError(f"HTTP {resp.status_code}")
        if resp.status_code >= 500:
            raise DProxyUnavailableError(f"HTTP {resp.status_code}")
        if resp.status_code == 404:
            return True
        if resp.status_code >= 400:
            logger.warning(
                "dproxy_dispute_rejected", partner_order_id=partner_order_id,
                status=resp.status_code, detail=_error_detail(resp),
            )
            return False
        return True

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
        if self.is_purchase_config(user_config):
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

    def _purchase_failure(self, e: DProxyPurchaseRejected, order_id: int) -> ProvisionResult:
        """4xx từ lệnh mua là lỗi vận hành: hết credit/hạn mức, plan chưa
        map, hết hàng, trùng partner_order_id (nếu DProxy không replay)...
        Buyer được hoàn tiền như fail thường, nhưng admin PHẢI thấy alert —
        không thì sản phẩm cứ bán, mỗi đơn là một vòng trừ-refund im lặng.
        Nêu partner_order_id để admin đối soát bằng marketplace/orders."""
        partner_order_id = self.partner_order_id_for(order_id)
        return ProvisionResult(
            success=False,
            error=f"DProxy từ chối lệnh mua ({e})",
            operational_error=(
                f"DProxy từ chối lệnh mua cho đơn #{order_id} ({e}). "
                f"Kiểm tra credit/hạn mức (credit-summary), plan_id đã map, và đối soát "
                f"partner_order_id={partner_order_id} trong marketplace/orders."
            ),
            operational_severity="critical",
        )

    async def _provision_via_purchase(self, order_id: int, user_config: dict) -> ProvisionResult:
        """`config`-strategy path: buy a fresh assignment matching the
        buyer's chosen country/type/duration and bind it exclusively to
        this order. Never buys a second proxy on retry: partner_order_id là
        deterministic theo order id, retry (timeout/5xx/sweep) gửi lại đúng
        id đó và DProxy replay — giả định này chưa verify với live, xem
        docs/dproxy/api.md §"Chưa xác minh"."""
        from src.resources.proxy_service import bind_purchased_assignment, get_order_proxy_allocation

        partner_order_id = self.partner_order_id_for(order_id)
        plan_id = self._resolve_plan_id(user_config)
        if not plan_id:
            return ProvisionResult(
                success=False,
                error="Nhà cung cấp DProxy chưa cấu hình plan_id cho lựa chọn này",
                operational_error=(
                    f"Đơn #{order_id}: lựa chọn {user_config.get('type')}|{user_config.get('network')}|"
                    f"{user_config.get('days')} không có plan_id trong config DProxy (plan_ids/plan_id)"
                ),
                operational_severity="critical",
            )

        try:
            assignment = await self.purchase_assignment(
                plan_id=plan_id, partner_order_id=partner_order_id, order_id=order_id,
            )
        except DProxyAuthError:
            return ProvisionResult(
                success=False, error="Sai thông tin xác thực với nhà cung cấp proxy",
                operational_error=f"Đơn #{order_id}: DProxy từ chối API key (401/403)",
            )
        except DProxyPurchaseRejected as e:
            return self._purchase_failure(e, order_id)
        except DProxyContractError:
            return ProvisionResult(success=False, error="Nhà cung cấp proxy trả về dữ liệu không hợp lệ")
        # DProxyUnavailableError intentionally propagates — see class docstring.

        existing = await get_order_proxy_allocation(order_id, self.db)
        if existing is not None:
            # Replay path: an earlier attempt bound the allocation but the
            # order never left `pending` (crash between flush and commit is
            # the only way here — both live in one transaction). The replayed
            # response must be the SAME upstream order, never a substitute.
            if assignment.external_id != existing.external_id:
                return ProvisionResult(
                    success=False, error="Nhà cung cấp proxy trả về sai đơn đã cấp",
                    operational_error=(
                        f"Đơn #{order_id}: DProxy replay partner_order_id={partner_order_id} "
                        f"nhưng trả order_id khác ({assignment.external_id} ≠ {existing.external_id}) — "
                        f"có thể đã mua 2 proxy, đối soát marketplace/orders"
                    ),
                )
            return ProvisionResult(
                success=True, data=assignment.delivered_text(), resource_id=assignment.external_id,
                metadata={"provider": "dproxy", "proxy_allocation_id": existing.id},
            )

        allocation = await bind_purchased_assignment(self.provider_id, order_id, assignment, self.db)
        return ProvisionResult(
            success=True,
            data=assignment.delivered_text(),
            resource_id=assignment.external_id,
            metadata={"provider": "dproxy", "proxy_allocation_id": allocation.id},
        )

    async def check_health(self) -> dict:
        # Catalog TRƯỚC và độc lập với list: tài khoản M2M có thể không có
        # (hoặc không được đọc) inventory ở /proxies/user, nhưng admin vẫn
        # cần catalog để map plan — nếu catalog chỉ được lấy sau khi list
        # thành công thì lỗi list chặn luôn bước map plan trong UI.
        catalog = await self.list_catalog()
        purchase_ready = bool(self.plan_id or self.plan_ids)
        try:
            assignments = await self.list_assignments()
        except DProxyAuthError:
            return {"status": "unhealthy", "message": "Sai thông tin xác thực", **catalog}
        except DProxyUnavailableError:
            return {"status": "unhealthy", "message": "Không thể kết nối nhà cung cấp", **catalog}
        except DProxyContractError:
            return {"status": "unhealthy", "message": "Dữ liệu trả về không hợp lệ", **catalog}

        usable = [a for a in assignments if a.is_usable()]
        rotation_capable = sum(1 for a in usable if a.rotation_available)
        earliest_expiry = min((a.expires_at for a in usable), default=None)
        if not usable:
            # Pool rỗng chỉ là "warning" khi provider bán theo pool (credit).
            # Provider đã map plan mua on-demand thì pool rỗng là bình thường
            # — không được để nó trông như hết hàng.
            if purchase_ready:
                return {
                    "status": "healthy",
                    "message": "Kết nối OK — bán theo lệnh mua M2M (pool trống)",
                    "usable": 0, "total": len(assignments), "purchase_ready": True, **catalog,
                }
            return {
                "status": "warning", "message": "Không còn proxy khả dụng", "usable": 0,
                "total": len(assignments), "purchase_ready": False, **catalog,
            }
        return {
            "status": "healthy",
            "message": f"{len(usable)}/{len(assignments)} proxy khả dụng ({rotation_capable} hỗ trợ đổi IP)",
            "usable": len(usable),
            "total": len(assignments),
            "rotation_capable": rotation_capable,
            "earliest_expiry": earliest_expiry.isoformat() if earliest_expiry else None,
            "purchase_ready": purchase_ready,
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
        """Thu hồi binding. Pool: chỉ release local (không có endpoint xoá
        assignment). Purchase: gọi partner-dispute để DProxy thu node + hoàn
        credit — buyer đã được sàn hoàn tiền thì không được giữ proxy tới
        hết hạn. Trả False khi thượng nguồn từ chối/không liên lạc được để
        caller log cho admin đối soát; binding local vẫn được release."""
        from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationSource
        from src.resources.proxy_service import release_allocation
        from sqlalchemy import select

        allocation = await self.db.scalar(
            select(ProxyAllocation).where(
                ProxyAllocation.provider_id == self.provider_id, ProxyAllocation.external_id == resource_id,
            )
        )
        upstream_ok = True
        if allocation is not None and allocation.source == ProxyAllocationSource.purchase.value:
            try:
                upstream_ok = await self.dispute_purchase(
                    self.partner_order_id_for(allocation.order_id), reason="marketplace refund",
                )
            except (DProxyAuthError, DProxyUnavailableError) as e:
                logger.warning("dproxy_revoke_upstream_failed", order_id=allocation.order_id, error=str(e))
                upstream_ok = False
        await release_allocation(self.provider_id, resource_id, self.db)
        return upstream_ok
