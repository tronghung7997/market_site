"""Error contract of the public API: every `/v1` failure is
``{"error": {"code": "<snake_case>", "message": "<English sentence>"}}``.

`PublicApiError` is raised by this feature; errors raised by the order flow
(`CodedHTTPException`) and by FastAPI (validation, plain `HTTPException`) are
translated at the HTTP seam by `src.errors.handlers` for `/v1` paths, so the
checkout keeps a single implementation.
"""
from __future__ import annotations

from fastapi.responses import JSONResponse

PUBLIC_API_PREFIX = "/v1"


class PublicApiError(Exception):
    def __init__(self, code: str, status_code: int, message: str, *, headers: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.message = message
        self.headers = headers


def is_public_api_path(path: str) -> bool:
    return path == PUBLIC_API_PREFIX or path.startswith(PUBLIC_API_PREFIX + "/")


# Existing checkout error codes → public codes (status is kept from the source).
_CODED_MAP: dict[str, tuple[str, str]] = {
    "INSUFFICIENT_CREDIT": ("insufficient_balance", "Your wallet balance is too low for this order."),
    "RESOURCE_UNAVAILABLE": ("out_of_stock", "Not enough stock for this quantity right now."),
    "ORDER_QUANTITY_RANGE": ("quantity_limit", ""),
    "ORDER_QUANTITY_LIMIT": ("quantity_limit", ""),
    "VARIANT_NOT_FOUND": ("product_not_available", "This package is not available through the API."),
    "PRODUCT_NOT_FOUND": ("product_not_available", "This package is not available through the API."),
    "PRODUCT_UNAVAILABLE": ("product_not_available", "This package is not available through the API."),
    "PROVIDER_NOT_CONFIGURED": ("product_not_available", "This package is not available through the API."),
    "INVALID_PRODUCT_CONFIG": ("product_not_available", "This package is not available through the API."),
    "SELF_PURCHASE": ("product_not_available", "You cannot buy your own product."),
    "RATE_LIMITED": ("rate_limited", "Too many requests. Retry after the time in Retry-After."),
    "ORDER_NOT_FOUND": ("not_found", "Order not found."),
    "NOT_ORDER_OWNER": ("not_found", "Order not found."),
    "MAINTENANCE": ("service_unavailable", "The marketplace is under maintenance. Retry later."),
    "ORDERS_FROZEN": ("service_unavailable", "Purchases are temporarily paused. Retry later."),
}


def _fallback_code(status_code: int) -> str:
    if status_code == 401:
        return "invalid_api_key"
    if status_code == 404:
        return "not_found"
    if status_code == 429:
        return "rate_limited"
    if status_code >= 500:
        return "internal_error" if status_code == 500 else "service_unavailable"
    return "invalid_request"


def error_response(code: str, status_code: int, message: str, headers: dict | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
        headers=headers or None,
    )


def translate(status_code: int, detail: object, error_code: str | None = None, headers: dict | None = None) -> JSONResponse:
    """Render an error raised outside this feature in the public format."""
    message = detail if isinstance(detail, str) else "The request could not be processed."
    if error_code and error_code in _CODED_MAP:
        code, fixed = _CODED_MAP[error_code]
        return error_response(code, status_code, fixed or message, headers)
    if status_code == 422:
        return error_response("invalid_request", 400, "The request body or parameters are invalid.", headers)
    return error_response(_fallback_code(status_code), status_code, message, headers)
