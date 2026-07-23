"""TopProxyAdapter — contract thật topproxy.vn. Xem
docs/superpowers/specs/2026-07-23-topproxy-research.md và src/adapters/topproxy.py.

Trọng tâm: mapping tham số ConfigPricing → apiv2, map mã lỗi status số,
và kỷ luật idempotency tự chế (marker user cho tĩnh, fail-fast cho xoay).
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from src.adapters.topproxy import (
    TopProxyAdapter,
    TopProxyUnavailableError,
    _parse_proxy_string,
    validate_topproxy_config,
)
from src.security.crypto import encrypt_str


def _adapter(mode: str = "static", **extra) -> TopProxyAdapter:
    config = {
        "base_url": "http://topproxy.test",
        "api_key": encrypt_str("real-key"),
        "mode": mode,
        **extra,
    }
    return TopProxyAdapter(config, db=AsyncMock(), provider_id=77)


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


class TestProvisionStatic:
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
        assert "rwywzSOvFNZOWDVJJBrQRb" in result.data
        assert "http://127.0.0.1:9300/api/get.php" in result.data

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


# ---------------------------------------------------------------------------
# Idempotent re-delivery khi order đã có allocation
# ---------------------------------------------------------------------------


class TestRedeliver:
    @pytest.mark.asyncio
    async def test_xoay_redelivers_key_without_any_upstream_call(self, monkeypatch):
        adapter = _adapter(mode="xoay")

        class _Alloc:
            id = 7
            external_id = "existingkey123"
            expires_at = datetime.now(timezone.utc) + timedelta(days=3)

        monkeypatch.setattr(
            "src.resources.proxy_service.get_order_proxy_allocation",
            AsyncMock(return_value=_Alloc()),
        )
        called = AsyncMock()
        monkeypatch.setattr(adapter, "_call_once", called)

        result = await adapter.provision(9, {"type": "HTTP", "network": "Random", "days": 1, "quantity": 1})
        assert result.success
        assert "existingkey123" in result.data
        called.assert_not_awaited()

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
