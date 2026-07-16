"""Tests for the provider adapter layer."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.adapters.base import ProvisionResult
from src.adapters.factory import get_adapter
from src.adapters.manual import ManualAdapter
from src.adapters.mock import MockAdapter
from src.adapters.seller_pool import SellerPoolAdapter


# ---------------------------------------------------------------------------
# MockAdapter tests
# ---------------------------------------------------------------------------


class TestMockAdapter:
    @pytest.fixture
    def adapter(self):
        return MockAdapter(config={})

    @pytest.mark.asyncio
    async def test_provision_proxy(self, adapter):
        result = await adapter.provision(1, {"service_type": "proxy"})
        assert result.success is True
        parts = result.data.split(":")
        assert len(parts) == 4
        assert parts[0].startswith("103.45.")
        assert parts[1] == "8080"
        assert parts[2].startswith("px_user_")
        assert parts[3].startswith("px_pass_")

    @pytest.mark.asyncio
    async def test_provision_endpoint(self, adapter):
        result = await adapter.provision(2, {"service_type": "endpoint"})
        assert result.success is True
        assert result.data.startswith("px_sk_live_")
        assert len(result.data) > 20

    @pytest.mark.asyncio
    async def test_provision_takedown(self, adapter):
        result = await adapter.provision(3, {"service_type": "takedown"})
        assert result.success is True
        assert result.data.startswith("task_")

    @pytest.mark.asyncio
    async def test_provision_cloud(self, adapter):
        result = await adapter.provision(4, {"service_type": "cloud"})
        assert result.success is True
        assert "vps_" in result.data
        assert "root" in result.data
        assert "P@ss" in result.data
        assert " | " in result.data

    @pytest.mark.asyncio
    async def test_provision_default(self, adapter):
        result = await adapter.provision(5, {"service_type": "unknown_type"})
        assert result.success is True
        assert result.data.startswith("resource_")

    @pytest.mark.asyncio
    async def test_provision_no_service_type(self, adapter):
        result = await adapter.provision(6, {})
        assert result.success is True
        assert result.data.startswith("resource_")

    @pytest.mark.asyncio
    async def test_provision_returns_resource_id(self, adapter):
        result = await adapter.provision(7, {"service_type": "proxy"})
        assert result.resource_id is not None
        assert result.resource_id.startswith("mock_")

    @pytest.mark.asyncio
    async def test_provision_metadata(self, adapter):
        result = await adapter.provision(8, {"service_type": "endpoint"})
        assert result.metadata["provider"] == "mock"
        assert result.metadata["service_type"] == "endpoint"

    @pytest.mark.asyncio
    async def test_check_health(self, adapter):
        health = await adapter.check_health()
        assert health["status"] == "healthy"
        assert health["latency_ms"] == 12
        assert health["message"] == "Mock provider"

    @pytest.mark.asyncio
    async def test_get_usage(self, adapter):
        usage = await adapter.get_usage("any_id")
        assert usage["requests_today"] == 89
        assert usage["credits_used"] == 1153
        assert usage["credits_remaining"] == 3847

    @pytest.mark.asyncio
    async def test_revoke(self, adapter):
        assert await adapter.revoke("any_id") is True


# ---------------------------------------------------------------------------
# Factory tests (mocked DB)
# ---------------------------------------------------------------------------


def _make_provider(
    id: int,
    adapter_type: str = "mock",
    is_active: bool = True,
    fallback_provider_id: int | None = None,
    config: dict | None = None,
    name: str = "Test",
):
    """Create a mock Provider object without needing the real ORM."""
    p = MagicMock()
    p.id = id
    p.name = name
    p.adapter_type = adapter_type
    p.is_active = is_active
    p.fallback_provider_id = fallback_provider_id
    p.config = config or {}
    return p


class TestAdapterFactory:
    @pytest.mark.asyncio
    async def test_returns_mock_adapter(self):
        provider = _make_provider(1, adapter_type="mock")
        db = AsyncMock()
        db.get = AsyncMock(return_value=provider)

        adapter = await get_adapter(1, db)
        assert isinstance(adapter, MockAdapter)

    @pytest.mark.asyncio
    async def test_returns_seller_pool_adapter(self):
        provider = _make_provider(2, adapter_type="seller_pool")
        db = AsyncMock()
        db.get = AsyncMock(return_value=provider)

        adapter = await get_adapter(2, db)
        assert isinstance(adapter, SellerPoolAdapter)

    @pytest.mark.asyncio
    async def test_returns_manual_adapter(self):
        provider = _make_provider(3, adapter_type="manual")
        db = AsyncMock()
        db.get = AsyncMock(return_value=provider)

        adapter = await get_adapter(3, db)
        assert isinstance(adapter, ManualAdapter)

    @pytest.mark.asyncio
    async def test_follows_fallback_chain(self):
        inactive = _make_provider(
            1, adapter_type="mock", is_active=False, fallback_provider_id=2
        )
        fallback = _make_provider(2, adapter_type="mock", is_active=True)

        db = AsyncMock()
        db.get = AsyncMock(side_effect=lambda cls, pid: {1: inactive, 2: fallback}[pid])

        adapter = await get_adapter(1, db)
        assert isinstance(adapter, MockAdapter)

    @pytest.mark.asyncio
    async def test_inactive_no_fallback_raises(self):
        provider = _make_provider(
            1, adapter_type="mock", is_active=False, name="Dead Provider"
        )
        db = AsyncMock()
        db.get = AsyncMock(return_value=provider)

        with pytest.raises(ValueError, match="inactive with no fallback"):
            await get_adapter(1, db)

    @pytest.mark.asyncio
    async def test_provider_not_found_raises(self):
        db = AsyncMock()
        db.get = AsyncMock(return_value=None)

        with pytest.raises(ValueError, match="not found"):
            await get_adapter(999, db)

    @pytest.mark.asyncio
    async def test_unknown_adapter_type_raises(self):
        provider = _make_provider(1, adapter_type="nonexistent")
        db = AsyncMock()
        db.get = AsyncMock(return_value=provider)

        with pytest.raises(ValueError, match="Unknown adapter_type"):
            await get_adapter(1, db)

    @pytest.mark.asyncio
    async def test_fallback_chain_max_depth(self):
        """Fallback chain exceeding max depth should raise."""
        providers = {}
        for i in range(1, 6):
            providers[i] = _make_provider(
                i, adapter_type="mock", is_active=False, fallback_provider_id=i + 1
            )
        # Provider 6 doesn't exist
        db = AsyncMock()
        db.get = AsyncMock(side_effect=lambda cls, pid: providers.get(pid))

        with pytest.raises(ValueError):
            await get_adapter(1, db)

    @pytest.mark.asyncio
    async def test_adapter_receives_config(self):
        config = {"api_key": "test123", "base_url": "http://example.com"}
        provider = _make_provider(1, adapter_type="mock", config=config)
        db = AsyncMock()
        db.get = AsyncMock(return_value=provider)

        adapter = await get_adapter(1, db)
        assert adapter.config == config

    @pytest.mark.asyncio
    async def test_returns_real_api_adapter_for_topproxy_and_scrapecreators(self):
        from src.adapters.real_api import RealApiAdapter

        for adapter_type in ("topproxy", "scrapecreators"):
            provider = _make_provider(10, adapter_type=adapter_type)
            db = AsyncMock()
            db.get = AsyncMock(return_value=provider)
            adapter = await get_adapter(10, db)
            assert isinstance(adapter, RealApiAdapter)


# ---------------------------------------------------------------------------
# RealApiAdapter tests
# ---------------------------------------------------------------------------


class TestRealApiAdapter:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        # Retry backoff would otherwise add real wall-clock delay to the suite.
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_provision_success_sends_auth_and_idempotency_headers(self, monkeypatch):
        import httpx
        from src.adapters.real_api import RealApiAdapter
        from src.security.crypto import encrypt_str

        ok_response = httpx.Response(
            200, json={"success": True, "data": "res-data", "resource_id": "res-1"},
            request=httpx.Request("POST", "https://api.example.com/provision"),
        )
        mock_request = AsyncMock(return_value=ok_response)
        monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

        adapter = RealApiAdapter({
            "base_url": "https://api.example.com",
            "api_key": encrypt_str("secret123"),
        })
        result = await adapter.provision(order_id=42, user_config={"foo": "bar"})

        assert result.success is True
        assert result.data == "res-data"
        assert result.resource_id == "res-1"
        mock_request.assert_awaited_once()
        _, kwargs = mock_request.call_args
        assert kwargs["headers"]["Idempotency-Key"] == "order-42-provision"
        assert kwargs["headers"]["Authorization"] == "Bearer secret123"

    @pytest.mark.asyncio
    async def test_provision_retries_on_5xx_then_succeeds(self, monkeypatch):
        import httpx
        from src.adapters.real_api import RealApiAdapter

        fail = httpx.Response(500, request=httpx.Request("POST", "https://api.example.com/provision"))
        ok = httpx.Response(
            200, json={"success": True, "data": "d", "resource_id": "r"},
            request=httpx.Request("POST", "https://api.example.com/provision"),
        )
        mock_request = AsyncMock(side_effect=[fail, fail, ok])
        monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

        adapter = RealApiAdapter({"base_url": "https://api.example.com"})
        result = await adapter.provision(order_id=1, user_config={})

        assert result.success is True
        assert mock_request.await_count == 3
        keys = {c.kwargs["headers"]["Idempotency-Key"] for c in mock_request.call_args_list}
        assert keys == {"order-1-provision"}

    @pytest.mark.asyncio
    async def test_provision_gives_up_after_max_attempts(self, monkeypatch):
        import httpx
        from src.adapters.real_api import RealApiAdapter

        fail = httpx.Response(500, request=httpx.Request("POST", "https://api.example.com/provision"))
        mock_request = AsyncMock(return_value=fail)
        monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

        adapter = RealApiAdapter({"base_url": "https://api.example.com"})
        result = await adapter.provision(order_id=2, user_config={})

        assert result.success is False
        assert mock_request.await_count == 3

    @pytest.mark.asyncio
    async def test_provision_does_not_retry_on_4xx(self, monkeypatch):
        import httpx
        from src.adapters.real_api import RealApiAdapter

        bad_request = httpx.Response(
            400, json={"success": False, "error": "invalid config"},
            request=httpx.Request("POST", "https://api.example.com/provision"),
        )
        mock_request = AsyncMock(return_value=bad_request)
        monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

        adapter = RealApiAdapter({"base_url": "https://api.example.com"})
        result = await adapter.provision(order_id=3, user_config={})

        assert result.success is False
        assert mock_request.await_count == 1

    @pytest.mark.asyncio
    async def test_constructor_decrypts_api_key(self):
        from src.adapters.real_api import RealApiAdapter
        from src.security.crypto import encrypt_str

        adapter = RealApiAdapter({"base_url": "https://api.example.com", "api_key": encrypt_str("plain-key")})
        assert adapter.api_key == "plain-key"
