"""Task 1 — parsing + adapter behavior for DProxyAdapter. See
docs/superpowers/specs/2026-07-22-dproxy-integration.md.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import pytest

from src.adapters.dproxy import (
    DProxyAdapter,
    DProxyAuthError,
    DProxyContractError,
    DProxyUnavailableError,
    _parse_assignment,
    expected_rotate_path,
    validate_dproxy_config,
)
from src.security.crypto import encrypt_str

FUTURE = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
PAST = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
EXT_ID = "cab68c1a-707c-4148-a326-e69e99c870db"


def _sample(**overrides) -> dict:
    base = {
        "id": EXT_ID,
        "assigned_at": "2026-07-20T12:35:46.296225+00:00",
        "expired_at": FUTURE,
        "status": "active",
        "username": "u_24_pkvgq9za",
        "password": "pass",
        "is_active": True,
        "proxies": {
            "host": "s4.dproxy.info",
            "port": 20160,
            "status": {"msg": "online"},
            "proxy_id": "54f6fb0c-45cf-4a6a-9ecf-2797f50f94f8",
            "ip_public": "116.106.0.187",
            "rotation": {
                "available": True,
                "mode": "pppoe",
                "cooldown_seconds": None,
                "last_rotated_at": None,
                "rotate_endpoint": f"/api/v1/proxies/user/{EXT_ID}/rotate",
            },
        },
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# _parse_assignment
# ---------------------------------------------------------------------------


class TestParseAssignment:
    def test_sample_payload_parses(self):
        a = _parse_assignment(_sample())
        assert a is not None
        assert a.external_id == EXT_ID
        assert a.host == "s4.dproxy.info"
        assert a.port == 20160
        assert a.username == "u_24_pkvgq9za"
        assert a.password == "pass"
        assert a.public_ip == "116.106.0.187"
        assert a.rotation_available is True
        assert a.rotate_path == f"/api/v1/proxies/user/{EXT_ID}/rotate"

    def test_invalid_top_level_object_returns_none(self):
        assert _parse_assignment("not a dict") is None
        assert _parse_assignment(None) is None
        assert _parse_assignment(123) is None

    def test_missing_proxies_object_returns_none(self):
        item = _sample()
        del item["proxies"]
        assert _parse_assignment(item) is None

    def test_nullable_nested_fields_handled(self):
        item = _sample()
        item["proxies"]["proxy_id"] = None
        item["proxies"]["ip_public"] = None
        item["proxies"]["rotation"] = None
        a = _parse_assignment(item)
        assert a is not None
        assert a.proxy_id is None
        assert a.public_ip is None
        assert a.rotation_available is False
        assert a.rotate_path is None

    def test_numeric_port_and_string_port_both_parse(self):
        item_numeric = _sample()
        item_numeric["proxies"]["port"] = 20160
        assert _parse_assignment(item_numeric).port == 20160

        item_string = _sample()
        item_string["proxies"]["port"] = "20160"
        assert _parse_assignment(item_string).port == 20160

    def test_non_numeric_port_returns_none(self):
        item = _sample()
        item["proxies"]["port"] = "not-a-port"
        assert _parse_assignment(item) is None

    def test_malformed_timestamp_returns_none(self):
        item = _sample()
        item["expired_at"] = "not-a-date"
        assert _parse_assignment(item) is None

    def test_missing_credentials_returns_none(self):
        for field in ("username", "password"):
            item = _sample()
            del item[field]
            assert _parse_assignment(item) is None, field

    def test_missing_host_or_port_returns_none(self):
        item = _sample()
        del item["proxies"]["host"]
        assert _parse_assignment(item) is None

    def test_inactive_entry_parses_as_offline(self):
        """review fixes Blocker 2 — two-stage parsing: structurally-valid
        but currently-unusable rows still parse (as `online=False`), they
        just aren't `is_usable()`. Only a genuinely malformed row returns
        None."""
        item = _sample(status="inactive")
        a = _parse_assignment(item)
        assert a is not None
        assert a.online is False
        assert a.is_usable() is False

    def test_is_active_false_parses_as_offline(self):
        item = _sample(is_active=False)
        a = _parse_assignment(item)
        assert a is not None
        assert a.online is False

    def test_offline_status_parses_as_offline(self):
        item = _sample()
        item["proxies"]["status"] = {"msg": "offline"}
        a = _parse_assignment(item)
        assert a is not None
        assert a.online is False

    def test_expired_entry_parses_but_is_not_usable(self):
        item = _sample(expired_at=PAST)
        a = _parse_assignment(item)
        assert a is not None
        assert a.online is True  # status/is_active/proxy status are all fine — only expiry is the issue
        assert a.is_usable() is False

    def test_unexpected_rotate_endpoint_shape_is_dropped_not_trusted(self):
        item = _sample()
        item["proxies"]["rotation"]["rotate_endpoint"] = "https://evil.example.com/steal"
        a = _parse_assignment(item)
        assert a is not None
        assert a.rotate_path is None
        assert a.rotation_available is False

    def test_multiple_assignments_each_parse_independently(self):
        id1, id2, id3 = (
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
        )
        items = [_sample(id=id1), _sample(id=id2), {"garbage": True}, _sample(id=id3, status="rejected")]
        parsed = [p for p in (_parse_assignment(i) for i in items) if p is not None]
        # The malformed dict is dropped; the "rejected" row still parses
        # (structurally valid) but online=False.
        assert {p.external_id for p in parsed} == {id1, id2, id3}
        by_id = {p.external_id: p for p in parsed}
        assert by_id[id3].online is False

    def test_empty_array_yields_nothing(self):
        assert [p for p in (_parse_assignment(i) for i in []) if p is not None] == []


def test_expected_rotate_path_matches_sample_contract():
    assert expected_rotate_path(EXT_ID) == f"/api/v1/proxies/user/{EXT_ID}/rotate"


class TestExternalIdMustBeUuid:
    """review fixes Blocker 3 — external_id comes from the supplier and must
    never be allowed to influence an actionable request path unless it's a
    canonical UUID. expected_rotate_path is the single enforcement point,
    used both by _parse_assignment (so a hostile id can't even survive
    parsing far enough to be delivered/bound) and by the rotate call itself."""

    def test_expected_rotate_path_rejects_path_traversal(self):
        with pytest.raises(ValueError):
            expected_rotate_path("../../health")

    def test_expected_rotate_path_rejects_extra_path_segment(self):
        with pytest.raises(ValueError):
            expected_rotate_path("abc/rotate")

    def test_expected_rotate_path_rejects_query_string(self):
        with pytest.raises(ValueError):
            expected_rotate_path("abc?x=1")

    def test_expected_rotate_path_rejects_fragment(self):
        with pytest.raises(ValueError):
            expected_rotate_path("abc#fragment")

    def test_expected_rotate_path_rejects_excessive_length(self):
        with pytest.raises(ValueError):
            expected_rotate_path("a" * 300)

    def test_expected_rotate_path_accepts_canonical_uuid(self):
        assert expected_rotate_path(EXT_ID) == f"/api/v1/proxies/user/{EXT_ID}/rotate"

    def test_parse_assignment_drops_row_with_path_traversal_id(self):
        item = _sample(id="../../health")
        assert _parse_assignment(item) is None

    def test_parse_assignment_drops_row_with_slash_in_id(self):
        item = _sample(id="abc/rotate")
        assert _parse_assignment(item) is None

    def test_parse_assignment_drops_row_with_query_string_id(self):
        item = _sample(id="abc?x=1")
        assert _parse_assignment(item) is None

    def test_parse_assignment_accepts_canonical_uuid_id(self):
        item = _sample(id=EXT_ID)
        a = _parse_assignment(item)
        assert a is not None
        assert a.external_id == EXT_ID

    def test_parse_assignment_normalizes_uuid_casing(self):
        item = _sample(id=EXT_ID.upper())
        item["proxies"]["rotation"]["rotate_endpoint"] = f"/api/v1/proxies/user/{EXT_ID}/rotate"
        a = _parse_assignment(item)
        assert a is not None
        assert a.external_id == EXT_ID  # canonical (lowercase) form


# ---------------------------------------------------------------------------
# DProxyAdapter.list_assignments / rotate_assignment (HTTP mocked)
# ---------------------------------------------------------------------------


def _adapter(**config_overrides) -> DProxyAdapter:
    # RealApiAdapter.__init__ treats config["api_key"] as already-encrypted
    # (matches how a real Provider row loads it — encrypted at rest by
    # providers/service.py) — encrypt it here too so decrypt_str doesn't choke.
    config = {"base_url": "https://dproxy.example.com", "api_key": encrypt_str("k")}
    config.update(config_overrides)
    return DProxyAdapter(config, db=None, provider_id=1)


def _resp(status: int, json_body=None) -> httpx.Response:
    request = httpx.Request("GET", "https://dproxy.example.com/api/v1/proxies/user")
    return httpx.Response(status, json=json_body, request=request)


class TestListAssignments:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_list_assignments_returns_everything_parseable_online_or_not(self, monkeypatch):
        """review fixes Blocker 2: list_assignments() itself no longer
        filters to usable — that's ProxyAssignment.is_usable(), applied by
        each caller (provisioning, reconciliation) as appropriate."""
        id_a, id_b = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
        adapter = _adapter()
        payload = [_sample(id=id_a), _sample(id=id_b, status="inactive")]
        monkeypatch.setattr(httpx.AsyncClient, "request", AsyncMock(return_value=_resp(200, payload)))
        result = await adapter.list_assignments()
        by_id = {a.external_id: a for a in result}
        assert set(by_id) == {id_a, id_b}
        assert by_id[id_a].online is True
        assert by_id[id_b].online is False

    @pytest.mark.asyncio
    async def test_non_list_top_level_raises_contract_error(self, monkeypatch):
        adapter = _adapter()
        monkeypatch.setattr(httpx.AsyncClient, "request", AsyncMock(return_value=_resp(200, {"not": "a list"})))
        with pytest.raises(DProxyContractError):
            await adapter.list_assignments()

    @pytest.mark.asyncio
    async def test_401_raises_auth_error(self, monkeypatch):
        adapter = _adapter()
        monkeypatch.setattr(httpx.AsyncClient, "request", AsyncMock(return_value=_resp(401)))
        with pytest.raises(DProxyAuthError):
            await adapter.list_assignments()

    @pytest.mark.asyncio
    async def test_500_raises_unavailable_error(self, monkeypatch):
        adapter = _adapter()
        monkeypatch.setattr(httpx.AsyncClient, "request", AsyncMock(return_value=_resp(500)))
        with pytest.raises(DProxyUnavailableError):
            await adapter.list_assignments()

    @pytest.mark.asyncio
    async def test_network_error_raises_unavailable_error(self, monkeypatch):
        adapter = _adapter()
        monkeypatch.setattr(
            httpx.AsyncClient, "request", AsyncMock(side_effect=httpx.ConnectError("boom")),
        )
        with pytest.raises(DProxyUnavailableError):
            await adapter.list_assignments()

    @pytest.mark.asyncio
    async def test_header_auth_type_uses_configured_header(self, monkeypatch):
        adapter = _adapter(auth_type="header", auth_header="X-Custom-Key")
        mock = AsyncMock(return_value=_resp(200, []))
        monkeypatch.setattr(httpx.AsyncClient, "request", mock)
        await adapter.list_assignments()
        headers = mock.call_args.kwargs["headers"]
        assert headers["X-Custom-Key"] == "k"
        assert "Authorization" not in headers


class TestRotateAssignment:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_rotate_then_relists_for_authoritative_state(self, monkeypatch):
        adapter = _adapter()
        rotated = _sample()
        rotated["proxies"]["ip_public"] = "9.9.9.9"
        responses = [_resp(200, {"ok": True}), _resp(200, [rotated])]
        mock = AsyncMock(side_effect=responses)
        monkeypatch.setattr(httpx.AsyncClient, "request", mock)
        result = await adapter.rotate_assignment(EXT_ID)
        assert result.public_ip == "9.9.9.9"
        assert mock.call_args_list[0].args[1].endswith(expected_rotate_path(EXT_ID))

    @pytest.mark.asyncio
    async def test_rotate_with_a_tampered_non_uuid_external_id_never_calls_out(self, monkeypatch):
        """Defense in depth: even if something upstream of this call (a
        corrupted DB row) skipped _parse_assignment's UUID check, rotate_assignment
        must still refuse to build a request from it."""
        adapter = _adapter()
        mock = AsyncMock()
        monkeypatch.setattr(httpx.AsyncClient, "request", mock)
        with pytest.raises(DProxyContractError):
            await adapter.rotate_assignment("../../health")
        mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_redirect_response_is_treated_as_contract_error_not_followed(self, monkeypatch):
        adapter = _adapter()
        monkeypatch.setattr(httpx.AsyncClient, "request", AsyncMock(return_value=_resp(302)))
        with pytest.raises(DProxyContractError):
            await adapter.rotate_assignment(EXT_ID)

    @pytest.mark.asyncio
    async def test_missing_from_post_rotate_list_raises_contract_error(self, monkeypatch):
        adapter = _adapter()
        responses = [_resp(200, {"ok": True}), _resp(200, [])]
        monkeypatch.setattr(httpx.AsyncClient, "request", AsyncMock(side_effect=responses))
        with pytest.raises(DProxyContractError):
            await adapter.rotate_assignment(EXT_ID)


# ---------------------------------------------------------------------------
# validate_dproxy_config
# ---------------------------------------------------------------------------


class TestValidateDproxyConfig:
    @pytest.mark.asyncio
    async def test_accepts_http_scheme_for_admin_authored_local_dev_config(self):
        """Admin-created providers are trusted input (same boundary as
        scripts/mock_seller.py's http://localhost workflow) — this must
        keep working for scripts/mock_dproxy.py's documented
        http://127.0.0.1:9200 setup (docs/dproxy-mock-runbook.md)."""
        await validate_dproxy_config({"base_url": "http://127.0.0.1:9200", "api_key": "k"})

    @pytest.mark.asyncio
    async def test_rejects_non_http_scheme(self):
        with pytest.raises(Exception):
            await validate_dproxy_config({"base_url": "ftp://dproxy.example.com"})

    @pytest.mark.asyncio
    async def test_rejects_missing_host(self):
        with pytest.raises(Exception):
            await validate_dproxy_config({"base_url": "https:///no-host"})

    @pytest.mark.asyncio
    async def test_rejects_credentials_in_url(self):
        with pytest.raises(Exception):
            await validate_dproxy_config({"base_url": "https://user:pass@dproxy.example.com"})

    @pytest.mark.asyncio
    async def test_rejects_query_string(self):
        with pytest.raises(Exception):
            await validate_dproxy_config({"base_url": "https://dproxy.example.com?x=1"})

    @pytest.mark.asyncio
    async def test_rejects_bad_auth_type(self):
        with pytest.raises(Exception):
            await validate_dproxy_config({"base_url": "https://dproxy.example.com", "auth_type": "basic"})

    @pytest.mark.asyncio
    async def test_header_auth_type_requires_auth_header(self):
        with pytest.raises(Exception):
            await validate_dproxy_config({"base_url": "https://dproxy.example.com", "auth_type": "header"})

    @pytest.mark.asyncio
    async def test_rejects_bad_rotate_method(self):
        with pytest.raises(Exception):
            await validate_dproxy_config({"base_url": "https://dproxy.example.com", "rotate_method": "DELETE"})

    @pytest.mark.asyncio
    async def test_accepts_well_formed_config(self):
        await validate_dproxy_config({"base_url": "https://dproxy.example.com", "api_key": "k"})
