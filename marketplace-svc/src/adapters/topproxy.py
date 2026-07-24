"""TopProxy.vn — nhà cung cấp proxy thật (tĩnh + key xoay). Contract thật
được chốt từ tài liệu chính thức, xem
docs/superpowers/specs/2026-07-23-topproxy-research.md.

Kế thừa RealApiAdapter theo đúng pattern DProxyAdapter: chỉ lấy hạ tầng chung
(ProviderCallLog, cấu trúc config/base_url/api_key mã hoá), còn toàn bộ wire
format là của TopProxy:

- Auth bằng query param `key=...` (KHÔNG phải Bearer header).
- Envelope `{"status": <int>}`: 100 = OK; 101 sai key, 102 hết Xu, 103 hết
  hàng, 104 không xác định, 201 giao thiếu số lượng.
- KHÔNG có Idempotency-Key phía TopProxy → mọi lệnh MUA đi qua `_call_once`
  (đúng một attempt, không auto-retry như RealApiAdapter._request_with_retry).
  Idempotency tự chế cho proxy tĩnh: `user` của proxy đặt bằng marker
  `od{order_id}` — retry sau timeout sẽ tìm marker này trong listproxy.php
  trước khi dám mua lại. Key xoay không có chỗ nhét marker nên một kết quả
  mua không rõ ràng (timeout) FAIL LUÔN thay vì retry — thà refund buyer và
  để admin đối soát còn hơn âm thầm mua trùng key.

`config` trên Provider row:
    base_url      https://topproxy.vn (bắt buộc)
    api_key       key API TopProxy (mã hoá at rest như mọi provider khác)
    mode          "static" | "xoay" — một tài khoản TopProxy dùng chung key
                  cho cả hai, nhưng tách 2 provider row để sản phẩm gắn đúng
                  hành vi provision.
    xoay_get_url  (chỉ mode=xoay) URL get proxy cho buyer, mặc định
                  https://proxyxoay.shop/api/get.php — dev trỏ vào mock.
"""
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import httpx
import structlog
from fastapi import HTTPException

from src.adapters.base import ProvisionResult, ProxyAssignment
from src.adapters.call_log import record_provider_call
from src.adapters.real_api import RealApiAdapter

logger = structlog.get_logger()

_MUA_PATH = "/apiv2/muaproxy.php"
_LIST_PATH = "/apiv2/listproxy.php"
_XOAY_LIST_PATH = "/proxyxoay/apigetkeyxoay.php"
# TopProxy bán key xoay theo 3 ĐƠN VỊ kỳ hạn (ngày/tuần/tháng), mỗi đơn vị
# một endpoint, `thoigian` = SỐ đơn vị (web ?home=proxyxoay: "Tuần sử dụng"=2
# → apimuatuan với thoigian=2). Chọn đơn vị lớn nhất chia hết số ngày để
# hưởng giá bậc thang tốt nhất (3.000/ngày từ 30 ngày, 4.000 từ 7 ngày,
# 5.000 dưới 7 ngày — trước giảm giá).
_XOAY_DAY_PATH = "/proxyxoay/apimuangay.php"
_XOAY_WEEK_PATH = "/proxyxoay/apimuatuan.php"
_XOAY_MONTH_PATH = "/proxyxoay/apimuathang.php"


def _xoay_endpoint(days: int) -> tuple[str, int] | None:
    """days → (purchase_path, thoigian). None nếu days < 1."""
    if days < 1:
        return None
    if days % 30 == 0:
        return _XOAY_MONTH_PATH, days // 30
    if days % 7 == 0:
        return _XOAY_WEEK_PATH, days // 7
    return _XOAY_DAY_PATH, days
_DEFAULT_XOAY_GET_URL = "https://proxyxoay.shop/api/get.php"

# Giá trị `loaiproxy` hợp lệ theo tài liệu apiv2 — cũng chính là các key máy
# mà pricing_params.network_mult của sản phẩm phải dùng (seed_topproxy.py).
STATIC_LOAIPROXY = {
    "Viettel", "FPT", "VNPT", "US",
    "DatacenterA", "DatacenterB", "DatacenterC",
    "GoiViettel", "GoiVNPT", "GoiFPT", "GoiDATACENTER",
    "4Gvinaphone",
}
_STATIC_TYPES = {"HTTP", "SOCKS5"}

# Nội bộ (admin log) — được nhắc TopProxy.
_ERROR_MESSAGES = {
    101: "Sai API key TopProxy — kiểm tra cấu hình provider",
    102: "Tài khoản TopProxy hết Xu — admin cần nạp thêm",
    103: "TopProxy đang hết hàng loại này — vui lòng thử lại sau",
    104: "TopProxy trả về lỗi không xác định",
    201: "TopProxy giao thiếu số lượng",
}

# Buyer thấy (white-label) — không lộ nguồn hàng, không nhắc "admin"/"key".
# None → dùng thông báo huỷ chung (orders/service.py). Chỉ ca hết hàng (103)
# là thông tin buyer cần biết cụ thể để chọn lại; các lỗi vận hành khác đều
# quy về "không cấp phát được, đã hoàn tiền".
_BUYER_MESSAGES = {
    103: "Sản phẩm tạm hết hàng, vui lòng thử loại/khu vực khác hoặc quay lại sau.",
}


def _buyer_message_for(status) -> str | None:
    return _BUYER_MESSAGES.get(status)


class TopProxyContractError(Exception):
    """Response không đúng shape tài liệu (không phải JSON, thiếu field)."""


class TopProxyUnavailableError(Exception):
    """Transient (network/5xx). Với proxy tĩnh được phép propagate để
    provision_sweep_job retry — marker `od{order_id}` bảo đảm retry không
    mua trùng. Với key xoay KHÔNG BAO GIỜ propagate từ lệnh mua (xem
    _provision_xoay)."""


def _order_marker(order_id: int) -> str:
    return f"od{order_id}"


def _extract_mua_row(body, marker: str) -> dict | None:
    """Chuẩn hoá response của muaproxy.php về MỘT dict proxy.

    Tài liệu ghi trả về object `{status:100,...}`, nhưng endpoint THẬT trả về
    một MẢNG `[{...}]` (giống listproxy.php) — quan sát trực tiếp 2026-07-24,
    đây là nguyên nhân "TopProxy trả về dữ liệu không hợp lệ" dù đã mua & trừ
    Xu. Chấp nhận cả hai dạng. Nếu là mảng nhiều phần tử (soluong>1, dù mình
    ép =1) ưu tiên đúng con mang marker username, không thì lấy con đầu status=100.
    Trả None nếu không tìm được row hợp lệ (để caller báo lỗi rõ ràng)."""
    rows = []
    if isinstance(body, dict):
        rows = [body]
    elif isinstance(body, list):
        rows = [r for r in body if isinstance(r, dict)]
    if not rows:
        return None
    for r in rows:
        parsed = _parse_proxy_string(r.get("proxy") or "")
        if parsed and parsed[2] == marker:
            return r
    ok = [r for r in rows if r.get("status") == 100]
    return ok[0] if ok else rows[0]


def _parse_proxy_string(proxy_str: str) -> tuple[str, int, str, str] | None:
    """"ip:port:user:pass" → (ip, port, user, pass). None nếu không đúng dạng."""
    parts = (proxy_str or "").split(":")
    if len(parts) != 4:
        return None
    ip, port_raw, user, password = parts
    try:
        port = int(port_raw)
    except ValueError:
        return None
    if not ip or not user:
        return None
    return ip, port, user, password


async def validate_topproxy_config(config: dict) -> None:
    """Chặn config hỏng ngay lúc admin lưu provider (wired vào
    src/providers/service.py, cùng chỗ với validate_dproxy_config)."""
    base_url = (config.get("base_url") or "").strip()
    scheme = urlsplit(base_url).scheme
    if scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="TopProxy: base_url phải là http(s) URL")
    if not config.get("api_key"):
        raise HTTPException(status_code=400, detail="TopProxy: bắt buộc có config.api_key")
    mode = (config.get("mode") or "static").lower()
    if mode not in ("static", "xoay"):
        raise HTTPException(status_code=400, detail="TopProxy: mode phải là 'static' hoặc 'xoay'")
    xoay_get_url = config.get("xoay_get_url")
    if xoay_get_url and urlsplit(xoay_get_url).scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="TopProxy: xoay_get_url phải là http(s) URL")


class TopProxyAdapter(RealApiAdapter):
    def __init__(self, config: dict, *, db, provider_id: int | None = None):
        super().__init__(config, provider_id=provider_id, seller_owned=False)
        self.db = db
        self.mode = (config.get("mode") or "static").lower()
        self.xoay_get_url = config.get("xoay_get_url") or _DEFAULT_XOAY_GET_URL

    # ------------------------------------------------------------------
    # HTTP — auth bằng query param, KHÔNG kế thừa Bearer/_request_with_retry
    # cho lệnh mua (không idempotent phía TopProxy).
    # ------------------------------------------------------------------

    def _q(self, **params) -> dict:
        return {"key": self.api_key or "", **{k: v for k, v in params.items() if v is not None}}

    async def _call_once(self, path: str, params: dict, *, operation: str, order_id: int | None = None):
        """Đúng MỘT attempt. Trả về JSON đã parse (dict hoặc list). Network
        error / 5xx → TopProxyUnavailableError; body không phải JSON →
        TopProxyContractError. Mỗi attempt ghi một dòng provider_call_logs
        (path không chứa query — key không bao giờ lọt vào log)."""
        started = time.perf_counter()
        status_code: int | None = None
        error: str | None = None
        resp: httpx.Response | None = None
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
                resp = await client.get(f"{self.base_url}{path}", params=params)
                status_code = resp.status_code
        except httpx.HTTPError as e:
            error = str(e)
        finally:
            await record_provider_call(
                provider_id=self.provider_id,
                order_id=order_id,
                operation=operation,
                method="GET",
                path=path,
                attempt=1,
                status_code=status_code,
                latency_ms=int((time.perf_counter() - started) * 1000),
                success=status_code is not None and status_code < 400,
                error=error,
                idempotency_key=None,
            )
        if resp is None or resp.status_code >= 500:
            raise TopProxyUnavailableError(error or f"HTTP {status_code}")
        try:
            return resp.json()
        except ValueError as e:
            raise TopProxyContractError(f"Body không phải JSON: {e}") from e

    # ------------------------------------------------------------------
    # Provision
    # ------------------------------------------------------------------

    async def provision(self, order_id: int, user_config: dict) -> ProvisionResult:
        from src.resources.proxy_service import get_order_proxy_allocation

        quantity = user_config.get("quantity", 1)
        if quantity != 1:
            # orders/service.py đã chặn từ trước khi trừ tiền; đây là tuyến hai.
            return ProvisionResult(success=False, error="TopProxy chỉ hỗ trợ số lượng 1 mỗi đơn")

        existing = await get_order_proxy_allocation(order_id, self.db)
        if existing is not None:
            return await self._redeliver(existing)

        if self.mode == "xoay":
            return await self._provision_xoay(order_id, user_config)
        return await self._provision_static(order_id, user_config)

    async def _provision_static(self, order_id: int, user_config: dict) -> ProvisionResult:
        from src.resources.proxy_service import bind_purchased_assignment

        loaiproxy = user_config.get("network")
        proxy_type = user_config.get("type") or "HTTP"
        try:
            days = int(user_config.get("days") or 0)
        except (TypeError, ValueError):
            days = 0
        if loaiproxy not in STATIC_LOAIPROXY:
            return ProvisionResult(success=False, error=f"Loại proxy không hợp lệ: {loaiproxy!r}")
        if proxy_type not in _STATIC_TYPES:
            return ProvisionResult(success=False, error=f"Type phải là HTTP hoặc SOCKS5, nhận {proxy_type!r}")
        if days < 1:
            return ProvisionResult(success=False, error="Số ngày sử dụng không hợp lệ")

        marker = _order_marker(order_id)

        # Đối soát TRƯỚC khi mua: một attempt trước đó có thể đã mua thành
        # công nhưng chết trước khi ghi allocation (timeout sau khi TopProxy
        # đã trừ Xu). Marker username là dấu vết duy nhất tìm lại được.
        row = await self._find_static_by_marker(loaiproxy, marker, order_id)
        if row is None:
            body = await self._call_once(
                _MUA_PATH,
                self._q(
                    loaiproxy=loaiproxy, soluong=1, ngay=days, type=proxy_type,
                    user=marker, password=secrets.token_urlsafe(8),
                ),
                operation="muaproxy", order_id=order_id,
            )
            # Lỗi nghiệp vụ (status != 100) trả về dạng object với chỉ field
            # status; giao dịch thành công trả về MẢNG proxy. Bắt lỗi trước:
            # một object có "status" != 100 nghĩa là chưa mua được.
            if isinstance(body, dict) and body.get("status") not in (100, None):
                status = body.get("status")
                return ProvisionResult(
                    success=False,
                    error=_ERROR_MESSAGES.get(status, f"TopProxy trả mã lỗi {status}"),
                    buyer_message=_buyer_message_for(status),
                )
            row = _extract_mua_row(body, marker)
            if row is None:
                # KHÔNG parse được nhưng có thể ĐÃ MUA (trừ Xu) — đối soát lại
                # bằng marker qua listproxy trước khi kết luận, tránh mất tiền
                # vì một shape lạ (review sự cố 2026-07-24: order 79/81).
                row = await self._find_static_by_marker(loaiproxy, marker, order_id)
                if row is None:
                    return ProvisionResult(
                        success=False,
                        error="TopProxy trả về dữ liệu không hợp lệ — chưa xác nhận mua được",
                    )

        assignment = self._assignment_from_row(row, fallback_days=days, proxy_type=proxy_type, network=loaiproxy)
        if assignment is None:
            return ProvisionResult(success=False, error="TopProxy trả về proxy không đúng định dạng")

        allocation = await bind_purchased_assignment(self.provider_id, order_id, assignment, self.db)
        return ProvisionResult(
            success=True,
            data=assignment.delivered_text(),
            resource_id=assignment.external_id,
            metadata={"provider": "topproxy", "proxy_allocation_id": allocation.id},
        )

    async def _provision_xoay(self, order_id: int, user_config: dict) -> ProvisionResult:
        from src.resources.proxy_service import bind_purchased_assignment

        try:
            days = int(user_config.get("days") or 0)
        except (TypeError, ValueError):
            days = 0
        endpoint = _xoay_endpoint(days)
        if endpoint is None:
            return ProvisionResult(
                success=False,
                error=f"Kỳ hạn key xoay không hợp lệ: {days} ngày",
            )
        path, thoigian = endpoint

        try:
            body = await self._call_once(
                path, self._q(thoigian=thoigian, soluong=1), operation="mua_keyxoay", order_id=order_id,
            )
        except TopProxyUnavailableError as e:
            # KHÔNG propagate: không có marker để đối soát key xoay, để
            # sweeper retry là rủi ro mua trùng. Fail → refund buyer, admin
            # đối soát với TopProxy bằng apigetkeyxoay/lịch sử tiêu Xu.
            logger.error("topproxy_xoay_purchase_unclear", order_id=order_id, error=str(e))
            return ProvisionResult(
                success=False,
                error="Không xác nhận được kết quả mua key xoay — admin cần đối soát TopProxy trước khi thử lại",
            )

        if not isinstance(body, dict):
            return ProvisionResult(success=False, error="TopProxy trả về dữ liệu không hợp lệ")
        status = body.get("status")
        if status != 100:
            return ProvisionResult(
                success=False, error=_ERROR_MESSAGES.get(status, f"TopProxy trả mã lỗi {status}"),
                buyer_message=_buyer_message_for(status),
            )
        keyxoay = body.get("keyxoay")
        if not keyxoay or not isinstance(keyxoay, str):
            return ProvisionResult(success=False, error="TopProxy không trả về key xoay")

        expires_at = datetime.now(timezone.utc) + timedelta(days=days)
        host = urlsplit(self.xoay_get_url).hostname or "proxyxoay.shop"
        assignment = ProxyAssignment(
            external_id=keyxoay, proxy_id=None, host=host, port=443,
            username="", password="", public_ip=None, assigned_at=datetime.now(timezone.utc),
            expires_at=expires_at, online=True, rotation_available=False, rotation_mode=None,
            cooldown_seconds=None, last_rotated_at=None, rotate_path=None,
            country=None, proxy_type="xoay",
        )
        allocation = await bind_purchased_assignment(self.provider_id, order_id, assignment, self.db)
        return ProvisionResult(
            success=True,
            data=self._xoay_delivered_text(keyxoay, expires_at),
            resource_id=keyxoay,
            metadata={"provider": "topproxy", "proxy_allocation_id": allocation.id},
        )

    def _xoay_delivered_text(self, keyxoay: str, expires_at: datetime) -> str:
        return "\n".join([
            f"Key xoay: {keyxoay}",
            f"Lấy proxy mới (đổi IP): GET {self.xoay_get_url}?key={keyxoay}&nhamang=Random&tinhthanh=0",
            "Tham số nhamang: Random | viettel | fpt | vnpt (chọn mỗi lần lấy)",
            "Giới hạn nhà cung cấp: IP sống 15–30 phút, đổi IP tối thiểu 60 giây",
            f"Hết hạn: {expires_at.isoformat()}",
        ])

    # ------------------------------------------------------------------
    # Idempotent re-delivery + reconcile helpers
    # ------------------------------------------------------------------

    async def _redeliver(self, allocation) -> ProvisionResult:
        """Order đã có binding (retry của sweeper sau khi attempt trước ghi
        được allocation nhưng chết trước khi order chuyển trạng thái)."""
        if self.mode == "xoay":
            return ProvisionResult(
                success=True,
                data=self._xoay_delivered_text(allocation.external_id, allocation.expires_at),
                resource_id=allocation.external_id,
                metadata={"provider": "topproxy", "proxy_allocation_id": allocation.id},
            )
        row = await self._fetch_static_row(allocation.external_id)
        if row is None:
            return ProvisionResult(success=False, error="Proxy đã cấp không còn tra cứu được trên TopProxy")
        assignment = self._assignment_from_row(row, fallback_days=0, proxy_type=None, network=None)
        if assignment is None:
            return ProvisionResult(success=False, error="TopProxy trả về proxy không đúng định dạng")
        return ProvisionResult(
            success=True, data=assignment.delivered_text(), resource_id=assignment.external_id,
            metadata={"provider": "topproxy", "proxy_allocation_id": allocation.id},
        )

    async def _fetch_static_row(self, idproxy: str) -> dict | None:
        body = await self._call_once(
            _LIST_PATH, self._q(idproxy=idproxy), operation="listproxy",
        )
        if isinstance(body, list):
            for item in body:
                if isinstance(item, dict) and str(item.get("idproxy")) == str(idproxy):
                    return item
            return None
        if isinstance(body, dict) and body.get("status") == 100:
            return body
        return None

    async def _find_static_by_marker(self, loaiproxy: str, marker: str, order_id: int) -> dict | None:
        body = await self._call_once(
            _LIST_PATH, self._q(loaiproxy=loaiproxy, idproxy="all"),
            operation="listproxy", order_id=order_id,
        )
        rows = body if isinstance(body, list) else []
        for item in rows:
            if not isinstance(item, dict):
                continue
            parsed = _parse_proxy_string(item.get("proxy") or "")
            if parsed and parsed[2] == marker:
                return item
        return None

    def _assignment_from_row(
        self, row: dict, *, fallback_days: int, proxy_type: str | None, network: str | None,
    ) -> ProxyAssignment | None:
        parsed = _parse_proxy_string(row.get("proxy") or "")
        if parsed is None:
            # muaproxy.php trả field rời (ip/port/user/password) — thử đường đó
            ip, port_raw = row.get("ip"), row.get("port")
            user, password = row.get("user"), row.get("password")
            if not ip or port_raw is None or not user:
                return None
            try:
                parsed = (str(ip), int(port_raw), str(user), str(password or ""))
            except (TypeError, ValueError):
                return None
        ip, port, user, password = parsed

        external_id = row.get("idproxy")
        if external_id is None:
            return None

        expires_at: datetime | None = None
        raw_time = row.get("time")
        if isinstance(raw_time, (int, float)) and raw_time > 0:
            try:
                expires_at = datetime.fromtimestamp(raw_time, tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                expires_at = None
        if expires_at is None or expires_at <= datetime.now(timezone.utc):
            # `time` theo tài liệu là epoch, nhưng không được tin mù — fallback
            # về ngày mua + số ngày buyer trả tiền.
            expires_at = datetime.now(timezone.utc) + timedelta(days=max(fallback_days, 1))

        return ProxyAssignment(
            external_id=str(external_id), proxy_id=None, host=ip, port=port,
            username=user, password=password, public_ip=ip,
            assigned_at=datetime.now(timezone.utc), expires_at=expires_at,
            online=True, rotation_available=False, rotation_mode=None,
            cooldown_seconds=None, last_rotated_at=None, rotate_path=None,
            country=network, proxy_type=proxy_type or row.get("type"),
        )

    # ------------------------------------------------------------------
    # Health / usage / revoke
    # ------------------------------------------------------------------

    async def check_health(self) -> dict:
        try:
            if self.mode == "xoay":
                body = await self._call_once(_XOAY_LIST_PATH, self._q(), operation="check_health")
            else:
                body = await self._call_once(
                    _LIST_PATH, self._q(loaiproxy="Viettel", idproxy="all"), operation="check_health",
                )
        except (TopProxyUnavailableError, TopProxyContractError) as e:
            return {"status": "unhealthy", "message": f"Không kết nối được TopProxy: {e}"}
        if isinstance(body, dict) and body.get("status") == 101:
            return {"status": "unhealthy", "message": _ERROR_MESSAGES[101]}
        return {"status": "healthy", "mode": self.mode}

    async def get_usage(self, resource_id: str) -> dict | None:
        return None  # TopProxy không có endpoint usage

    async def revoke(self, resource_id: str) -> bool:
        return False  # TopProxy không có endpoint huỷ/thu hồi
