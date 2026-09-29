"""Token API bán theo số lượng: buyer mua N token, sàn xin nguồn một lô rồi giao
từng access_token thành một dòng hàng.

Hợp đồng nguồn (2026-09-29, bản dev của đối tác):

- ``POST {base_url}/keys {"tokens": N, "order_id": "<mã đơn>"}`` → ``{api_key,
  api_key_id, tokens}`` — cấp một key riêng cho lô; ``tokens`` có thể < N khi
  kho nguồn không đủ.
- ``GET {base_url}/customer/tokens?page=&limit=`` với header ``X-API-Key: <api_key
  vừa cấp>`` → ``{data: [{id, access_token}], page, limit, total}``.

Key của sàn với nguồn (nếu có) đi theo config RealApiAdapter: ``api_key`` +
``auth_query_param`` (nguồn thật: ``?api_key=``) hoặc ``auth_header``.

Chỉ giao ``access_token`` cho buyer; ``api_key`` của lô không lưu ở đâu (chỉ
``api_key_id`` vào nhật ký lệnh mua để đối soát với nguồn).

Nguồn không có catalog/tồn kho/số dư: catalog là một SKU ``token`` dựng từ
config (``cost_price``, ``stock_cap``), nên nó đi trọn khung
CatalogSupplierAdapter (một lệnh mua mỗi đơn, nhật ký "Đơn mua từ nguồn",
Resource theo dòng để khiếu nại/hoàn từng token). Giao thiếu → giao phần có,
hoàn phần thiếu (``accepts_partial_delivery``).

Không tự tạm dừng nguồn: cầu dao mặc định tắt, health check lỗi chỉ là
warning, không lỗi nào được coi là "hết tiền" (nhánh đó tắt provider).
"""
from __future__ import annotations

import asyncio
import time
from decimal import Decimal

import httpx
import structlog

from src.adapters.call_log import record_provider_call
from src.adapters.supplier import (
    PURCHASE_AUTH,
    PURCHASE_INVALID,
    PURCHASE_OUT_OF_STOCK,
    PURCHASE_UNKNOWN,
    CatalogSupplierAdapter,
    PurchaseOutcome,
    SupplierAuthError,
    SupplierContractError,
    SupplierUnavailableError,
    UpstreamListing,
)
from src.models.order import Order

logger = structlog.get_logger()

# Tương đối với base_url — base_url mang cả tiền tố của nguồn
# (vd https://lookup.ghlab.info/api/v1/fb-token-module).
KEYS_PATH = "/keys"
TOKENS_PATH = "/customer/tokens"
SKU = "token"

_DEFAULT_TIMEOUT = 20.0
_DEFAULT_PAGE_SIZE = 100
_DEFAULT_STOCK_CAP = 100_000
_MAX_PAGES = 100
# Trần cứng số token mỗi đơn; admin hạ xuống ở Cài đặt nguồn (config.max_per_order,
# AdapterSpec.max_quantity_per_order → orders chặn trước khi trừ ví).
MAX_PER_ORDER = 1000
# Đọc token là thao tác chỉ-đọc bằng key của lô → thử lại an toàn.
_READ_ATTEMPTS = 3


def _positive_int(config: dict, key: str, default: int) -> int:
    try:
        value = int(config.get(key) or default)
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


async def validate_token_keys_config(config: dict) -> None:
    """Hook AdapterSpec.validate_config — chạy khi admin lưu provider."""
    from fastapi import HTTPException

    base_url = (config.get("base_url") or "").strip()
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="token_keys: base_url phải bắt đầu bằng http:// hoặc https://")
    for key in ("timeout_seconds", "page_size", "stock_cap"):
        if config.get(key) not in (None, ""):
            try:
                if float(config[key]) <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"token_keys: {key} phải là số dương") from None
    if config.get("cost_price") not in (None, ""):
        try:
            if int(config["cost_price"]) < 0:
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="token_keys: cost_price phải là số nguyên ≥ 0") from None


def _classify(status_code: int, body: dict) -> str:
    text = str(body.get("error") or body.get("detail") or body.get("message") or "").lower()
    if status_code in (401, 403):
        return PURCHASE_AUTH
    if status_code in (409, 410) or "stock" in text or "hết" in text:
        return PURCHASE_OUT_OF_STOCK
    if status_code in (400, 422):
        return PURCHASE_INVALID
    return PURCHASE_UNKNOWN


class TokenKeysAdapter(CatalogSupplierAdapter):
    accepts_partial_delivery = True
    zero_stock_on_shortage = False

    def __init__(self, config: dict, *, db=None, provider_id: int | None = None, seller_owned: bool = False):
        super().__init__(config, db=db, provider_id=provider_id, seller_owned=seller_owned)
        if not config.get("timeout_seconds"):
            self.timeout = _DEFAULT_TIMEOUT

    def auto_pause_after(self) -> int:
        # Tạm thời không tự dừng bán nguồn này (quyết định 2026-09-29); admin
        # vẫn bật lại được bằng config.auto_pause_after_failures.
        try:
            return int(self.config.get("auto_pause_after_failures") or 0)
        except (TypeError, ValueError):
            return 0

    # ------------------------------------------------------------------
    # HTTP — mỗi lần gọi một attempt, log provider_call_logs (không kèm key)
    # ------------------------------------------------------------------

    async def _call(
        self, method: str, path: str, *, operation: str, order_id: int | None = None,
        json: dict | None = None, params: dict | None = None, headers: dict | None = None,
    ) -> tuple[int, dict]:
        started = time.perf_counter()
        status_code: int | None = None
        error: str | None = None
        resp: httpx.Response | None = None
        try:
            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=False) as client:
                resp = await client.request(
                    method, f"{self.base_url}{path}", json=json, params=params,
                    headers={"Accept": "application/json", **(headers or {})},
                )
                status_code = resp.status_code
        except httpx.HTTPError as e:
            error = f"{type(e).__name__}: {e}"
        finally:
            await record_provider_call(
                provider_id=self.provider_id, order_id=order_id, operation=operation,
                method=method, path=path, attempt=1, status_code=status_code,
                latency_ms=int((time.perf_counter() - started) * 1000),
                success=status_code is not None and status_code < 400, error=error,
                idempotency_key=None,
            )
        if resp is None or resp.status_code >= 500:
            raise SupplierUnavailableError(error or f"HTTP {status_code}")
        try:
            body = resp.json()
        except ValueError as e:
            raise SupplierContractError(f"Body không phải JSON ({resp.status_code}): {resp.text[:120]!r}") from e
        if not isinstance(body, dict):
            raise SupplierContractError(f"Body không phải object: {str(body)[:120]!r}")
        return resp.status_code, body

    def _partner_headers(self) -> dict:
        """Key của sàn với nguồn (nếu nguồn yêu cầu) — RealApiAdapter._headers
        đọc config.api_key/auth_header/auth_scheme."""
        return {k: v for k, v in self._headers().items() if k != "Content-Type"}

    # ------------------------------------------------------------------
    # Wire format
    # ------------------------------------------------------------------

    def _listing(self) -> UpstreamListing:
        cap = _positive_int(self.config, "stock_cap", _DEFAULT_STOCK_CAP)
        max_qty = min(_positive_int(self.config, "max_per_order", MAX_PER_ORDER), MAX_PER_ORDER)
        try:
            cost = int(self.config.get("cost_price") or 0)
        except (TypeError, ValueError):
            cost = 0
        return UpstreamListing(
            external_id=SKU,
            name=str(self.config.get("sku_name") or "Token"),
            cost_price=max(cost, 0),
            amount=cap,
            max_qty=max_qty,
            format_hint="access_token",
        )

    async def fetch_balance(self) -> Decimal:
        raise SupplierUnavailableError("Nguồn token không có API số dư")

    async def fetch_listing(self, external_id: str) -> UpstreamListing | None:
        return self._listing() if external_id == SKU else None

    async def fetch_catalog(self) -> list[UpstreamListing]:
        return [self._listing()]

    async def _order_ref(self, order_id: int) -> str:
        order = await self.db.get(Order, order_id) if self.db is not None else None
        return order.order_code if order is not None else f"order-{order_id}"

    async def purchase(self, external_id: str, quantity: int, *, order_id: int) -> PurchaseOutcome:
        ref = await self._order_ref(order_id)
        status_code, body = await self._call(
            "POST", KEYS_PATH, operation="purchase", order_id=order_id,
            json={"tokens": quantity, "order_id": ref}, headers=self._partner_headers(),
            params=self._auth_params(None),
        )
        if status_code >= 400:
            raw = str(body.get("error") or body.get("detail") or body)[:255]
            return PurchaseOutcome(ok=False, error_kind=_classify(status_code, body), raw_message=raw)

        api_key = body.get("api_key")
        key_id = str(body.get("api_key_id") or "") or None
        if not isinstance(api_key, str) or not api_key:
            raise SupplierContractError(f"keys: thiếu api_key ({str(body)[:120]!r})")
        granted = body.get("tokens")
        if isinstance(granted, int) and granted <= 0:
            return PurchaseOutcome(ok=False, error_kind=PURCHASE_OUT_OF_STOCK, trans_id=key_id,
                                   raw_message=f"Nguồn cấp 0/{quantity} token")

        try:
            tokens = await self._read_tokens(api_key, order_id=order_id)
        except (SupplierUnavailableError, SupplierContractError) as e:
            # Key đã cấp (token có thể đã bị trừ bên nguồn) mà không đọc được:
            # để tầng chung xử lý như lệnh mua mơ hồ — hoàn buyer + alert, kèm
            # api_key_id để admin tra với nguồn.
            raise SupplierUnavailableError(f"đã cấp key {key_id or '?'} cho {ref} nhưng không đọc được token: {e}") from e

        if isinstance(granted, int):
            tokens = tokens[:granted]
        tokens = tokens[:quantity]
        if not tokens:
            return PurchaseOutcome(ok=False, error_kind=PURCHASE_OUT_OF_STOCK, trans_id=key_id,
                                   raw_message=f"Key {key_id} không có token nào")
        return PurchaseOutcome(ok=True, items=tokens, trans_id=key_id,
                               raw_message=f"{len(tokens)}/{quantity} token")

    async def _read_tokens(self, api_key: str, *, order_id: int | None) -> list[str]:
        header = str(self.config.get("token_key_header") or "X-API-Key")
        limit = _positive_int(self.config, "page_size", _DEFAULT_PAGE_SIZE)
        seen: set[str] = set()
        tokens: list[str] = []
        for page in range(1, _MAX_PAGES + 1):
            status_code, body = await self._read_page(header, api_key, page, limit, order_id=order_id)
            if status_code in (401, 403):
                raise SupplierContractError(f"customer/tokens từ chối key vừa cấp (HTTP {status_code})")
            if status_code >= 400:
                raise SupplierContractError(f"customer/tokens HTTP {status_code}: {str(body)[:120]!r}")
            rows = body.get("data")
            if not isinstance(rows, list):
                raise SupplierContractError(f"customer/tokens: data không phải mảng ({str(rows)[:80]!r})")
            for row in rows:
                token = row.get("access_token") if isinstance(row, dict) else None
                if isinstance(token, str) and token.strip() and token.strip() not in seen:
                    seen.add(token.strip())
                    tokens.append(token.strip())
            total = body.get("total")
            if not rows or (isinstance(total, int) and len(tokens) >= total) or (
                not isinstance(total, int) and len(rows) < limit
            ):
                break
        return tokens

    async def _read_page(self, header: str, api_key: str, page: int, limit: int, *, order_id: int | None):
        last: Exception | None = None
        for attempt in range(_READ_ATTEMPTS):
            try:
                return await self._call(
                    "GET", TOKENS_PATH, operation="fetch_tokens", order_id=order_id,
                    params=self._auth_params({"page": page, "limit": limit}), headers={**self._partner_headers(), header: api_key},
                )
            except SupplierUnavailableError as e:
                last = e
                await asyncio.sleep(0.5 * (attempt + 1))
        raise last or SupplierUnavailableError("customer/tokens không phản hồi")

    async def fetch_order(self, trans_id: str) -> list[str] | None:
        return None  # nguồn không có API tra lô theo id; đọc lại cần api_key

    async def check_health(self) -> dict:
        """Không tốn token: gọi customer/tokens không kèm key — nguồn trả 4xx là
        còn sống. Không bao giờ "unhealthy" để health job không tắt nguồn."""
        try:
            status_code, _ = await self._call(
                "GET", TOKENS_PATH, operation="health", params=self._auth_params(None),
            )
        except SupplierAuthError as e:
            return {"status": "warning", "message": f"Nguồn từ chối: {e}"}
        except (SupplierUnavailableError, SupplierContractError) as e:
            return {"status": "warning", "message": f"Không kết nối được nguồn token: {e}"}
        return {"status": "healthy", "message": f"Nguồn phản hồi (HTTP {status_code})"}
