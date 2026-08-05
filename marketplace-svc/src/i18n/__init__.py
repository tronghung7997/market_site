"""Catalog / API locale helpers (EN default, VI secondary)."""

from src.i18n.catalog import (
    DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    available_locales,
    normalize_locale,
    parse_accept_language,
    resolve_category_fields,
    resolve_product_fields,
    resolve_variant_fields,
)
from src.i18n.deps import get_request_locale

__all__ = [
    "DEFAULT_LOCALE",
    "SUPPORTED_LOCALES",
    "available_locales",
    "get_request_locale",
    "normalize_locale",
    "parse_accept_language",
    "resolve_category_fields",
    "resolve_product_fields",
    "resolve_variant_fields",
]
