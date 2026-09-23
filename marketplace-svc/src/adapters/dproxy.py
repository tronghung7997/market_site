"""DProxy — admin-curated rotatable proxy provider. See
docs/superpowers/specs/2026-07-22-dproxy-integration.md.

Subclasses RealApiAdapter purely for its HTTP mechanics (retry/backoff,
Idempotency-Key, ProviderCallLog tracing) — provision()/check_health()/
get_usage()/revoke() are fully overridden here with DProxy's own contract;
none of RealApiAdapter's `/provision` response-shape assumptions carry over.
Same pattern SellerTaskWebhookAdapter already uses for its own supplier
contract.

dproxy is admin-curated only (never added to SELLER_ALLOWED_ADAPTER_TYPES,
see src/providers/schemas.py). /admin/sources may make an INTERNAL seller the
owner of the provider, but the config stays admin-authored, so the factory
builds it with `seller_owned=False` (src/adapters/factory.py::_seller_owned) —
the SSRF call-time guard in RealApiAdapter only applies to seller-supplied
config; DProxy's base_url is validated separately at config-write time
(validate_dproxy_config below, wired into src/providers/service.py).

Live contract notes (probe with a real key, 2026-09-23) that differ from the
vendor docx are in docs/dproxy-go-live-plan.md §2 and drive _parse_purchase.
"""
import re
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
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
_QUOTE_PATH = "/api/v1/store/quote"
_CREDIT_PATH = "/api/v1/customer/marketplace/credit-summary"
_DEFAULT_ROTATE_METHOD = "POST"
# Lệnh mua M2M cấp node thật nên có thể chậm hơn 5s mặc định của
# RealApiAdapter. Timeout ngắn ở đây là NGUY HIỂM chứ không chỉ chậm: timeout
# → retry cùng partner_order_id → nếu DProxy đã fulfill lần đầu thì kết quả
# phụ thuộc hoàn toàn vào việc họ có replay theo partner_order_id hay không
# (chưa verify với live). Kéo dài timeout để hạn chế rơi vào tình huống đó.
_DEFAULT_TIMEOUT_SECONDS = 30.0
_ALLOWED_AUTH_TYPES = {"bearer", "header"}
# Proxy giao ra phải còn hạn ít nhất bằng số ngày buyer đã mua, trừ đi độ
# lệch này (DProxy tính hạn từ lúc cấp node, không phải lúc sàn nhận đơn).
_DEFAULT_EXPIRY_TOLERANCE_HOURS = 6
# `proxies_type_id` của /store/plans (live 2026-09-23). Loại khác → mã số.
PROXY_TYPE_BY_ID = {1: "residential", 2: "mobile", 4: "datacenter"}
# 4xx của lệnh mua mang nghĩa "hết tiền/hạn mức" — mã thật chưa quan sát
# được, nên nhận cả 402 lẫn chữ trong detail (vi + en).
_OUT_OF_CREDIT_RE = re.compile(r"credit|hạn mức|han muc|số dư|so du|insufficient|balance|debt|công nợ", re.I)
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


@dataclass(frozen=True)
class DProxyPurchase:
    """Một lệnh partner-purchase đã được chấp nhận."""

    assignment: ProxyAssignment
    # `data.order_id` — live trả null (2026-09-23), docx trả UUID.
    upstream_order_id: str | None
    cost_usd: Decimal | None


class DProxyPurchaseViolation(Exception):
    """HTTP 2xx nhưng thứ DProxy giao KHÔNG được phép tới tay buyer: sai
    shape, sai partner_order_id, proxy đã hết hạn/ngắn hơn số ngày đã bán,
    hoặc assignment đang thuộc đơn khác. Khác DProxyContractError của list/
    rotate ở chỗ lệnh mua CÓ THỂ đã tiêu credit — caller phải xếp lệnh
    partner-dispute và báo admin, không được chỉ hoàn tiền rồi im lặng."""


def _uuid_or_none(value) -> str | None:
    if not value:
        return None
    try:
        return str(UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        return None


def _parse_purchase(
    body, *, expected_partner_order_id: str | None = None, min_expires_at: datetime | None = None,
) -> DProxyPurchase:
    """Parse the M2M partner-purchase response.

    Chấp nhận cả hai shape đã thấy:
    - docx nhà cung cấp: `data.order_id` UUID, `status: fulfilled`, proxy
      không có id riêng;
    - live 2026-09-23: `data.success`, `order_id: null`, KHÔNG có `status`,
      `proxies[].assignment_id`, `total_cost_usd`.

    Identity của allocation là `assignment_id` khi có (node xuất hiện trong
    /proxies/user dưới đúng id đó → reconcile/rotate được), không thì
    `order_id`. Không có cả hai → vi phạm: không có gì để đối soát.

    Live còn trả một assignment ĐÃ HẾT HẠN của chính tài khoản cho gói đang
    hết hàng, kèm success=true — nên `min_expires_at` là bắt buộc ở đường mua
    thật: proxy hết hạn sớm hơn số ngày buyer trả tiền không bao giờ được giao.
    """
    if not isinstance(body, dict) or body.get("success") is not True:
        raise DProxyPurchaseViolation("success != true")
    data = body.get("data")
    if not isinstance(data, dict) or data.get("success") is False:
        raise DProxyPurchaseViolation("data không hợp lệ hoặc data.success=false")
    if "status" in data and data.get("status") != "fulfilled":
        raise DProxyPurchaseViolation(f"status={data.get('status')!r}")
    if "quantity" in data and data.get("quantity") != 1:
        raise DProxyPurchaseViolation(f"quantity={data.get('quantity')!r}")
    if expected_partner_order_id is not None and data.get("partner_order_id") != expected_partner_order_id:
        raise DProxyPurchaseViolation("partner_order_id không khớp")
    proxies = data.get("proxies")
    if not isinstance(proxies, list) or len(proxies) != 1 or not isinstance(proxies[0], dict):
        raise DProxyPurchaseViolation("cần đúng 1 proxy")

    proxy = proxies[0]
    upstream_order_id = _uuid_or_none(data.get("order_id"))
    external_id = _uuid_or_none(proxy.get("assignment_id")) or upstream_order_id
    host = proxy.get("ip")
    port_raw = proxy.get("port")
    username = proxy.get("username")
    password = proxy.get("password")
    expires_at = _parse_dt(proxy.get("expires_at"))
    if not external_id:
        raise DProxyPurchaseViolation("thiếu assignment_id lẫn order_id")
    if not host or port_raw is None or not username or not password or expires_at is None:
        raise DProxyPurchaseViolation("thiếu host/port/username/password/expires_at")
    try:
        port = int(port_raw)
    except (ValueError, TypeError):
        raise DProxyPurchaseViolation("port không hợp lệ") from None
    if not 1 <= port <= 65535:
        raise DProxyPurchaseViolation("port không hợp lệ")
    if min_expires_at is not None and expires_at < min_expires_at:
        raise DProxyPurchaseViolation(
            f"proxy hết hạn {expires_at.isoformat()} — sớm hơn hạn đã bán ({min_expires_at.isoformat()})"
        )

    cost_usd = None
    raw_cost = data.get("total_cost_usd")
    if isinstance(raw_cost, (int, float)) and not isinstance(raw_cost, bool) and raw_cost >= 0:
        try:
            cost_usd = Decimal(str(raw_cost))
        except InvalidOperation:
            cost_usd = None

    assignment = ProxyAssignment(
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
        # Response mua không mang khối rotation — đọc lại từ /proxies/user
        # (DProxyAdapter._with_inventory_rotation), không bao giờ đoán.
        rotation_available=False,
        rotation_mode=None,
        cooldown_seconds=None,
        last_rotated_at=None,
        rotate_path=None,
        country=None,
        proxy_type=None,
    )
    return DProxyPurchase(assignment=assignment, upstream_order_id=upstream_order_id, cost_usd=cost_usd)


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

    for key, low, high in (("timeout_seconds", 5, 60), ("expiry_tolerance_hours", 0, 72), ("low_credit_usd", 0, 100_000)):
        value = config.get(key)
        if value in (None, ""):
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"config.{key} phải là số") from None
        if not low <= number <= high:
            raise HTTPException(status_code=400, detail=f"config.{key} phải trong khoảng {low}–{high}")


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
        try:
            tolerance = float(config.get("expiry_tolerance_hours", _DEFAULT_EXPIRY_TOLERANCE_HOURS))
        except (TypeError, ValueError):
            tolerance = _DEFAULT_EXPIRY_TOLERANCE_HOURS
        self.expiry_tolerance = timedelta(hours=tolerance)
        # Hai lệnh đọc phụ quanh lệnh mua, cùng mặc định bật:
        # - hỏi /store/quote trước lần mua ĐẦU TIÊN — live bán "thành công" một
        #   gói hết hàng bằng proxy cũ đã hết hạn, nên hết hàng phải bị chặn
        #   trước khi mua chứ không đợi tới lúc từ chối response;
        # - đọc /proxies/user sau khi mua để biết node có đổi IP được không
        #   (response mua không mang khối rotation).
        self.precheck_availability = config.get("precheck_availability", True) is not False
        self.enrich_rotation = config.get("enrich_rotation", True) is not False

    def partner_order_id_for(self, order_id: int) -> str:
        """ID đơn phía sàn gửi cho DProxy — deterministic theo order id để
        retry replay được, và là thứ duy nhất DProxy biết về đơn của mình.
        Sau khi mua, id này được chốt lên ProxyAllocation.partner_order_id —
        thu hồi luôn đọc bản đã chốt, không tính lại từ prefix hiện hành."""
        return f"{self.partner_order_prefix}{order_id}"

    @staticmethod
    def is_purchase_config(user_config: dict) -> bool:
        """`config` strategy → mua on-demand qua M2M. `credit` → bind từ pool.
        orders/service truyền `pricing_strategy` của SẢN PHẨM vào provision
        config — khi có, nó quyết định; buyer tự thêm type/network/days vào
        user_config của sản phẩm `credit` không được mở đường mua."""
        strategy = user_config.get("pricing_strategy")
        if strategy is not None:
            return strategy == "config"
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

    def _raise_for_read_status(self, resp: httpx.Response) -> None:
        if resp.status_code in (401, 403):
            raise DProxyAuthError(f"HTTP {resp.status_code}")
        if resp.status_code >= 500:
            raise DProxyUnavailableError(f"HTTP {resp.status_code}")
        if resp.status_code >= 400:
            raise DProxyContractError(f"HTTP {resp.status_code}")

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
        self._raise_for_read_status(resp)

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

    async def quote_plan(self, plan_id: str) -> dict | None:
        """`POST /api/v1/store/quote` — báo giá + tồn cho MỘT proxy của gói,
        không tạo đơn, không trừ credit (live 2026-09-23). None khi không
        hỏi được (lỗi mạng/quyền/shape): tồn chỉ là thông tin tham khảo,
        không bao giờ chặn một lệnh mua vì quote hỏng."""
        try:
            resp = await self._request_with_retry(
                "POST", _QUOTE_PATH, operation="quote_plan", headers=self._headers(),
                json={"plan_id": plan_id, "quantity": 1},
            )
        except httpx.HTTPError:
            return None
        if resp.status_code >= 400:
            return None
        try:
            body = resp.json()
        except ValueError:
            return None
        if isinstance(body, dict) and isinstance(body.get("data"), dict) and "available" not in body:
            body = body["data"]
        if not isinstance(body, dict) or not isinstance(body.get("available"), bool):
            return None
        count = body.get("available_count")
        return {
            "available": body["available"],
            "available_count": count if isinstance(count, int) and not isinstance(count, bool) else None,
            "unit_price": body.get("unit_price") if isinstance(body.get("unit_price"), (int, float)) else None,
            "currency": str(body.get("currency") or "USD").upper(),
        }

    async def credit_summary(self) -> dict:
        """`GET credit-summary` — hạn mức trả sau của tài khoản partner. Shape
        live 2026-09-23: balance_usd, credit_limit_usd, available_spending_usd,
        current_debt_usd, is_credit_active. Raise như mọi lệnh đọc."""
        try:
            resp = await self._request_with_retry(
                "GET", _CREDIT_PATH, operation="credit_summary", headers=self._headers(),
            )
        except httpx.HTTPError as e:
            raise DProxyUnavailableError(str(e)) from e
        self._raise_for_read_status(resp)
        try:
            body = resp.json()
        except ValueError as e:
            raise DProxyContractError("credit-summary không phải JSON hợp lệ") from e
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            raise DProxyContractError("credit-summary thiếu data")

        def _num(key: str) -> float | None:
            value = data.get(key)
            return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None

        available = _num("available_spending_usd")
        if available is None:
            raise DProxyContractError("credit-summary thiếu available_spending_usd")
        return {
            "balance_usd": _num("balance_usd"),
            "credit_limit_usd": _num("credit_limit_usd"),
            "available_spending_usd": available,
            "current_debt_usd": _num("current_debt_usd"),
            "is_credit_active": data.get("is_credit_active") is not False,
        }

    async def fetch_plan_catalog(self) -> list[UpstreamListing]:
        """Gói M2M (`GET /api/v1/store/plans`) chuẩn hoá cho /admin/sources.

        Live 2026-09-23: giá là USD, loại proxy chỉ có `proxies_type_id`
        (1 residential, 2 mobile, 4 datacenter), `country_id` null, thời hạn cố
        định theo gói (lệnh mua không có tham số số ngày). Giá vốn VND KHÔNG
        tính ở đây — tầng đồng bộ quy đổi bằng tỷ giá hiển thị của sàn
        (src/suppliers/service.py), adapter chỉ giữ số gốc trong attributes.
        Tồn lấy từ /store/quote (available_count); không hỏi được → -1."""
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
            if not isinstance(item, dict) or _uuid_or_none(item.get("id")) is None or not isinstance(item.get("name"), str):
                continue
            plan_id = str(UUID(item["id"]))
            currency = str(item.get("currency") or "USD").upper()
            price = item.get("price") if isinstance(item.get("price"), (int, float)) else None
            try:
                duration = int(item.get("duration_days") or 0)
            except (TypeError, ValueError):
                duration = 0
            type_id = item.get("proxies_type_id")
            proxy_type = PROXY_TYPE_BY_ID.get(type_id) if isinstance(type_id, int) else None
            nested_type = item.get("proxies_type")
            if proxy_type is None and isinstance(nested_type, dict) and isinstance(nested_type.get("name"), str):
                proxy_type = nested_type["name"]
            quote = await self.quote_plan(plan_id)
            available_count = quote.get("available_count") if quote else None
            amount = -1
            if quote is not None:
                amount = available_count if available_count is not None else (1 if quote["available"] else 0)
            attrs = {
                "duration_days": duration,
                "proxy_count": item.get("proxy_count"),
                "currency": currency,
                "price": price,
                "proxy_type": proxy_type,
                "proxies_type_id": type_id,
                "country_id": item.get("country_id"),
                "service_type_id": item.get("service_type_id"),
                "ip_version_id": item.get("ip_version_id"),
                "min_quantity": item.get("min_quantity"),
                "max_quantity": item.get("max_quantity"),
                "is_active": item.get("is_active"),
                "available": quote["available"] if quote else None,
            }
            label = item["name"] if not duration else f"{item['name']} · {duration} ngày"
            out.append(UpstreamListing(
                external_id=plan_id, name=label,
                cost_price=int(round(price)) if currency == "VND" and price is not None else 0, amount=amount,
                min_qty=1, max_qty=1, format_hint="ip:port:user:pass",
                category_path=("DProxy", proxy_type) if proxy_type else ("DProxy",),
                attributes={k: v for k, v in attrs.items() if v is not None},
            ))
        return out

    async def purchase_assignment(
        self, *, plan_id: str, partner_order_id: str, order_id: int, min_expires_at: datetime | None = None,
    ) -> DProxyPurchase:
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
            raise DProxyPurchaseViolation("phản hồi mua không phải JSON") from e
        return _parse_purchase(body, expected_partner_order_id=partner_order_id, min_expires_at=min_expires_at)

    async def dispute_purchase(self, partner_order_id: str, *, reason: str | None = None) -> str:
        """`POST partner-dispute` — DProxy thu hồi node + hoàn credit cho một
        đơn M2M. Trả kết quả để outbox ghi lại:
        - "revoked": 2xx;
        - "not_found": 404 (live: "Không tìm thấy đơn hàng đối tác cần khiếu
          nại.") — DProxy không có đơn này, không có gì để thu hồi;
        - "rejected": 4xx khác — admin đối soát tay.
        Auth/5xx/mạng raise như mọi call để outbox thử lại."""
        try:
            resp = await self._request_with_retry(
                "POST", _DISPUTE_PATH, operation="dispute_purchase",
                idempotency_key=f"{partner_order_id}-dispute", headers=self._headers(f"{partner_order_id}-dispute"),
                json={"partner_order_id": partner_order_id, "reason": reason or "marketplace refund"},
            )
        except httpx.HTTPError as e:
            raise DProxyUnavailableError(str(e)) from e
        if resp.status_code in (401, 403):
            raise DProxyAuthError(f"HTTP {resp.status_code}")
        if resp.status_code >= 500:
            raise DProxyUnavailableError(f"HTTP {resp.status_code}")
        if resp.status_code == 404:
            return "not_found"
        if resp.status_code >= 400:
            logger.warning(
                "dproxy_dispute_rejected", partner_order_id=partner_order_id,
                status=resp.status_code, detail=_error_detail(resp),
            )
            return "rejected"
        return "revoked"

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
        # `config` strategy (buyer chọn loại/nhà mạng/số ngày) chỉ đáp ứng được
        # bằng một lệnh mua mới; `credit` (không chọn gì) bind proxy rảnh từ
        # pool có sẵn của tài khoản.
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
        """4xx từ lệnh mua là lỗi vận hành: hết credit/hạn mức, plan sai, hết
        hàng... Buyer được hoàn tiền như fail thường, nhưng admin PHẢI thấy
        alert. Riêng hết tiền/hạn mức: không đơn nào sau đó thành công được →
        tắt provider (provider_out_of_credit) thay vì mỗi đơn một vòng
        trừ-hoàn im lặng."""
        partner_order_id = self.partner_order_id_for(order_id)
        out_of_credit = e.status_code == 402 or bool(e.detail and _OUT_OF_CREDIT_RE.search(e.detail))
        return ProvisionResult(
            success=False,
            error=f"DProxy từ chối lệnh mua ({e})",
            operational_error=(
                f"DProxy từ chối lệnh mua cho đơn #{order_id} ({e}). "
                f"Kiểm tra credit/hạn mức (credit-summary), plan_id đã map, và đối soát "
                f"partner_order_id={partner_order_id} trong marketplace/orders."
            ),
            operational_severity="critical",
            provider_out_of_credit=out_of_credit,
        )

    async def _with_inventory_rotation(self, assignment: ProxyAssignment) -> ProxyAssignment:
        """Node vừa mua có trong /proxies/user dưới đúng assignment_id (live
        2026-09-23) — đọc khối rotation thật ở đó để bật/tắt nút đổi IP theo
        đúng node được giao. Best-effort: không đọc được thì giữ
        rotation_available=False, không bao giờ làm hỏng đơn đã mua xong."""
        if not self.enrich_rotation:
            return assignment
        try:
            inventory = await self.list_assignments()
        except (DProxyAuthError, DProxyUnavailableError, DProxyContractError) as e:
            logger.info("dproxy_rotation_lookup_skipped", external_id=assignment.external_id, error=str(e))
            return assignment
        match = next((a for a in inventory if a.external_id == assignment.external_id), None)
        if match is None:
            return assignment
        return replace(
            assignment,
            proxy_id=match.proxy_id,
            public_ip=match.public_ip or assignment.public_ip,
            rotation_available=match.rotation_available,
            rotation_mode=match.rotation_mode,
            cooldown_seconds=match.cooldown_seconds,
            last_rotated_at=match.last_rotated_at,
            rotate_path=match.rotate_path,
            country=match.country,
            proxy_type=match.proxy_type,
        )

    async def _violation(
        self, order_id: int, partner_order_id: str, reason: str, *, upstream_may_have_charged: bool = True,
    ) -> ProvisionResult:
        """DProxy trả 2xx nhưng thứ họ giao không được phép tới tay buyer.
        Buyer được hoàn tiền (caller), lệnh partner-dispute được xếp CÙNG
        transaction hoàn tiền để DProxy thu node + hoàn credit, và admin nhận
        alert critical có đủ id để đối soát."""
        from src.resources.proxy_service import enqueue_upstream_revocation

        queued = False
        if upstream_may_have_charged and self.provider_id is not None:
            await enqueue_upstream_revocation(
                self.provider_id, order_id, partner_order_id, "purchase_violation", self.db,
            )
            queued = True
        return ProvisionResult(
            success=False,
            error=f"DProxy giao hàng không hợp lệ: {reason}",
            buyer_message="Rất tiếc, hệ thống chưa cấp được proxy hợp lệ cho gói này nên đơn đã được huỷ.",
            operational_error=(
                f"Đơn #{order_id}: DProxy trả thành công nhưng proxy không hợp lệ ({reason}). "
                f"Đã hoàn tiền buyer"
                + (f", đã xếp partner-dispute partner_order_id={partner_order_id}" if queued else "")
                + ". Đối soát credit-summary / marketplace/orders bên DProxy."
            ),
            operational_severity="critical",
        )

    async def _is_first_purchase_attempt(self, order_id: int) -> bool:
        """Chỉ lần mua đầu mới được hỏi tồn: một lần trước có thể đã được
        DProxy fulfill (timeout sau khi cấp node) và lấy đúng node cuối cùng —
        quote lúc retry sẽ báo hết hàng và làm mình bỏ một đơn đã tiêu tiền.
        Mỗi lần gọi lệnh mua đều có một dòng ProviderCallLog riêng."""
        from sqlalchemy import select

        from src.models.provider import ProviderCallLog

        if self.db is None:
            return False
        previous = await self.db.scalar(
            select(ProviderCallLog.id).where(
                ProviderCallLog.order_id == order_id, ProviderCallLog.operation == "purchase_assignment",
            ).limit(1)
        )
        return previous is None

    async def _provision_via_purchase(self, order_id: int, user_config: dict) -> ProvisionResult:
        """`config`-strategy path: buy a fresh assignment matching the
        buyer's chosen plan and bind it exclusively to this order. Never buys
        a second proxy on retry: partner_order_id là deterministic theo order
        id và DProxy replay đúng response cũ khi gửi trùng (live 2026-09-23)."""
        from src.resources.proxy_service import (
            bind_purchased_assignment, find_allocation_by_external_id, get_order_proxy_allocation,
        )

        existing = await get_order_proxy_allocation(order_id, self.db)
        partner_order_id = (
            existing.partner_order_id if existing is not None and existing.partner_order_id
            else self.partner_order_id_for(order_id)
        )
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

        if existing is None and self.precheck_availability and await self._is_first_purchase_attempt(order_id):
            quote = await self.quote_plan(plan_id)
            if quote is not None and quote["available"] is False:
                return ProvisionResult(
                    success=False,
                    error=f"DProxy báo gói {plan_id} hết hàng (store/quote)",
                    buyer_message="Gói này tạm hết hàng, vui lòng thử lại sau hoặc chọn gói khác.",
                    operational_error=(
                        f"Đơn #{order_id}: gói DProxy {plan_id} hết hàng theo store/quote — "
                        f"tạm ẩn gói hoặc đổi nguồn."
                    ),
                    operational_severity="warning",
                )

        try:
            days = int(user_config.get("days") or 0)
        except (TypeError, ValueError):
            days = 0
        now = datetime.now(timezone.utc)
        # Proxy phải còn sống ít nhất số ngày buyer trả tiền (trừ độ lệch),
        # và không bao giờ đã hết hạn.
        min_expires_at = (now + timedelta(days=days) - self.expiry_tolerance) if days > 0 else now
        min_expires_at = max(min_expires_at, now)

        try:
            purchase = await self.purchase_assignment(
                plan_id=plan_id, partner_order_id=partner_order_id, order_id=order_id,
                min_expires_at=min_expires_at,
            )
        except DProxyAuthError:
            return ProvisionResult(
                success=False, error="Sai thông tin xác thực với nhà cung cấp proxy",
                operational_error=f"Đơn #{order_id}: DProxy từ chối API key (401/403)",
            )
        except DProxyPurchaseRejected as e:
            return self._purchase_failure(e, order_id)
        except DProxyPurchaseViolation as e:
            return await self._violation(order_id, partner_order_id, str(e))
        # DProxyUnavailableError intentionally propagates — see class docstring.

        assignment = purchase.assignment
        if existing is not None:
            # Replay path: an earlier attempt bound the allocation but the
            # order never left `pending`. The replayed response must be the
            # SAME upstream node, never a substitute (bản ghi cũ có thể giữ
            # order UUID thay vì assignment UUID).
            same = {assignment.external_id, purchase.upstream_order_id} & {existing.external_id}
            if not same:
                return await self._violation(
                    order_id, partner_order_id,
                    f"replay trả node khác ({assignment.external_id} ≠ {existing.external_id}) — có thể đã mua 2 proxy",
                )
            return ProvisionResult(
                success=True, data=assignment.delivered_text(), resource_id=existing.external_id,
                metadata={"provider": "dproxy", "proxy_allocation_id": existing.id},
            )

        holder = await find_allocation_by_external_id(self.provider_id, assignment.external_id, self.db)
        if holder is not None and holder.order_id != order_id:
            # Live đã trả lại một assignment có sẵn của tài khoản cho lệnh mua
            # mới — node đó đang/đã thuộc đơn khác thì tuyệt đối không giao.
            return await self._violation(
                order_id, partner_order_id,
                f"assignment {assignment.external_id} đang thuộc đơn #{holder.order_id}",
            )

        assignment = await self._with_inventory_rotation(assignment)
        allocation = await bind_purchased_assignment(
            self.provider_id, order_id, assignment, self.db,
            partner_order_id=partner_order_id, upstream_order_id=purchase.upstream_order_id,
            cost_usd=purchase.cost_usd,
        )
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
        try:
            credit = {"credit": await self.credit_summary()}
        except (DProxyAuthError, DProxyUnavailableError, DProxyContractError):
            credit = {"credit": None}
        purchase_ready = bool(self.plan_id or self.plan_ids)
        try:
            assignments = await self.list_assignments()
        except DProxyAuthError:
            if purchase_ready and catalog.get("plans"):
                # Key chỉ có quyền M2M: mua được (catalog đọc được) dù không
                # đọc được inventory — đổi IP sẽ không bật được.
                return {
                    "status": "warning",
                    "message": "Mua M2M sẵn sàng; key không đọc được danh sách proxy nên không bật được đổi IP",
                    "purchase_ready": True, **catalog, **credit,
                }
            return {"status": "unhealthy", "message": "Sai thông tin xác thực", **catalog, **credit}
        except DProxyUnavailableError:
            return {"status": "unhealthy", "message": "Không thể kết nối nhà cung cấp", **catalog, **credit}
        except DProxyContractError:
            return {"status": "unhealthy", "message": "Dữ liệu trả về không hợp lệ", **catalog, **credit}

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
                    "usable": 0, "total": len(assignments), "purchase_ready": True, **catalog, **credit,
                }
            return {
                "status": "warning", "message": "Không còn proxy khả dụng", "usable": 0,
                "total": len(assignments), "purchase_ready": False, **catalog, **credit,
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
            **credit,
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
        assignment). Purchase: release local + XẾP lệnh partner-dispute vào
        outbox (upstream_revocation_job gửi sau commit, có retry + alert) —
        không gọi HTTP trong transaction hoàn tiền đang giữ lock. Luôn trả
        True: việc còn lại thuộc về outbox."""
        from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationSource
        from src.resources.proxy_service import enqueue_upstream_revocation, release_allocation
        from sqlalchemy import select

        allocation = await self.db.scalar(
            select(ProxyAllocation).where(
                ProxyAllocation.provider_id == self.provider_id, ProxyAllocation.external_id == resource_id,
            )
        )
        if allocation is not None and allocation.source == ProxyAllocationSource.purchase.value:
            await enqueue_upstream_revocation(
                self.provider_id, allocation.order_id,
                allocation.partner_order_id or self.partner_order_id_for(allocation.order_id),
                "refund", self.db,
            )
        await release_allocation(self.provider_id, resource_id, self.db)
        return True
