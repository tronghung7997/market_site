import asyncio
import time
from uuid import uuid4

import httpx
import structlog

from src.adapters.base import ProviderAdapter, ProvisionResult
from src.adapters.call_log import record_provider_call
from src.security.crypto import decrypt_str
from src.security.ssrf_guard import validate_seller_base_url

logger = structlog.get_logger()

_MAX_ATTEMPTS = 3
_TIMEOUT = 5.0


class RealApiAdapter(ProviderAdapter):
    """Calls a real external supplier API (topproxy/scrapecreators — the actual
    provider is picked per Provider row via base_url; both adapter_type values
    map to this same class since the request shape is identical, only the
    endpoint differs).

    Convention assumed until a real API doc is available: Bearer auth,
    JSON body/response {success, data, error}, Idempotency-Key header on
    provisioning calls so a retried request doesn't double-provision.
    """

    def __init__(self, config: dict, provider_id: int | None = None, seller_owned: bool = False):
        super().__init__(config)
        self.provider_id = provider_id
        self.base_url: str = (config.get("base_url") or "").rstrip("/")
        # seller_owned = provider.seller_id is not None (src/adapters/factory.py) —
        # only seller-supplied base_url is untrusted input; admin-created providers
        # (incl. http://localhost for scripts/mock_seller.py during local dev)
        # intentionally skip this.
        self._seller_owned = seller_owned
        raw_key = config.get("api_key")
        self.api_key: str | None = decrypt_str(raw_key) if raw_key else None

    def _headers(self, idempotency_key: str | None = None) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    async def _request_with_retry(
        self,
        method: str,
        path: str,
        *,
        operation: str,
        order_id: int | None = None,
        idempotency_key: str | None = None,
        **kwargs,
    ) -> httpx.Response:
        if self._seller_owned:
            # Re-checked on every call, not just at config-save time: DNS for a
            # seller's own domain is under the seller's own control, so a
            # base_url that resolved to a public IP at signup can be repointed
            # at an internal address later (see src/security/ssrf_guard.py).
            await validate_seller_base_url(f"{self.base_url}/")

        last_error: Exception | None = None
        # follow_redirects=False is httpx's default already; set explicitly —
        # a redirect response from a provider we don't fully trust (seller-
        # supplied, or DProxy's rotate call which must never silently follow
        # a 3xx to an unvalidated location) must come back as a plain
        # Response, not be transparently followed.
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
            for attempt in range(_MAX_ATTEMPTS):
                started = time.perf_counter()
                status_code: int | None = None
                error: str | None = None
                try:
                    resp = await client.request(method, f"{self.base_url}{path}", **kwargs)
                    status_code = resp.status_code
                    if resp.status_code >= 500:
                        last_error = httpx.HTTPStatusError(
                            f"server error {resp.status_code}", request=resp.request, response=resp,
                        )
                        error = str(last_error)
                except httpx.HTTPError as e:
                    last_error = e
                    error = str(e)
                    resp = None

                await record_provider_call(
                    provider_id=self.provider_id,
                    order_id=order_id,
                    operation=operation,
                    method=method,
                    path=path,
                    attempt=attempt + 1,
                    status_code=status_code,
                    latency_ms=int((time.perf_counter() - started) * 1000),
                    success=status_code is not None and status_code < 400,
                    error=error,
                    idempotency_key=idempotency_key,
                )

                if resp is not None and resp.status_code < 500:
                    return resp
                if attempt < _MAX_ATTEMPTS - 1:
                    await asyncio.sleep(0.5 * (2 ** attempt))
        assert last_error is not None
        raise last_error

    async def provision(self, order_id: int, user_config: dict) -> ProvisionResult:
        # A real order keys off order_id so the in-call retries don't double-provision.
        # The admin "test provider" button passes order_id=0 and means the opposite:
        # every press is meant to hit the provider fresh, so a fixed key would let the
        # provider replay the first test's cached response forever.
        if order_id:
            idempotency_key = f"order-{order_id}-provision"
        else:
            idempotency_key = f"test-{uuid4()}-provision"
        try:
            resp = await self._request_with_retry(
                "POST", "/provision",
                operation="provision",
                order_id=order_id or None,
                idempotency_key=idempotency_key,
                headers=self._headers(idempotency_key),
                json={"order_id": order_id, **user_config},
            )
            body = resp.json()
            if resp.status_code >= 400 or not body.get("success", False):
                return ProvisionResult(success=False, error=body.get("error") or f"HTTP {resp.status_code}")
            return ProvisionResult(
                success=True, data=body.get("data"), resource_id=body.get("resource_id"),
                metadata={"provider": "real_api"},
            )
        except httpx.HTTPError as e:
            logger.error("real_api_provision_failed", order_id=order_id, error=str(e))
            return ProvisionResult(success=False, error="Không thể kết nối nhà cung cấp")

    async def call(
        self,
        order_id: int,
        path: str,
        *,
        method: str = "GET",
        params: dict | None = None,
        json_body: dict | None = None,
    ) -> httpx.Response:
        """Forward one buyer request to the seller's real backend — the
        per-request counterpart to `provision()`. Used by the gateway router
        (`src/gateway/router.py`) for strategy=credit orders on a
        `seller_gateway` provider: retries/logging are the same machinery as
        `provision()`. The idempotency key is fresh per call (not per order —
        an order makes many calls over its lifetime) so internal retries of
        *this* call collapse to one, without the seller's backend mistaking
        two distinct buyer calls for a replay of the same one.
        """
        idempotency_key = f"order-{order_id}-{uuid4()}"
        return await self._request_with_retry(
            method, path,
            operation="gateway_call",
            order_id=order_id,
            idempotency_key=idempotency_key,
            headers=self._headers(idempotency_key),
            params=params,
            json=json_body,
        )

    async def check_health(self) -> dict:
        try:
            resp = await self._request_with_retry(
                "GET", "/health", operation="check_health", headers=self._headers(),
            )
            if resp.status_code >= 400:
                return {"status": "unhealthy", "message": f"HTTP {resp.status_code}"}
            return {"status": "healthy", **resp.json()}
        except httpx.HTTPError as e:
            logger.error("real_api_health_check_failed", error=str(e))
            return {"status": "unhealthy", "message": "Không thể kết nối nhà cung cấp"}

    async def get_usage(self, resource_id: str) -> dict | None:
        try:
            resp = await self._request_with_retry(
                "GET", f"/resources/{resource_id}/usage",
                operation="get_usage",
                headers=self._headers(),
            )
            if resp.status_code >= 400:
                return None
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("real_api_get_usage_failed", resource_id=resource_id, error=str(e))
            return None

    async def revoke(self, resource_id: str) -> bool:
        try:
            resp = await self._request_with_retry(
                "DELETE", f"/resources/{resource_id}",
                operation="revoke",
                headers=self._headers(),
            )
            return resp.status_code < 400
        except httpx.HTTPError as e:
            logger.error("real_api_revoke_failed", resource_id=resource_id, error=str(e))
            return False
