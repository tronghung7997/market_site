"""FastAPI dependency: resolve request locale from query / Accept-Language."""

from fastapi import Header, Query

from src.i18n.catalog import DEFAULT_LOCALE, normalize_locale, parse_accept_language


def get_request_locale(
    locale: str | None = Query(
        None,
        description="Catalog locale: en (default) or vi",
        pattern="^(en|vi)$",
    ),
    accept_language: str | None = Header(None, alias="Accept-Language"),
) -> str:
    """Detection order: ``?locale=`` → Accept-Language → default ``en``."""
    if locale:
        return normalize_locale(locale)
    from_header = parse_accept_language(accept_language)
    if from_header:
        return from_header
    return DEFAULT_LOCALE
