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
import json
import secrets
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import httpx
import structlog
from fastapi import HTTPException

from src.adapters.base import ProvisionResult, ProxyAssignment, RotatableProxyAdapter
from src.adapters.call_log import record_provider_call
from src.adapters.real_api import RealApiAdapter
from src.adapters.topproxy_costs import static_cost_xu, xoay_cost_xu
from src.config import settings
from src.providers.credit import debit_estimated_cost

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


# Đơn vị kỳ hạn tương ứng mỗi endpoint mua — dùng để tra giá vốn (topproxy_costs).
_XOAY_UNIT_BY_PATH = {
    _XOAY_DAY_PATH: "day",
    _XOAY_WEEK_PATH: "week",
    _XOAY_MONTH_PATH: "month",
}
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


# Các mã này KHÔNG phải "đơn này xui" — còn nguyên thì mọi đơn sau đều fail y
# hệt, buyer cứ đặt-huỷ-hoàn tiền liên tục mà không ai biết. Bắn alert admin
# ngay từ đơn đầu tiên (severity, message).
_OPERATIONAL_STATUSES: dict[int, tuple[str, str]] = {
    101: ("critical", "Sai API key TopProxy — MỌI đơn sẽ tiếp tục thất bại cho tới khi sửa cấu hình provider"),
    102: ("critical", "Tài khoản TopProxy hết Xu — MỌI đơn sẽ tiếp tục thất bại cho tới khi nạp thêm"),
}


def _status_failure(status) -> ProvisionResult:
    """ProvisionResult cho một mã lỗi nghiệp vụ của TopProxy — gộp một chỗ để
    thông điệp admin/buyer và cờ vận hành không lệch nhau giữa static và xoay."""
    operational = _OPERATIONAL_STATUSES.get(status)
    return ProvisionResult(
        success=False,
        error=_ERROR_MESSAGES.get(status, f"TopProxy trả mã lỗi {status}"),
        buyer_message=_buyer_message_for(status),
        operational_error=operational[1] if operational else None,
        operational_severity=operational[0] if operational else "critical",
        # 102 = hết Xu. Cờ này khiến orders/service tắt provider thay vì chỉ
        # ghi log — xem src/providers/credit.py::report_out_of_credit.
        provider_out_of_credit=(status == 102),
    )


class TopProxyContractError(Exception):
    """Response không đúng shape tài liệu (không phải JSON, thiếu field)."""


class TopProxyUnavailableError(Exception):
    """Transient (network/5xx). Với proxy tĩnh được phép propagate để
    provision_sweep_job retry — marker `od{order_id}` bảo đảm retry không
    mua trùng. Với key xoay KHÔNG BAO GIỜ propagate từ lệnh mua (xem
    _provision_xoay)."""


class TopProxyKeyError(Exception):
    """Key xoay sai/hết hạn/không còn tồn tại — lỗi của BINDING này, không
    phải sự cố hạ tầng. Tách khỏi TopProxyUnavailableError để router trả 400
    ("proxy của bạn hết hạn") thay vì 502 ("nhà cung cấp lỗi")."""


# Nhà cung cấp bắt tối thiểu 60 giây giữa 2 lần đổi IP (catalog §4.4).
_XOAY_ROTATE_COOLDOWN_SECONDS = 60


def _loads_tolerant(text: str):
    """Đọc document JSON ĐẦU TIÊN, bỏ qua phần đuôi.

    TopProxy in thêm rác sau JSON (sự cố đơn #90) — xem `_call_once`."""
    return json.JSONDecoder().raw_decode(text.lstrip())[0]


def _loads_all(text: str) -> list:
    """Đọc TẤT CẢ document JSON nối đuôi nhau trong một response.

    `apigetkeyxoay.php` trả `{...}{...}` khi tài khoản có nhiều key — mỗi key
    một object riêng, không phải một mảng."""
    decoder = json.JSONDecoder()
    out, idx, s = [], 0, text.strip()
    while idx < len(s):
        try:
            value, end = decoder.raw_decode(s, idx)
        except ValueError:
            break
        out.append(value)
        idx = end
        while idx < len(s) and s[idx] in " \t\r\n":
            idx += 1
    return out


def _parse_xoay_proxy_field(raw: str) -> tuple[str | None, int]:
    """get.php trả `"160.250.166.34:10053::"` (user/pass rỗng) → (ip, port)."""
    parts = (raw or "").split(":")
    if len(parts) < 2 or not parts[0]:
        return None, 0
    try:
        return parts[0], int(parts[1])
    except ValueError:
        return None, 0


def _parse_xoay_expiry(raw) -> datetime | None:
    """`"11:57 28-07-26"` (giờ VN) → datetime UTC. None nếu không parse được."""
    if not isinstance(raw, str):
        return None
    try:
        naive = datetime.strptime(raw.strip(), "%H:%M %d-%m-%y")
    except ValueError:
        return None
    return naive.replace(tzinfo=_VN_TZ).astimezone(timezone.utc)


_VN_TZ = timezone(timedelta(hours=7))


def _order_marker(order_id: int) -> str:
    # Prefix theo môi trường — xem settings.topproxy_marker_prefix.
    return f"{settings.topproxy_marker_prefix}{order_id}"


def _extract_mua_row(body, marker: str) -> dict | None:
    """Chuẩn hoá response của muaproxy.php về MỘT dict proxy.

    Tài liệu ghi trả về object `{status:100,...}`, nhưng endpoint THẬT trả về
    một MẢNG `[{...}]` (giống listproxy.php) — quan sát trực tiếp 2026-07-24,
    đây là nguyên nhân "TopProxy trả về dữ liệu không hợp lệ" dù đã mua & trừ
    Xu. Chấp nhận cả hai dạng.

    Thứ tự nhận diện, KHÔNG có bước đoán:
    1. Row mang marker username `od{order_id}` — bằng chứng chắc chắn đây là
       con vừa mua cho đơn này.
    2. Response chỉ có ĐÚNG MỘT row — không có gì để nhầm, đó là kết quả lệnh
       mua của mình.
    3. Nhiều row mà không con nào mang marker → None.

    Bước 3 trước đây trả `ok[0]`/`rows[0]`: vì response thật cùng shape với
    listproxy.php, "row đầu tiên" hoàn toàn có thể là proxy của một đơn khác
    đã bán — bind vào là giao trùng credentials cho hai buyer. UNIQUE(provider_id,
    external_id) chặn được ở tầng DB nhưng chỉ sau khi Xu đã trừ và với một
    IntegrityError không ai đọc. Thà trả None để caller đối soát lại bằng
    marker rồi báo lỗi rõ ràng."""
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
    if len(rows) == 1 and rows[0].get("status") in (100, None):
        return rows[0]
    return None


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


_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"}


def _is_local_host(url: str) -> bool:
    return (urlsplit(url).hostname or "").lower() in _LOCAL_HOSTS


def validate_topproxy_pricing_params(strategy: str | None, params: dict) -> None:
    """Chặn cấu hình giá mà provision() chắc chắn từ chối — NGAY LÚC ADMIN LƯU,
    thay vì để buyer là người phát hiện.

    Sự cố 30/07: sản phẩm gắn TopProxy giữ nguyên preset mặc định của form
    (`network_mult = {fpt, vnpt, viettel}`, `type_mult = {datacenter,
    residential_static, ...}`). Cả hai đều là mã máy được gửi THẲNG cho
    TopProxy: `network` → `loaiproxy`, `type` → `type`. Preset viết thường
    không nằm trong STATIC_LOAIPROXY/_STATIC_TYPES nên MỌI đơn đều bị huỷ +
    hoàn tiền với lý do trắng — sản phẩm nhìn vẫn "sẵn sàng bán" ở admin.

    check_compatibility() chỉ khớp được tới mức adapter ↔ strategy; đây là
    tầng dưới nó: các GIÁ TRỊ option mà chính adapter này chấp nhận.
    """
    if strategy != "config":
        return

    networks = set((params.get("network_mult") or {}).keys())
    unknown_networks = sorted(networks - STATIC_LOAIPROXY)
    if unknown_networks:
        raise HTTPException(
            status_code=400,
            detail=(
                f"TopProxy không nhận nhà mạng: {', '.join(unknown_networks)}. "
                f"Mã hợp lệ (phân biệt hoa/thường): {', '.join(sorted(STATIC_LOAIPROXY))}."
            ),
        )

    types = set((params.get("type_mult") or {}).keys())
    unknown_types = sorted(types - _STATIC_TYPES)
    if unknown_types:
        raise HTTPException(
            status_code=400,
            detail=(
                f"TopProxy không nhận loại proxy: {', '.join(unknown_types)}. "
                f"Mã hợp lệ: {', '.join(sorted(_STATIC_TYPES))}."
            ),
        )

    # Kỳ hạn: mode "xoay" mua theo ngày/tuần/tháng nên days nào >= 1 cũng map
    # được; chỉ chặn days <= 0 — provision() trả "Số ngày sử dụng không hợp lệ".
    for option in params.get("duration_options") or []:
        try:
            days = int(option.get("days", 0))
        except (TypeError, ValueError):
            days = 0
        if days < 1:
            raise HTTPException(
                status_code=400,
                detail=f"TopProxy: tuỳ chọn thời hạn phải >= 1 ngày (nhận {option.get('days')!r})",
            )


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
    # `xoay_get_url` KHÔNG phải endpoint mình gọi — nó được in thẳng vào
    # delivered_data để buyer tự gọi. Trỏ nguồn hàng vào TopProxy thật mà để
    # link này ở localhost nghĩa là bán ra một hướng dẫn không ai dùng được, và
    # delivered_data là bản chụp nên sửa config sau đó KHÔNG vá được các đơn đã
    # giao (sự cố đơn #91, 27/07 — phải sửa tay từng đơn).
    if xoay_get_url and _is_local_host(xoay_get_url) and not _is_local_host(base_url):
        raise HTTPException(
            status_code=400,
            detail=(
                "TopProxy: xoay_get_url đang trỏ localhost trong khi base_url là nguồn thật — "
                "buyer sẽ nhận link không truy cập được. Dùng "
                f"{_DEFAULT_XOAY_GET_URL} hoặc để trống."
            ),
        )


class TopProxyAdapter(RealApiAdapter, RotatableProxyAdapter):
    # provision() gọi muaproxy.php/apimua*.php — TRỪ XU THẬT. Nút Test không được gọi.
    provision_has_purchase_side_effect = True

    def __init__(
        self, config: dict, *, db=None, provider_id: int | None = None, seller_owned: bool = False,
    ):
        super().__init__(config, db=db, provider_id=provider_id, seller_owned=seller_owned)
        self.mode = (config.get("mode") or "static").lower()
        self.xoay_get_url = config.get("xoay_get_url") or _DEFAULT_XOAY_GET_URL

    # ------------------------------------------------------------------
    # HTTP — auth bằng query param, KHÔNG kế thừa Bearer/_request_with_retry
    # cho lệnh mua (không idempotent phía TopProxy).
    # ------------------------------------------------------------------

    def _q(self, **params) -> dict:
        return {"key": self.api_key or "", **{k: v for k, v in params.items() if v is not None}}

    async def _call_once(
        self, path: str, params: dict, *, operation: str, order_id: int | None = None,
        multi: bool = False,
    ):
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
        if multi:
            # Endpoint trả NHIỀU document JSON nối đuôi (apigetkeyxoay khi tài
            # khoản có ≥2 key) — lấy hết thay vì chỉ document đầu.
            return _loads_all(resp.text)
        try:
            return resp.json()
        except ValueError:
            # TopProxy in thêm rác SAU document JSON (quan sát 2026-07-27 trên
            # apimuangay.php: `{...}` hợp lệ rồi có ký tự thừa ngay sau dấu `}`
            # — nhiều khả năng warning/notice của PHP). `resp.json()` strict nên
            # vứt luôn cả response, và với lệnh MUA thì đó là mất tiền: đơn #90
            # đã trừ Xu, TopProxy trả status 100 kèm keyxoay, mà bên mình ném
            # TopProxyContractError rồi để đơn kẹt `pending` không có key.
            #
            # `raw_decode` đọc đúng document JSON đầu tiên và bỏ qua phần đuôi.
            # Vẫn log lại để biết upstream đang trả bẩn.
            try:
                value, end = json.JSONDecoder().raw_decode(resp.text.lstrip())
            except ValueError as e:
                raise TopProxyContractError(f"Body không phải JSON: {e}") from e
            logger.warning(
                "topproxy_trailing_data_after_json",
                path=path, operation=operation, order_id=order_id,
                trailing=resp.text.lstrip()[end:][:120],
            )
            return value

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
                return _status_failure(body.get("status"))
            row = _extract_mua_row(body, marker)
            if row is None:
                # KHÔNG nhận diện được row nhưng có thể ĐÃ MUA (trừ Xu) — đối
                # soát lại bằng marker qua listproxy trước khi kết luận, tránh
                # mất tiền vì một shape lạ (review sự cố 2026-07-24: order 79/81).
                row = await self._find_static_by_marker(loaiproxy, marker, order_id)
                if row is None:
                    return ProvisionResult(
                        success=False,
                        error="TopProxy trả về dữ liệu không hợp lệ — chưa xác nhận mua được",
                        # Có thể đã trừ Xu mà không nhận được proxy: buyer được
                        # hoàn tiền tự động, nhưng phía mình cần người đối soát.
                        operational_error=(
                            f"Đơn #{order_id}: lệnh mua proxy tĩnh TopProxy trả về dữ liệu không nhận diện "
                            f"được và không tìm thấy marker {marker} trong listproxy — kiểm tra lịch sử Xu, "
                            f"có thể đã mua mà không giao được"
                        ),
                        operational_severity="warning",
                    )

        assignment = self._assignment_from_row(row, fallback_days=days, proxy_type=proxy_type, network=loaiproxy)
        if assignment is None:
            return ProvisionResult(success=False, error="TopProxy trả về proxy không đúng định dạng")

        allocation = await bind_purchased_assignment(self.provider_id, order_id, assignment, self.db)
        # Trừ sổ Xu ngay trong transaction của đơn: đơn rollback thì số Xu cũng
        # không bị trừ oan.
        await debit_estimated_cost(self.provider_id, static_cost_xu(loaiproxy, days), self.db)
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

        # Chốt chặn mua trùng. Proxy tĩnh có marker `od{order_id}` nhét vào
        # username nên retry luôn tìm lại được con đã mua; key xoay KHÔNG có
        # chỗ nào nhét marker. Nếu attempt trước đã gửi lệnh mua thành công
        # rồi process chết TRƯỚC khi ghi allocation (restart, IntegrityError,
        # OOM), order vẫn ở `pending` → provision_sweep_job retry → mua key
        # thứ hai, mất Xu và không ai biết. provider_call_logs được ghi trên
        # session riêng và commit độc lập (xem adapters/call_log.py) nên nó
        # sống sót đúng cái rollback đã xoá allocation — đó là dấu vết duy
        # nhất còn lại của attempt trước.
        if await self._xoay_purchase_attempted(order_id):
            logger.error("topproxy_xoay_duplicate_purchase_blocked", order_id=order_id)
            return ProvisionResult(
                success=False,
                error="Đã có lệnh mua key xoay cho đơn này trước đó — không mua lại, cần đối soát tay",
                operational_error=(
                    f"Đơn #{order_id}: đã gửi lệnh mua key xoay lên TopProxy ở lần thử trước nhưng không "
                    f"ghi được key. KHÔNG mua lại (tránh trừ Xu hai lần) — đối soát apigetkeyxoay.php + "
                    f"lịch sử tiêu Xu, nếu key đã mua thì giao tay cho buyer"
                ),
                operational_severity="warning",
            )

        try:
            body = await self._call_once(
                path, self._q(thoigian=thoigian, soluong=1), operation="mua_keyxoay", order_id=order_id,
            )
        except (TopProxyUnavailableError, TopProxyContractError) as e:
            # KHÔNG propagate: không có marker để đối soát key xoay, để
            # sweeper retry là rủi ro mua trùng. Fail → refund buyer, admin
            # đối soát với TopProxy bằng apigetkeyxoay/lịch sử tiêu Xu.
            # ContractError tính cùng ca với Unavailable: body rác sau một
            # lệnh mua nghĩa là KHÔNG BIẾT đã trừ Xu hay chưa — trước đây nó
            # propagate, đơn treo pending thêm một vòng sweep rồi mới bị chặn
            # bởi _xoay_purchase_attempted, buyer chờ thêm 2 phút vô ích.
            logger.error("topproxy_xoay_purchase_unclear", order_id=order_id, error=str(e))
            return ProvisionResult(
                success=False,
                error="Không xác nhận được kết quả mua key xoay — admin cần đối soát TopProxy trước khi thử lại",
                operational_error=(
                    f"Đơn #{order_id}: lệnh mua key xoay không rõ kết quả ({e}). Buyer đã được hoàn tiền, "
                    f"nhưng Xu có thể đã bị trừ — đối soát TopProxy"
                ),
                operational_severity="warning",
            )

        if not isinstance(body, dict):
            return ProvisionResult(success=False, error="TopProxy trả về dữ liệu không hợp lệ")
        status = body.get("status")
        if status != 100:
            return _status_failure(status)
        keyxoay = body.get("keyxoay")
        if not keyxoay or not isinstance(keyxoay, str):
            return ProvisionResult(success=False, error="TopProxy không trả về key xoay")

        expires_at = datetime.now(timezone.utc) + timedelta(days=days)

        # Lấy sẵn một proxy để buyer dùng được NGAY. Bước này không tốn Xu.
        # Hỏng thì vẫn giao đơn: key đã mua và còn nguyên giá trị, buyer chỉ
        # cần bấm "Lấy proxy mới" — huỷ đơn ở đây là vứt Xu đã tiêu.
        try:
            fetched = await self._fetch_xoay_proxy(keyxoay, expires_at, order_id=order_id)
        except (TopProxyUnavailableError, TopProxyContractError, TopProxyKeyError) as e:
            logger.warning("topproxy_xoay_first_fetch_failed", order_id=order_id, error=str(e))
            fetched = None

        if fetched is not None:
            # Lượt fetch này ĐÃ tiêu một lần cấp proxy của nhà cung cấp — ghi
            # last_rotated_at để cooldown gate (proxy_router) chạy ngay từ lần
            # đổi IP đầu tiên. Trước đây để None: buyer bấm "Lấy proxy mới"
            # trong 60 giây đầu sau giao hàng lọt qua gate, nhà cung cấp từ
            # chối, và lỗi bị dịch thành "proxy không còn hiệu lực" — sai bản
            # chất, đúng ra chỉ là "chờ thêm chút".
            fetched = replace(fetched, last_rotated_at=datetime.now(timezone.utc))
        assignment = fetched or self._xoay_assignment(keyxoay, expires_at)
        allocation = await bind_purchased_assignment(self.provider_id, order_id, assignment, self.db)
        await debit_estimated_cost(
            self.provider_id, xoay_cost_xu(_XOAY_UNIT_BY_PATH.get(path, ""), thoigian), self.db,
        )
        return ProvisionResult(
            success=True,
            data=self._xoay_delivered_text(assignment),
            resource_id=keyxoay,
            metadata={"provider": "topproxy", "proxy_allocation_id": allocation.id},
        )

    def _xoay_assignment(
        self, keyxoay: str, expires_at: datetime, *, host: str | None = None, port: int | None = None,
        public_ip: str | None = None, network: str | None = None, location: str | None = None,
    ) -> ProxyAssignment:
        """Một binding key xoay. `external_id` LUÔN là keyxoay — đó là thứ định
        danh quyền sở hữu.

        PHÂN BIỆT HAI THỨ RẤT DỄ NHẦM (quan sát 27/07 trên đơn #91):
        - `host`/`port` = CỔNG VÀO cố định của key (`proxyhttp` trong get.php,
          vd 160.250.166.34:10053). KHÔNG đổi giữa các lần xoay — đó là thiết kế
          của nhà cung cấp, buyer cấu hình tool đúng một lần.
        - `public_ip` = IP dân cư mà traffic THẬT SỰ đi ra (trường `ip`). Đây
          mới là thứ xoay, đổi mỗi lần gọi get.php.

        Gán nhầm `public_ip = host` làm UI hiện một "IP hiện tại" đứng yên vĩnh
        viễn, trong khi IP thật đã đổi ba lần — đúng triệu chứng "ấn xoay chỉ
        thấy đổi địa điểm".

        `rotation_available=True` + `cooldown_seconds=60` để tái dùng nguyên
        luồng đổi IP sẵn có (src/resources/proxy_router.py) — 60 giây là ràng
        buộc của nhà cung cấp (catalog §4.4), không phải mình tự đặt.
        """
        return ProxyAssignment(
            # Cổng vào cố định lưu vào `proxy_id` (→ ProxyAllocation
            # .external_proxy_id) vì bảng không có cột host/port riêng. Nhờ đó
            # `_redeliver` dựng lại được bản chụp mà không phải gọi lên nhà
            # cung cấp — cổng vào không đổi nên cache lại là an toàn.
            external_id=keyxoay, proxy_id=f"{host}:{port}" if host else None,
            host=host or "", port=port or 0,
            username="", password="", public_ip=public_ip,
            assigned_at=datetime.now(timezone.utc), expires_at=expires_at,
            online=True, rotation_available=True, rotation_mode="fetch",
            cooldown_seconds=_XOAY_ROTATE_COOLDOWN_SECONDS, last_rotated_at=None, rotate_path=None,
            network=network, proxy_type=location or "xoay",
        )

    def delivered_text_for(self, assignment: ProxyAssignment, whitelist: str | None = None) -> str:
        """Bản chụp `Order.delivered_data` sau mỗi lần đổi IP
        (src/resources/proxy_router.py). Static giao thẳng credential như cũ;
        xoay đi qua bản rút gọn không lộ key/nguồn."""
        if self.mode == "xoay":
            return self._xoay_delivered_text(assignment, whitelist=whitelist)
        return assignment.delivered_text()

    def _xoay_delivered_text(self, assignment: ProxyAssignment, *, whitelist: str | None = None) -> str:
        """Bản chụp giao cho buyer — CỐ TÌNH không chứa `keyxoay` lẫn URL
        proxyxoay.shop (phương án B1).

        Trước đây in cả hai: buyer cầm key là gọi thẳng nhà cung cấp được,
        mình mất kiểm soát usage và lộ luôn nguồn hàng. Giờ key nằm ở
        `ProxyAllocation.external_id`, buyer đổi IP qua
        POST /orders/{id}/proxy/rotate của mình.
        """
        if not assignment.host:
            return "\n".join([
                "Proxy đang được cấp — bấm “Đổi IP” ở trang Đơn hàng để nhận.",
                f"Hết hạn: {assignment.expires_at.isoformat()}",
            ])
        lines = [
            f"Host: {assignment.host}",
            f"Port: {assignment.port}",
            "(Host/Port là cổng vào CỐ ĐỊNH — cấu hình một lần, không đổi khi bạn đổi IP)",
        ]
        if assignment.public_ip:
            lines.append(f"IP đang dùng: {assignment.public_ip}")
        if assignment.network:
            lines.append(f"Nhà mạng: {assignment.network}")
        if assignment.proxy_type and assignment.proxy_type != "xoay":
            lines.append(f"Vị trí: {assignment.proxy_type}")
        # Cảnh báo whitelist đặt NGAY sau thông tin kết nối vì đây là nguyên
        # nhân số một khiến buyer tưởng proxy chết: nhà cung cấp chấp nhận TCP
        # rồi im lặng nuốt request nếu IP không được đăng ký — không một thông
        # báo lỗi nào.
        if whitelist:
            lines.append(f"IP của bạn được phép dùng: {whitelist}")
        else:
            lines.append(
                "⚠ CHƯA kích hoạt — proxy sẽ KHÔNG phản hồi. Vào trang Đơn hàng, "
                "nhập IP của bạn rồi bấm “Kích hoạt”."
            )
        lines += [
            "Mỗi IP sống 15–30 phút — bấm “Đổi IP” để đổi sang IP khác (tối thiểu 60 giây/lần).",
            f"Hết hạn: {assignment.expires_at.isoformat()}",
        ]
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Idempotent re-delivery + reconcile helpers
    # ------------------------------------------------------------------

    async def _redeliver(self, allocation) -> ProvisionResult:
        """Order đã có binding (retry của sweeper sau khi attempt trước ghi
        được allocation nhưng chết trước khi order chuyển trạng thái)."""
        if self.mode == "xoay":
            # Dựng lại bản chụp từ allocation — host/port có thể đã cũ (proxy
            # sống 15–30 phút), buyer bấm "Lấy proxy mới" là có cái mới.
            gateway_host, gateway_port = _parse_xoay_proxy_field(allocation.external_proxy_id or "")
            assignment = self._xoay_assignment(
                allocation.external_id, allocation.expires_at,
                host=gateway_host, port=gateway_port,
                public_ip=allocation.last_public_ip,
            )
            return ProvisionResult(
                success=True,
                data=self._xoay_delivered_text(assignment),
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

    # ------------------------------------------------------------------
    # Key xoay: lấy/đổi proxy qua backend mình (phương án B1) — buyer không
    # bao giờ thấy keyxoay hay domain proxyxoay.shop.
    # ------------------------------------------------------------------

    async def _fetch_xoay_proxy(
        self, keyxoay: str, expires_at: datetime, *, order_id: int | None = None,
        whitelist: str | None = None,
    ) -> ProxyAssignment:
        """Gọi get.php lấy MỘT proxy mới cho key này. Không tốn Xu.

        Đây là endpoint của domain khác (proxyxoay.shop, xem catalog §4.4) chứ
        không phải base_url, nên tự dựng request thay vì dùng `_call_once`.

        `whitelist`: IPv4 của buyer được phép kết nối tới proxy (phân tách bằng
        dấu phẩy). Nhà cung cấp khoá proxy theo IP; không truyền thì proxy chỉ
        nhận kết nối từ IP của SERVER mình, buyer sẽ thấy proxy "im lặng".
        """
        started = time.perf_counter()
        status_code: int | None = None
        error: str | None = None
        resp: httpx.Response | None = None
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
                params: dict = {"key": keyxoay, "nhamang": "Random", "tinhthanh": 0}
                if whitelist:
                    params["whitelist"] = whitelist
                resp = await client.get(self.xoay_get_url, params=params)
                status_code = resp.status_code
        except httpx.HTTPError as e:
            error = str(e)
        finally:
            await record_provider_call(
                provider_id=self.provider_id, order_id=order_id, operation="get_xoay_proxy",
                method="GET", path=urlsplit(self.xoay_get_url).path, attempt=1,
                status_code=status_code,
                latency_ms=int((time.perf_counter() - started) * 1000),
                success=status_code is not None and status_code < 400,
                error=error, idempotency_key=None,
            )
        if resp is None or resp.status_code >= 500:
            raise TopProxyUnavailableError(error or f"HTTP {status_code}")

        body = _loads_tolerant(resp.text)
        if not isinstance(body, dict):
            raise TopProxyContractError("get.php trả về dữ liệu không đúng định dạng")
        if body.get("status") != 100:
            # 101 ở đây nghĩa là key sai/hết hạn — lỗi của binding này, không
            # phải sự cố hạ tầng, nên tách riêng để router trả 400 chứ không 502.
            raise TopProxyKeyError(str(body.get("message") or body.get("comen") or body.get("status")))

        host, port = _parse_xoay_proxy_field(body.get("proxyhttp") or body.get("proxysocks5") or "")
        if not host:
            raise TopProxyContractError("get.php không trả về proxy hợp lệ")
        return self._xoay_assignment(
            keyxoay, expires_at, host=host, port=port,
            # `ip` là IP đi ra thật (xoay mỗi lần gọi); `proxyhttp` chỉ là cổng
            # vào cố định. Xem docstring _xoay_assignment.
            public_ip=body.get("ip") or None,
            network=body.get("Nha Mang"), location=body.get("Vi Tri"),
        )

    async def list_assignments(self) -> list[ProxyAssignment]:
        """Mọi key xoay còn hạn của tài khoản (apigetkeyxoay.php).

        Endpoint này trả NHIỀU document JSON nối đuôi nhau khi có từ 2 key trở
        lên — `json.loads` sẽ chết, phải decode lặp (`_loads_all`).

        Chỉ có nghĩa với mode=xoay; mode static trả rỗng (proxy tĩnh không đổi
        IP được nên không đi qua luồng rotate).
        """
        if self.mode != "xoay":
            return []
        body = await self._call_once(_XOAY_LIST_PATH, self._q(), operation="list_keyxoay", multi=True)
        out: list[ProxyAssignment] = []
        for row in body if isinstance(body, list) else [body]:
            if not isinstance(row, dict) or row.get("status") != 100:
                continue
            keyxoay = row.get("keyxoay")
            expires_at = _parse_xoay_expiry(row.get("expired"))
            if keyxoay and expires_at:
                out.append(self._xoay_assignment(str(keyxoay), expires_at))
        return out

    # Adapter này hỗ trợ khai báo IP buyer được phép dùng (get.php?whitelist=).
    # proxy_router dựa vào cờ này để quyết định có mở API whitelist cho đơn hay
    # không — DProxy không có khái niệm tương đương nên không bị đụng tới.
    supports_ip_whitelist = True

    async def rotate_assignment(self, external_id: str, *, whitelist: str | None = None) -> ProxyAssignment:
        """"Đổi IP" của một key xoay = xin nhà cung cấp một proxy mới.

        `external_id` chính là keyxoay. Hạn dùng lấy lại từ apigetkeyxoay chứ
        KHÔNG lấy từ get.php: get.php trả `Token expiration date` của phiên
        proxy vừa cấp (15–30 phút), gán nhầm cái đó vào `expires_at` là biến
        đơn 30 ngày thành đơn 30 phút.

        `whitelist` phải được truyền lại MỖI LẦN gọi: nhà cung cấp gắn quyền
        truy cập vào từng lượt cấp proxy, không nhớ vĩnh viễn theo key.
        """
        expires_at = None
        for assignment in await self.list_assignments():
            if assignment.external_id == external_id:
                expires_at = assignment.expires_at
                break
        if expires_at is None:
            raise TopProxyKeyError("Key xoay không còn tồn tại trên hệ thống nhà cung cấp")
        return await self._fetch_xoay_proxy(external_id, expires_at, whitelist=whitelist)

    async def _xoay_purchase_attempted(self, order_id: int) -> bool:
        """Đơn này đã từng GỬI lệnh mua key xoay lên TopProxy chưa?

        `_call_once` ghi provider_call_logs trong `finally` — kể cả khi request
        timeout — nên câu này bắt được cả ca "đã gửi, không biết kết quả".
        Cố tình thận trọng: một attempt chưa rõ kết quả cũng chặn mua lại, vì
        cái giá của false-positive (đơn huỷ + hoàn tiền, admin đối soát) rẻ hơn
        nhiều so với false-negative (mua trùng key, mất Xu âm thầm)."""
        from sqlalchemy import select

        from src.models.provider import ProviderCallLog

        found = await self.db.scalar(
            select(ProviderCallLog.id)
            .where(
                ProviderCallLog.order_id == order_id,
                ProviderCallLog.operation == "mua_keyxoay",
            )
            .limit(1)
        )
        return found is not None

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
            network=network, proxy_type=proxy_type or row.get("type"),
        )

    # ------------------------------------------------------------------
    # Health / usage / revoke
    # ------------------------------------------------------------------

    async def check_health(self) -> dict:
        """Probe xác thực read-only, KHÔNG tốn Xu — dùng chung một endpoint cho
        cả hai mode vì một tài khoản TopProxy dùng chung key cho tĩnh lẫn xoay.

        Cố tình KHÔNG dùng apigetkeyxoay.php cho mode=xoay: endpoint đó trả
        `{"status":101,"comen":"key does not exist"}` cho CẢ hai ca "sai API
        key" lẫn "tài khoản chưa có key xoay nào còn hạn". Một provider xoay
        vừa dựng (hoặc vừa hết key) vì thế bị chấm là sai API key, và sau 3
        lượt liên tiếp thì health_check_job tự tắt provider — đúng sự cố
        provider #13 ngày 27/07.

        apiv2/listproxy.php phân biệt rạch ròi: sai key → status 101
        "Account does not exist"; tài khoản hợp lệ nhưng rỗng → `[]`.
        """
        try:
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
