"""TopProxyAdapter — contract thật topproxy.vn. Xem
docs/superpowers/specs/2026-07-23-topproxy-research.md và src/adapters/topproxy.py.

Trọng tâm: mapping tham số ConfigPricing → apiv2, map mã lỗi status số,
và kỷ luật idempotency tự chế (marker user cho tĩnh, fail-fast cho xoay).
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

import httpx

from src.adapters.topproxy import (
    TopProxyAdapter,
    TopProxyContractError,
    TopProxyUnavailableError,
    _extract_mua_row,
    _loads_all,
    _parse_proxy_string,
    _parse_xoay_expiry,
    validate_topproxy_config,
    validate_topproxy_pricing_params,
)
from src.security.crypto import encrypt_str


def _adapter(mode: str = "static", *, prior_xoay_purchase: bool = False, **extra) -> TopProxyAdapter:
    config = {
        "base_url": "http://topproxy.test",
        "api_key": encrypt_str("real-key"),
        "mode": mode,
        **extra,
    }
    db = AsyncMock()
    # `_xoay_purchase_attempted` hỏi provider_call_logs qua db.scalar(). Mặc
    # định AsyncMock trả về một mock TRUTHY, tức "đơn này đã từng mua rồi" —
    # phải nói rõ là chưa, không thì mọi test xoay đều rơi vào nhánh chặn mua
    # trùng. `prior_xoay_purchase=True` để dựng đúng ca đã-mua-rồi.
    db.scalar = AsyncMock(return_value=1234 if prior_xoay_purchase else None)
    # provider_id=None cố ý: đây là unit test thuần, không có provider thật
    # trong DB. Đặt một id giả khiến mọi `record_provider_call` thành một INSERT
    # vi phạm khoá ngoại — nuốt lỗi nhưng vẫn giữ khoá trên provider_call_logs
    # và deadlock với TRUNCATE của `clean_db` ở test kế tiếp (lỗi setup rải rác,
    # đổi theo thứ tự chạy). `record_provider_call` trả về ngay khi provider_id
    # là None, nên test không chạm DB nữa.
    return TopProxyAdapter(config, db=db, provider_id=None)


def _no_allocation(monkeypatch):
    monkeypatch.setattr(
        "src.resources.proxy_service.get_order_proxy_allocation", AsyncMock(return_value=None),
    )


def _capture_bind(monkeypatch):
    holder = {}

    async def fake_bind(provider_id, order_id, assignment, db):
        holder["assignment"] = assignment

        class _Alloc:
            id = 555

        return _Alloc()

    monkeypatch.setattr("src.resources.proxy_service.bind_purchased_assignment", fake_bind)
    return holder


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class TestParseProxyString:
    def test_valid(self):
        assert _parse_proxy_string("1.2.3.4:8080:user:pw") == ("1.2.3.4", 8080, "user", "pw")

    @pytest.mark.parametrize("raw", ["", "1.2.3.4:8080", "a:b:c:d", "1.2.3.4:80:u:p:x", ":80:u:p"])
    def test_invalid(self, raw):
        assert _parse_proxy_string(raw) is None


class TestXoayNoLeak:
    """Phương án B1: buyer KHÔNG được thấy keyxoay lẫn domain nhà cung cấp.
    Trước đây `delivered_data` in cả hai — cầm key là gọi thẳng proxyxoay.shop
    được, mình mất kiểm soát và lộ nguồn hàng."""

    def _assignment(self, adapter, **kw):
        return adapter._xoay_assignment(
            "SECRETKEY123", datetime.now(timezone.utc) + timedelta(days=1), **kw
        )

    def test_delivered_text_hides_key_and_supplier_domain(self):
        adapter = _adapter(mode="xoay")
        text = adapter.delivered_text_for(
            self._assignment(adapter, host="1.2.3.4", port=10053, network="viettel")
        )
        assert "SECRETKEY123" not in text
        assert "proxyxoay" not in text
        assert "1.2.3.4" in text and "10053" in text

    def test_delivered_text_before_first_fetch_still_hides_key(self):
        adapter = _adapter(mode="xoay")
        text = adapter.delivered_text_for(self._assignment(adapter))
        assert "SECRETKEY123" not in text
        assert "proxyxoay" not in text

    def test_static_mode_keeps_credential_snapshot(self):
        # Không được vô tình bóp cả proxy tĩnh — nó vẫn giao thẳng credential.
        adapter = _adapter()
        text = adapter.delivered_text_for(self._assignment(adapter, host="1.2.3.4", port=8080))
        assert "Host: 1.2.3.4" in text and "Username:" in text

    def test_gateway_and_exit_ip_are_kept_separate(self):
        """Cổng vào KHÔNG đổi giữa các lần xoay; IP đi ra thì đổi. Gán nhầm
        public_ip = host làm UI hiện một "IP hiện tại" đứng yên vĩnh viễn —
        đúng triệu chứng "ấn xoay chỉ thấy đổi địa điểm" (đơn #91, 27/07)."""
        adapter = _adapter(mode="xoay")
        a = self._assignment(adapter, host="160.250.166.34", port=10053, public_ip="42.119.203.81")
        assert a.host == "160.250.166.34" and a.port == 10053
        assert a.public_ip == "42.119.203.81"
        text = adapter.delivered_text_for(a)
        assert "160.250.166.34" in text and "42.119.203.81" in text

    def test_xoay_binding_is_rotatable_through_platform(self):
        # rotation_available=True là thứ mở nút "Lấy proxy mới" ở
        # src/resources/proxy_router.py; cooldown 60s là ràng buộc nhà cung cấp.
        a = self._assignment(_adapter(mode="xoay"))
        assert a.rotation_available is True
        assert a.cooldown_seconds == 60
        assert a.external_id == "SECRETKEY123"


class TestXoayWhitelist:
    """Nhà cung cấp khoá proxy theo IP: chấp nhận TCP rồi IM LẶNG nuốt request
    nếu IP không được đăng ký. Với phương án B1 (server mình gọi get.php thay
    buyer), không gửi `whitelist` nghĩa là chỉ IP server dùng được — buyer thấy
    proxy "chết" mà không có thông báo lỗi nào."""

    def _patch_http(self, monkeypatch, captured: dict):
        async def fake_get(self, url, params=None):
            captured["url"] = url
            captured["params"] = params or {}
            body = ('{"status":100,"proxyhttp":"1.2.3.4:9999::","ip":"5.6.7.8",'
                    '"Nha Mang":"viettel","Vi Tri":"HaNoi1"}')
            return httpx.Response(200, text=body, request=httpx.Request("GET", url))

        monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    @pytest.mark.asyncio
    async def test_whitelist_is_sent_to_provider(self, monkeypatch):
        adapter = _adapter(mode="xoay")
        captured: dict = {}
        self._patch_http(monkeypatch, captured)

        a = await adapter._fetch_xoay_proxy(
            "KEY", datetime.now(timezone.utc) + timedelta(days=1), whitelist="1.1.1.1,2.2.2.2",
        )

        assert captured["params"]["whitelist"] == "1.1.1.1,2.2.2.2"
        assert a.host == "1.2.3.4" and a.port == 9999
        assert a.public_ip == "5.6.7.8"

    @pytest.mark.asyncio
    async def test_no_whitelist_param_when_buyer_has_not_declared(self, monkeypatch):
        # Không gửi tham số rỗng — để nhà cung cấp giữ nguyên thiết lập cũ thay
        # vì xoá sạch whitelist đang có.
        adapter = _adapter(mode="xoay")
        captured: dict = {}
        self._patch_http(monkeypatch, captured)

        await adapter._fetch_xoay_proxy("KEY", datetime.now(timezone.utc) + timedelta(days=1))

        assert "whitelist" not in captured["params"]

    def test_delivered_text_warns_when_not_declared(self):
        adapter = _adapter(mode="xoay")
        a = adapter._xoay_assignment("K", datetime.now(timezone.utc) + timedelta(days=1),
                                     host="1.2.3.4", port=9999, public_ip="5.6.7.8")
        assert "CHƯA kích hoạt" in adapter.delivered_text_for(a)
        assert "CHƯA kích hoạt" not in adapter.delivered_text_for(a, "9.9.9.9")
        assert "9.9.9.9" in adapter.delivered_text_for(a, "9.9.9.9")


class TestXoayExpiryParsing:
    def test_expiry_is_read_as_vietnam_time(self):
        # "11:57 28-07-26" giờ VN = 04:57 UTC — lấy sai múi giờ là đơn hết hạn
        # sớm/muộn 7 tiếng.
        assert _parse_xoay_expiry("11:57 28-07-26") == datetime(2026, 7, 28, 4, 57, tzinfo=timezone.utc)

    @pytest.mark.parametrize("raw", [None, "", "không phải ngày", 123])
    def test_bad_expiry_returns_none(self, raw):
        assert _parse_xoay_expiry(raw) is None

    def test_concatenated_json_documents_all_parsed(self):
        # apigetkeyxoay trả {..}{..} khi có nhiều key — json.loads sẽ chết.
        body = '{\n "status": 100,\n "keyxoay": "A"\n}\n{\n "status": 100,\n "keyxoay": "B"\n}'
        assert [r["keyxoay"] for r in _loads_all(body)] == ["A", "B"]


class TestXoayGetUrlGuard:
    """`xoay_get_url` được IN vào delivered_data cho buyer tự gọi, không phải
    endpoint mình gọi. Nguồn thật + link localhost = bán ra hướng dẫn chết, và
    delivered_data là bản chụp nên sửa config sau đó không vá được đơn đã giao
    (sự cố đơn #91, 27/07)."""

    @pytest.mark.asyncio
    async def test_local_get_url_with_real_base_url_rejected(self):
        with pytest.raises(HTTPException) as e:
            await validate_topproxy_config({
                "base_url": "https://topproxy.vn", "api_key": "k", "mode": "xoay",
                "xoay_get_url": "http://127.0.0.1:9300/api/get.php",
            })
        assert e.value.status_code == 400

    @pytest.mark.asyncio
    async def test_all_local_is_fine_for_dev_mock(self):
        await validate_topproxy_config({
            "base_url": "http://127.0.0.1:9300", "api_key": "k", "mode": "xoay",
            "xoay_get_url": "http://127.0.0.1:9300/api/get.php",
        })

    @pytest.mark.asyncio
    async def test_real_pairing_is_fine(self):
        await validate_topproxy_config({
            "base_url": "https://topproxy.vn", "api_key": "k", "mode": "xoay",
            "xoay_get_url": "https://proxyxoay.shop/api/get.php",
        })


class TestCallOnceJsonTolerance:
    """Sự cố đơn #90 (27/07): `apimuangay.php` trả JSON hợp lệ RỒI in thêm rác
    ngay sau dấu `}` (PHP notice). `resp.json()` strict vứt cả response →
    TopProxyContractError → đơn kẹt `pending` dù Xu đã trừ và `keyxoay` đã nằm
    sẵn trong body."""

    def _patch_http(self, monkeypatch, body: str, status_code: int = 200):
        async def fake_get(self, url, params=None):
            return httpx.Response(status_code, text=body, request=httpx.Request("GET", url))

        monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    @pytest.mark.asyncio
    async def test_trailing_junk_after_json_is_tolerated(self, monkeypatch):
        adapter = _adapter(mode="xoay")
        self._patch_http(monkeypatch, '{\n    "status": 100,\n    "keyxoay": "abc123"\n}<br />')

        out = await adapter._call_once("/proxyxoay/apimuangay.php", {}, operation="mua_keyxoay")

        assert out == {"status": 100, "keyxoay": "abc123"}

    @pytest.mark.asyncio
    async def test_array_response_with_trailing_junk(self, monkeypatch):
        # listproxy.php trả mảng — cùng đường xử lý, đừng chỉ vá mỗi dict.
        adapter = _adapter()
        self._patch_http(monkeypatch, '[{"idproxy": "1"}]\nnotice: something')

        out = await adapter._call_once("/apiv2/listproxy.php", {}, operation="listproxy")

        assert out == [{"idproxy": "1"}]

    @pytest.mark.asyncio
    async def test_body_without_any_json_still_fails(self, monkeypatch):
        # Nới lỏng không được biến thành "nuốt mọi thứ": body không mở đầu
        # bằng JSON vẫn phải là lỗi contract.
        adapter = _adapter()
        self._patch_http(monkeypatch, "<html>502 Bad Gateway</html>")

        with pytest.raises(TopProxyContractError):
            await adapter._call_once("/apiv2/listproxy.php", {}, operation="listproxy")


class TestCheckHealth:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("mode", ["static", "xoay"])
    async def test_probes_static_list_endpoint_in_both_modes(self, monkeypatch, mode):
        """Provider xoay CHƯA có key nào còn hạn vẫn phải là `healthy`.

        apigetkeyxoay.php trả `{"status":101,"comen":"key does not exist"}` cho
        CẢ "sai API key" lẫn "chưa có key nào" — dùng nó làm probe thì provider
        xoay vừa dựng bị chấm sai API key, 3 lượt liên tiếp là health_check_job
        tự tắt provider (sự cố provider #13, 27/07). apiv2/listproxy.php phân
        biệt được: key hỏng → status 101, tài khoản rỗng → `[]`."""
        adapter = _adapter(mode=mode)
        seen = {}

        async def fake_call(path, params, *, operation, order_id=None):
            seen["path"] = path
            return []  # tài khoản hợp lệ, chưa có proxy nào

        monkeypatch.setattr(adapter, "_call_once", fake_call)

        assert (await adapter.check_health())["status"] == "healthy"
        assert seen["path"] == "/apiv2/listproxy.php"

    @pytest.mark.asyncio
    async def test_bad_api_key_is_unhealthy(self, monkeypatch):
        adapter = _adapter(mode="xoay")

        async def fake_call(path, params, *, operation, order_id=None):
            return {"status": 101, "comen": "Account does not exist"}

        monkeypatch.setattr(adapter, "_call_once", fake_call)

        assert (await adapter.check_health())["status"] == "unhealthy"


class TestExtractMuaRow:
    """muaproxy.php trả về MẢNG cùng shape với listproxy.php, nên "row đầu
    tiên" hoàn toàn có thể là proxy của một đơn khác đã bán. Nhận diện phải
    dựa vào bằng chứng, không được đoán."""

    def test_prefers_row_carrying_our_marker(self):
        body = [
            {"idproxy": "1", "proxy": "1.1.1.1:80:od999:pw", "status": 100},
            {"idproxy": "2", "proxy": "2.2.2.2:80:od42:pw", "status": 100},
        ]
        assert _extract_mua_row(body, "od42")["idproxy"] == "2"

    def test_single_row_response_is_ours(self):
        # Shape tài liệu (object) và shape thật 1 phần tử — không có gì để nhầm.
        assert _extract_mua_row({"idproxy": "5", "status": 100}, "od42")["idproxy"] == "5"
        assert _extract_mua_row([{"idproxy": "5", "status": 100}], "od42")["idproxy"] == "5"

    def test_multi_row_without_marker_refuses_to_guess(self):
        """Trước đây trả rows[0] → bind nhầm proxy của đơn khác, giao trùng
        credentials cho hai buyer. Trả None để caller đối soát lại bằng marker
        rồi báo lỗi rõ ràng."""
        body = [
            {"idproxy": "1", "proxy": "1.1.1.1:80:odOTHER:pw", "status": 100},
            {"idproxy": "2", "proxy": "2.2.2.2:80:odALSO:pw", "status": 100},
        ]
        assert _extract_mua_row(body, "od42") is None

    def test_empty_or_junk(self):
        assert _extract_mua_row([], "od42") is None
        assert _extract_mua_row("not json", "od42") is None


class TestValidateConfig:
    @pytest.mark.asyncio
    async def test_ok(self):
        await validate_topproxy_config(
            {"base_url": "https://topproxy.vn", "api_key": "k", "mode": "xoay"}
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("config", [
        {"api_key": "k"},                                            # thiếu base_url
        {"base_url": "ftp://x", "api_key": "k"},                     # scheme sai
        {"base_url": "https://topproxy.vn"},                         # thiếu api_key
        {"base_url": "https://topproxy.vn", "api_key": "k", "mode": "rotating"},  # mode lạ
        {"base_url": "https://t.vn", "api_key": "k", "xoay_get_url": "not-a-url"},
    ])
    async def test_rejects(self, config):
        with pytest.raises(HTTPException):
            await validate_topproxy_config(config)


# ---------------------------------------------------------------------------
# _q — auth bằng query param (key đã được decrypt từ config)
# ---------------------------------------------------------------------------


def test_q_carries_decrypted_key_and_drops_none():
    adapter = _adapter()
    q = adapter._q(loaiproxy="Viettel", ngay=None)
    assert q == {"key": "real-key", "loaiproxy": "Viettel"}


# ---------------------------------------------------------------------------
# Provision — static
# ---------------------------------------------------------------------------


PURCHASE_OK = {
    "status": 100, "loaiproxy": "Viettel", "idproxy": 2772,
    "ip": "27.73.88.211", "port": 35270, "user": "od9", "password": "pw",
    "type": "HTTP", "proxy": "27.73.88.211:35270:od9:pw",
}


# Format THẬT của muaproxy.php — một MẢNG, chỉ có status/idproxy/ip/proxy/
# type/time (KHÔNG có port/user/password/loaiproxy rời). Quan sát 2026-07-24,
# khác tài liệu; là nguyên nhân sự cố order 79/81 (mua được nhưng báo lỗi).
REAL_MUA_LIST = [{
    "status": 100, "idproxy": 55569, "ip": "180.149.35.118",
    "proxy": "180.149.35.118:20279:od9:5arbUmBqf4", "type": "HTTPS",
    "time": 1785137629,
}]


class TestProvisionStatic:
    @pytest.mark.asyncio
    async def test_real_array_response_is_parsed_not_rejected(self, monkeypatch):
        """Regression sự cố 24/07: muaproxy trả MẢNG → phải bind được, không
        báo 'dữ liệu không hợp lệ' (khiến mất tiền đã mua)."""
        adapter = _adapter()
        _no_allocation(monkeypatch)
        holder = _capture_bind(monkeypatch)

        async def fake_call(path, params, *, operation, order_id=None):
            if operation == "listproxy":
                return []
            return REAL_MUA_LIST

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        result = await adapter.provision(9, {"type": "HTTP", "network": "US", "days": 3, "quantity": 1})

        assert result.success, result.error
        assert holder["assignment"].external_id == "55569"
        assert "180.149.35.118" in result.data
        assert "od9" in result.data  # username = marker parse từ proxy string

    @pytest.mark.asyncio
    async def test_unparseable_response_recovers_via_marker_before_failing(self, monkeypatch):
        """Response lạ (không parse được) nhưng có thể ĐÃ MUA → đối soát lại
        bằng marker qua listproxy trước khi kết luận thất bại."""
        adapter = _adapter()
        _no_allocation(monkeypatch)
        holder = _capture_bind(monkeypatch)
        list_calls = {"n": 0}

        async def fake_call(path, params, *, operation, order_id=None):
            if operation == "listproxy":
                list_calls["n"] += 1
                # lần 1 (trước mua): chưa có; lần 2 (đối soát sau mua): có rồi
                if list_calls["n"] == 1:
                    return []
                return REAL_MUA_LIST
            return "garbage-not-json-shape"  # muaproxy trả shape lạ

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        result = await adapter.provision(9, {"type": "HTTP", "network": "US", "days": 3, "quantity": 1})

        assert result.success, result.error
        assert holder["assignment"].external_id == "55569"
        assert list_calls["n"] == 2  # đã đối soát lại

    @pytest.mark.asyncio
    async def test_maps_config_pricing_keys_to_apiv2_params(self, monkeypatch):
        adapter = _adapter()
        _no_allocation(monkeypatch)
        holder = _capture_bind(monkeypatch)
        calls = []

        async def fake_call(path, params, *, operation, order_id=None):
            calls.append((path, params, operation))
            if operation == "listproxy":
                return []  # chưa có marker → chưa từng mua
            future = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
            return {**PURCHASE_OK, "time": future}

        monkeypatch.setattr(adapter, "_call_once", fake_call)

        result = await adapter.provision(9, {"type": "HTTP", "network": "Viettel", "days": 30, "quantity": 1})

        assert result.success, result.error
        mua = next(c for c in calls if c[0] == "/apiv2/muaproxy.php")
        assert mua[1]["loaiproxy"] == "Viettel"
        assert mua[1]["ngay"] == 30
        assert mua[1]["type"] == "HTTP"
        assert mua[1]["soluong"] == 1
        assert mua[1]["user"] == "od9"  # marker idempotency
        assert holder["assignment"].external_id == "2772"
        assert "27.73.88.211" in result.data
        assert result.resource_id == "2772"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status,fragment", [
        (101, "Sai API key"),
        (102, "hết Xu"),
        (103, "hết hàng"),
        (104, "không xác định"),
        (201, "thiếu số lượng"),
    ])
    async def test_error_codes_map_to_vietnamese_messages(self, monkeypatch, status, fragment):
        adapter = _adapter()
        _no_allocation(monkeypatch)

        async def fake_call(path, params, *, operation, order_id=None):
            if operation == "listproxy":
                return []
            return {"status": status}

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        result = await adapter.provision(9, {"type": "HTTP", "network": "FPT", "days": 7, "quantity": 1})
        assert not result.success
        assert fragment in result.error

    @pytest.mark.asyncio
    async def test_out_of_stock_gives_whitelabel_buyer_message(self, monkeypatch):
        """103 hết hàng → buyer_message riêng, KHÔNG lộ tên nguồn 'TopProxy'."""
        adapter = _adapter()
        _no_allocation(monkeypatch)

        async def fake_call(path, params, *, operation, order_id=None):
            return [] if operation == "listproxy" else {"status": 103}

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        result = await adapter.provision(9, {"type": "HTTP", "network": "US", "days": 3, "quantity": 1})
        assert not result.success
        assert result.buyer_message and "hết hàng" in result.buyer_message
        assert "TopProxy" not in result.buyer_message  # white-label
        # các lỗi vận hành khác (101/102) KHÔNG có buyer_message (dùng thông báo chung)

    @pytest.mark.asyncio
    async def test_auth_error_has_no_buyer_message(self, monkeypatch):
        adapter = _adapter()
        _no_allocation(monkeypatch)

        async def fake_call(path, params, *, operation, order_id=None):
            return [] if operation == "listproxy" else {"status": 101}

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        result = await adapter.provision(9, {"type": "HTTP", "network": "US", "days": 3, "quantity": 1})
        assert not result.success
        assert result.buyer_message is None  # → dùng thông báo huỷ chung

    @pytest.mark.asyncio
    async def test_invalid_loaiproxy_fails_without_purchase(self, monkeypatch):
        adapter = _adapter()
        _no_allocation(monkeypatch)
        called = AsyncMock()
        monkeypatch.setattr(adapter, "_call_once", called)

        result = await adapter.provision(9, {"type": "HTTP", "network": "vnpt", "days": 30, "quantity": 1})

        assert not result.success  # key máy phân biệt hoa thường: "vnpt" ≠ "VNPT"
        called.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_reconcile_finds_marker_and_skips_repurchase(self, monkeypatch):
        """Attempt trước timeout SAU khi TopProxy đã bán — marker od{id} trong
        listproxy là bằng chứng, retry không được mua thêm lần hai."""
        adapter = _adapter()
        _no_allocation(monkeypatch)
        holder = _capture_bind(monkeypatch)
        operations = []

        async def fake_call(path, params, *, operation, order_id=None):
            operations.append(operation)
            assert operation == "listproxy", "không được gọi muaproxy khi marker đã tồn tại"
            return [
                {"status": 100, "idproxy": 41, "ip": "1.1.1.1",
                 "proxy": "1.1.1.1:2000:odX:pw", "type": "HTTP", "time": 0},
                {"status": 100, "idproxy": 42, "ip": "2.2.2.2",
                 "proxy": "2.2.2.2:3000:od9:pw2", "type": "HTTP", "time": 0},
            ]

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        result = await adapter.provision(9, {"type": "HTTP", "network": "Viettel", "days": 30, "quantity": 1})

        assert result.success, result.error
        assert holder["assignment"].external_id == "42"
        assert operations == ["listproxy"]

    @pytest.mark.asyncio
    async def test_quantity_over_one_rejected(self, monkeypatch):
        adapter = _adapter()
        result = await adapter.provision(9, {"type": "HTTP", "network": "Viettel", "days": 30, "quantity": 2})
        assert not result.success

    @pytest.mark.asyncio
    async def test_transient_error_propagates_for_sweeper_retry(self, monkeypatch):
        """Static ĐƯỢC PHÉP raise (sweeper retry an toàn nhờ marker)."""
        adapter = _adapter()
        _no_allocation(monkeypatch)

        async def fake_call(path, params, *, operation, order_id=None):
            if operation == "listproxy":
                return []
            raise TopProxyUnavailableError("timeout")

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        with pytest.raises(TopProxyUnavailableError):
            await adapter.provision(9, {"type": "HTTP", "network": "Viettel", "days": 30, "quantity": 1})


# ---------------------------------------------------------------------------
# Provision — xoay
# ---------------------------------------------------------------------------


class TestProvisionXoay:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("days,path,thoigian", [
        # đơn vị lớn nhất chia hết số ngày thắng (giá bậc thang tốt nhất)
        (1, "/proxyxoay/apimuangay.php", 1),
        (5, "/proxyxoay/apimuangay.php", 5),
        (7, "/proxyxoay/apimuatuan.php", 1),
        (14, "/proxyxoay/apimuatuan.php", 2),
        (30, "/proxyxoay/apimuathang.php", 1),
        (60, "/proxyxoay/apimuathang.php", 2),
        # 45 không chia hết 30 lẫn 7 → mua theo ngày
        (45, "/proxyxoay/apimuangay.php", 45),
    ])
    async def test_days_pick_correct_endpoint_and_thoigian(self, monkeypatch, days, path, thoigian):
        adapter = _adapter(mode="xoay", xoay_get_url="http://127.0.0.1:9300/api/get.php")
        _no_allocation(monkeypatch)
        _capture_bind(monkeypatch)
        # Chặn cú gọi get.php "lấy proxy đầu tiên" — test này chỉ quan tâm lệnh
        # MUA đi đúng endpoint/thoigian, không phải bước lấy proxy sau đó.
        monkeypatch.setattr(
            adapter, "_fetch_xoay_proxy",
            AsyncMock(side_effect=TopProxyUnavailableError("bỏ qua trong test")),
        )
        seen = {}

        async def fake_call(p, params, *, operation, order_id=None):
            seen["path"] = p
            seen["thoigian"] = params.get("thoigian")
            return {"status": 100, "keyxoay": "rwywzSOvFNZOWDVJJBrQRb"}

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        result = await adapter.provision(9, {"type": "HTTP", "network": "Random", "days": days, "quantity": 1})

        assert result.success, result.error
        assert seen["path"] == path
        assert seen["thoigian"] == thoigian
        # Key nằm ở resource_id (nội bộ, để bind allocation) chứ KHÔNG được lọt
        # vào delivered_data — buyer đổi IP qua backend mình (phương án B1).
        assert result.resource_id == "rwywzSOvFNZOWDVJJBrQRb"
        assert "rwywzSOvFNZOWDVJJBrQRb" not in result.data
        # URL nhà cung cấp cũng KHÔNG được lọt ra — trước đây bản chụp in cả
        # link get.php kèm key, buyer gọi thẳng nguồn hàng được.
        assert "get.php" not in result.data

    @pytest.mark.asyncio
    async def test_invalid_duration_fails_before_purchase(self, monkeypatch):
        adapter = _adapter(mode="xoay")
        _no_allocation(monkeypatch)
        called = AsyncMock()
        monkeypatch.setattr(adapter, "_call_once", called)

        result = await adapter.provision(9, {"type": "HTTP", "network": "Random", "days": 0, "quantity": 1})
        assert not result.success
        called.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unclear_purchase_result_fails_instead_of_retrying(self, monkeypatch):
        """Xoay KHÔNG có marker → timeout phải thành thất bại dứt điểm
        (refund + admin đối soát), tuyệt đối không propagate cho sweeper
        retry mua trùng key."""
        adapter = _adapter(mode="xoay")
        _no_allocation(monkeypatch)

        async def fake_call(p, params, *, operation, order_id=None):
            raise TopProxyUnavailableError("timeout")

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        result = await adapter.provision(9, {"type": "HTTP", "network": "Random", "days": 1, "quantity": 1})
        assert not result.success
        assert "đối soát" in result.error
        # Có thể đã trừ Xu mà không giao được → phải gọi admin vào xem.
        assert result.operational_error

    @pytest.mark.asyncio
    async def test_second_attempt_never_buys_a_second_key(self, monkeypatch):
        """Ca mất tiền thật: attempt trước MUA THÀNH CÔNG rồi process chết
        trước khi ghi allocation. Order còn `pending` → sweeper retry. Không
        có marker nào để nhận lại key, nên dấu vết duy nhất là dòng
        provider_call_logs của lần mua trước (ghi trên session riêng nên sống
        sót qua rollback). Thấy nó thì DỪNG, không mua lại."""
        adapter = _adapter(mode="xoay", prior_xoay_purchase=True)
        _no_allocation(monkeypatch)
        called = AsyncMock()
        monkeypatch.setattr(adapter, "_call_once", called)

        result = await adapter.provision(9, {"type": "HTTP", "network": "Random", "days": 30, "quantity": 1})

        assert not result.success
        called.assert_not_awaited()  # điều quan trọng nhất: KHÔNG gọi lệnh mua
        assert result.operational_error

    @pytest.mark.asyncio
    async def test_out_of_credit_is_flagged_as_operational(self, monkeypatch):
        """102 = hết Xu: không phải "đơn này xui" mà là mọi đơn sau đều fail.
        Buyer chỉ thấy thông báo huỷ chung, admin phải nhận alert."""
        adapter = _adapter(mode="xoay")
        _no_allocation(monkeypatch)

        async def fake_call(p, params, *, operation, order_id=None):
            return {"status": 102}

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        result = await adapter.provision(9, {"type": "HTTP", "network": "Random", "days": 30, "quantity": 1})

        assert not result.success
        assert result.operational_error and result.operational_severity == "critical"
        assert "Xu" in result.error
        # Không lộ nguồn hàng cho buyer.
        assert result.buyer_message is None


# ---------------------------------------------------------------------------
# Idempotent re-delivery khi order đã có allocation
# ---------------------------------------------------------------------------


class TestRedeliver:
    @pytest.mark.asyncio
    async def test_xoay_redelivers_without_any_upstream_call(self, monkeypatch):
        adapter = _adapter(mode="xoay")

        class _Alloc:
            id = 7
            external_id = "existingkey123"
            expires_at = datetime.now(timezone.utc) + timedelta(days=3)
            # Cổng vào cố định (cache lại lúc mua) và IP đi ra gần nhất — hai
            # thứ khác nhau, xem docstring _xoay_assignment.
            external_proxy_id = "160.250.166.34:10053"
            last_public_ip = "9.9.9.9"

        monkeypatch.setattr(
            "src.resources.proxy_service.get_order_proxy_allocation",
            AsyncMock(return_value=_Alloc()),
        )
        called = AsyncMock()
        monkeypatch.setattr(adapter, "_call_once", called)

        result = await adapter.provision(9, {"type": "HTTP", "network": "Random", "days": 1, "quantity": 1})

        assert result.success
        assert result.resource_id == "existingkey123"
        # Giao lại KHÔNG được mua thêm, và cũng không được rò key ra bản chụp.
        called.assert_not_awaited()
        assert "existingkey123" not in result.data
        assert "160.250.166.34" in result.data  # cổng vào
        assert "9.9.9.9" in result.data          # IP đi ra gần nhất

    @pytest.mark.asyncio
    async def test_static_redelivers_from_listproxy_lookup(self, monkeypatch):
        adapter = _adapter()

        class _Alloc:
            id = 7
            external_id = "2772"
            expires_at = datetime.now(timezone.utc) + timedelta(days=3)

        monkeypatch.setattr(
            "src.resources.proxy_service.get_order_proxy_allocation",
            AsyncMock(return_value=_Alloc()),
        )

        async def fake_call(path, params, *, operation, order_id=None):
            assert operation == "listproxy"
            assert params["idproxy"] == "2772"
            return [{"status": 100, "idproxy": 2772, "ip": "27.73.88.211",
                     "proxy": "27.73.88.211:35270:od9:pw", "type": "HTTP", "time": 0}]

        monkeypatch.setattr(adapter, "_call_once", fake_call)
        result = await adapter.provision(9, {"type": "HTTP", "network": "Viettel", "days": 30, "quantity": 1})
        assert result.success, result.error
        assert "27.73.88.211" in result.data


class TestValidateTopProxyPricingParams:
    """Cấu hình giá mà provision() chắc chắn từ chối phải bị chặn NGAY LÚC LƯU
    sản phẩm, không phải để buyer phát hiện bằng một đơn bị huỷ.

    Sự cố 30/07: sản phẩm gắn TopProxy giữ preset mặc định của form admin
    (network_mult viết thường: fpt/vnpt/viettel) → mọi đơn bị huỷ + hoàn tiền,
    trong khi admin vẫn thấy sản phẩm "sẵn sàng bán".
    """

    def test_rejects_lowercase_network_codes(self):
        with pytest.raises(HTTPException) as exc:
            validate_topproxy_pricing_params("config", {
                "base_price": 1000,
                "network_mult": {"fpt": 0.9, "viettel": 1},
            })
        assert exc.value.status_code == 400
        assert "fpt" in exc.value.detail
        # Nêu luôn mã đúng để admin sửa được ngay, không phải đi tra tài liệu.
        assert "Viettel" in exc.value.detail

    def test_rejects_type_codes_topproxy_does_not_accept(self):
        with pytest.raises(HTTPException) as exc:
            validate_topproxy_pricing_params("config", {
                "type_mult": {"datacenter": 1, "residential_static": 1.6},
            })
        assert "datacenter" in exc.value.detail
        assert "HTTP" in exc.value.detail

    def test_rejects_non_positive_duration(self):
        with pytest.raises(HTTPException) as exc:
            validate_topproxy_pricing_params("config", {
                "network_mult": {"Viettel": 1},
                "duration_options": [{"days": 0, "label": "0 ngày"}],
            })
        assert "thời hạn" in exc.value.detail.lower()

    def test_accepts_canonical_codes(self):
        validate_topproxy_pricing_params("config", {
            "base_price": 75000,
            "type_mult": {"HTTP": 1, "SOCKS5": 1.2},
            "network_mult": {"Viettel": 1, "FPT": 0.9, "VNPT": 0.85},
            "duration_options": [{"days": 7, "label": "7 ngày"}, {"days": 30, "label": "30 ngày"}],
        })

    def test_ignores_other_strategies(self):
        # Chỉ "config" đưa type/network xuống provision; strategy khác không có
        # các key này nên validator không được phép chặn oan.
        validate_topproxy_pricing_params("credit", {"packages": [{"size": 1000}]})
        validate_topproxy_pricing_params(None, {"network_mult": {"fpt": 1}})
