"""igbm.net — shop tài khoản MXH/key, nguồn catalog mua-theo-đơn đầu tiên.
Contract chốt bằng probe key thật 2026-09-17, xem
docs/superpowers/specs/2026-09-17-igbm-reseller-research.md §1–2.

Chỉ dịch wire format; toàn bộ logic mua/đối soát/Resource nằm ở
adapters/supplier.py::CatalogSupplierAdapter.

Wire format:
- Auth: `api_key` query/form param (không Bearer).
- Envelope `{"status":"success"|"error","msg":"<tiếng Việt>"}` — lỗi KHÔNG có
  mã số, phải match chuỗi `msg` (bảng _ERROR_KINDS). Match không dấu, không
  hoa thường để đỡ vỡ khi igbm sửa chính tả.
- `products.php` trả string cho id/price/min/max, `product.php` trả int —
  parser ép kiểu hết.
- `buy_product` POST form `action=buyProduct&id&amount&api_key` → `trans_id`
  + `data[]` mỗi phần tử một dòng credential.

`config` trên Provider row:
    base_url         https://igbm.net (bắt buộc)
    api_key          key API igbm (mã hoá at rest)
    timeout_seconds  mặc định 30 — lệnh mua thật đo được ~0.7s nhưng timeout
                     ngắn biến một lệnh chậm thành "mơ hồ" (đã trừ tiền, mất
                     response), đắt hơn nhiều so với chờ thêm vài giây.
    low_balance_vnd  ngưỡng cảnh báo số dư (mặc định 200.000).
"""
from __future__ import annotations

import time
import unicodedata
from decimal import Decimal, InvalidOperation

import httpx
import structlog

from src.adapters.call_log import record_provider_call
from src.adapters.supplier import (
    PURCHASE_AUTH,
    PURCHASE_INVALID,
    PURCHASE_INVALID_SKU,
    PURCHASE_OUT_OF_CREDIT,
    PURCHASE_OUT_OF_STOCK,
    PURCHASE_UNKNOWN,
    CatalogSupplierAdapter,
    PurchaseOutcome,
    SupplierAuthError,
    SupplierContractError,
    SupplierUnavailableError,
    UpstreamListing,
)

logger = structlog.get_logger()

PROFILE_PATH = "/api/profile.php"
PRODUCTS_PATH = "/api/products.php"
PRODUCT_PATH = "/api/product.php"
ORDER_PATH = "/api/order.php"
BUY_PATH = "/api/buy_product"

_DEFAULT_TIMEOUT = 30.0


def _fold(s: str) -> str:
    """Bỏ dấu + hạ chữ để so khớp msg tiếng Việt bền hơn."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return s.replace("đ", "d").replace("Đ", "d").lower().strip()


# msg thật quan sát 2026-09-17 → loại lỗi. Thứ tự có ý nghĩa: match đầu tiên.
_ERROR_KINDS: tuple[tuple[str, str], ...] = (
    ("so du khong du", PURCHASE_OUT_OF_CREDIT),                 # "Số dư không đủ, vui lòng nạp thêm"
    ("so luong con lai trong he thong khong du", PURCHASE_OUT_OF_STOCK),
    ("vui long dang nhap", PURCHASE_AUTH),                       # buy_product với key sai
    ("api key khong hop le", PURCHASE_AUTH),                     # profile.php với key sai
    ("san pham khong ton tai", PURCHASE_INVALID_SKU),
    ("id san pham khong hop le", PURCHASE_INVALID_SKU),
    ("so luong khong hop le", PURCHASE_INVALID),
)


def classify_error(msg: str | None) -> str:
    folded = _fold(msg or "")
    for needle, kind in _ERROR_KINDS:
        if needle in folded:
            return kind
    return PURCHASE_UNKNOWN


def _to_int(v, default: int = 0) -> int:
    try:
        return int(Decimal(str(v)))
    except (InvalidOperation, ValueError, TypeError):
        return default


def parse_listing(raw: dict, category_path: tuple[str, ...] = ()) -> UpstreamListing | None:
    """Chuẩn hoá một product dict của igbm (string hay int đều được)."""
    ext_id = raw.get("id")
    if ext_id is None or str(ext_id).strip() == "":
        return None
    max_qty = _to_int(raw.get("max"), 0) or None
    # igbm dùng 1.000.000 làm "không giới hạn" — bỏ để không hiện số vô nghĩa.
    if max_qty is not None and max_qty >= 1_000_000:
        max_qty = None
    hint = (raw.get("description") or "").strip()
    # ~75% description là rác kiểu ".", "./", ",." — không phải định dạng.
    if len("".join(ch for ch in hint if ch.isalnum())) < 4:
        hint = ""
    return UpstreamListing(
        external_id=str(ext_id).strip(),
        name=(raw.get("name") or "").strip(),
        cost_price=_to_int(raw.get("price"), 0),
        amount=max(_to_int(raw.get("amount"), 0), 0),
        min_qty=max(_to_int(raw.get("min"), 1), 1),
        max_qty=max_qty,
        format_hint=hint or None,
        category_path=category_path,
    )


def flatten_catalog(body: dict) -> list[UpstreamListing]:
    """`categories[]` phẳng với parent_id → list SKU kèm đường dẫn danh mục."""
    cats = body.get("categories") or []
    by_id = {str(c.get("id")): c for c in cats if c.get("id") is not None}

    def path_of(c: dict) -> tuple[str, ...]:
        names: list[str] = []
        seen: set[str] = set()
        cur = c
        while cur is not None and str(cur.get("id")) not in seen:
            seen.add(str(cur.get("id")))
            names.insert(0, (cur.get("name") or "").strip())
            parent = str(cur.get("parent_id") or "0")
            cur = by_id.get(parent) if parent != "0" else None
        return tuple(names)

    out: list[UpstreamListing] = []
    for c in cats:
        path = path_of(c)
        for raw in c.get("products") or []:
            listing = parse_listing(raw, path)
            if listing is not None:
                out.append(listing)
    return out


async def validate_igbm_config(config: dict) -> None:
    """Hook AdapterSpec.validate_config — chạy khi admin lưu provider."""
    from fastapi import HTTPException

    base_url = (config.get("base_url") or "").strip()
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="igbm: base_url phải bắt đầu bằng http:// hoặc https://")
    if not config.get("api_key"):
        raise HTTPException(status_code=422, detail="igbm: thiếu api_key")
    for key in ("timeout_seconds", "low_balance_vnd"):
        if config.get(key) not in (None, ""):
            try:
                if float(config[key]) <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"igbm: {key} phải là số dương") from None


class IgbmAdapter(CatalogSupplierAdapter):
    def __init__(self, config: dict, *, db=None, provider_id: int | None = None, seller_owned: bool = False):
        super().__init__(config, db=db, provider_id=provider_id, seller_owned=seller_owned)
        if not config.get("timeout_seconds"):
            self.timeout = _DEFAULT_TIMEOUT

    # ------------------------------------------------------------------
    # HTTP — đúng một attempt, log provider_call_logs không kèm query (key
    # không bao giờ lọt vào log).
    # ------------------------------------------------------------------

    async def _call_once(
        self, method: str, path: str, *, operation: str, order_id: int | None = None,
        params: dict | None = None, data: dict | None = None,
    ) -> dict:
        auth = {"api_key": self.api_key or ""}
        started = time.perf_counter()
        status_code: int | None = None
        error: str | None = None
        resp: httpx.Response | None = None
        try:
            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=False) as client:
                if method == "POST":
                    resp = await client.post(f"{self.base_url}{path}", data={**(data or {}), **auth})
                else:
                    resp = await client.get(f"{self.base_url}{path}", params={**(params or {}), **auth})
                status_code = resp.status_code
        except httpx.HTTPError as e:
            error = str(e)
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
        if not isinstance(body, dict) or "status" not in body:
            raise SupplierContractError(f"Thiếu envelope status: {str(body)[:120]!r}")
        return body

    @staticmethod
    def _raise_if_auth(body: dict) -> None:
        if body.get("status") != "success" and classify_error(body.get("msg")) == PURCHASE_AUTH:
            raise SupplierAuthError(body.get("msg") or "API key bị từ chối")

    # ------------------------------------------------------------------
    # Wire format
    # ------------------------------------------------------------------

    async def fetch_balance(self) -> Decimal:
        body = await self._call_once("GET", PROFILE_PATH, operation="fetch_balance")
        self._raise_if_auth(body)
        if body.get("status") != "success":
            raise SupplierContractError(f"profile.php: {body.get('msg')}")
        try:
            return Decimal(str((body.get("data") or {}).get("money")))
        except (InvalidOperation, TypeError) as e:
            raise SupplierContractError(f"profile.php: money không phải số ({body.get('data')})") from e

    async def fetch_listing(self, external_id: str) -> UpstreamListing | None:
        body = await self._call_once(
            "GET", PRODUCT_PATH, operation="fetch_listing", params={"product": external_id},
        )
        self._raise_if_auth(body)
        if body.get("status") != "success":
            raise SupplierContractError(f"product.php: {body.get('msg')}")
        rows = body.get("product") or []
        if not rows:
            return None  # igbm trả success + product=[] cho id không tồn tại
        return parse_listing(rows[0])

    async def fetch_catalog(self) -> list[UpstreamListing]:
        body = await self._call_once("GET", PRODUCTS_PATH, operation="fetch_catalog")
        self._raise_if_auth(body)
        if body.get("status") != "success":
            raise SupplierContractError(f"products.php: {body.get('msg')}")
        return flatten_catalog(body)

    async def purchase(self, external_id: str, quantity: int, *, order_id: int) -> PurchaseOutcome:
        body = await self._call_once(
            "POST", BUY_PATH, operation="purchase", order_id=order_id,
            data={"action": "buyProduct", "id": external_id, "amount": str(quantity)},
        )
        msg = body.get("msg")
        if body.get("status") != "success":
            return PurchaseOutcome(ok=False, error_kind=classify_error(msg), raw_message=msg)
        items = body.get("data")
        if not isinstance(items, list) or not all(isinstance(x, str) for x in items):
            raise SupplierContractError(f"buy_product: data không phải mảng chuỗi ({str(items)[:80]!r})")
        return PurchaseOutcome(
            ok=True, items=[x.strip() for x in items if x.strip()],
            trans_id=str(body.get("trans_id") or "") or None, raw_message=msg,
        )

    async def fetch_order(self, trans_id: str) -> list[str] | None:
        body = await self._call_once(
            "GET", ORDER_PATH, operation="fetch_order", params={"order": trans_id},
        )
        self._raise_if_auth(body)
        if body.get("status") != "success":
            return None  # "Đơn hàng không tồn tại"
        items = body.get("data")
        return [x for x in items if isinstance(x, str)] if isinstance(items, list) else None
