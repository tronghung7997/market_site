"""Resolve catalog text fields for a requested locale.

Fallback chain (plan §7.3):
- requested ``en``: ``i18n.en`` → legacy scalar → empty
- requested ``vi``: ``i18n.vi`` → ``i18n.en`` → legacy scalar → empty

English storefront must never fall back to ``vi`` (would leak Vietnamese).
"""

from __future__ import annotations

from typing import Any

SUPPORTED_LOCALES: tuple[str, ...] = ("en", "vi")
DEFAULT_LOCALE = "en"

PRODUCT_I18N_FIELDS = (
    "title",
    "description",
    "warranty_text",
    "highlight_text",
    "features",
)
CATEGORY_I18N_FIELDS = ("name",)
VARIANT_I18N_FIELDS = ("name",)


def normalize_locale(value: str | None) -> str:
    """Map free-form locale / Accept-Language token to ``en`` or ``vi``."""
    if not value:
        return DEFAULT_LOCALE
    token = value.split(",")[0].strip().split(";")[0].strip().lower().replace("_", "-")
    if not token:
        return DEFAULT_LOCALE
    primary = token.split("-", 1)[0]
    if primary == "vi":
        return "vi"
    if primary == "en":
        return "en"
    return DEFAULT_LOCALE


def parse_accept_language(header: str | None) -> str | None:
    """Pick the first supported locale from an Accept-Language header."""
    if not header:
        return None
    # e.g. "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
    candidates: list[tuple[float, str]] = []
    for part in header.split(","):
        part = part.strip()
        if not part:
            continue
        if ";q=" in part:
            lang, q = part.split(";q=", 1)
            try:
                weight = float(q)
            except ValueError:
                weight = 0.0
        else:
            lang, weight = part, 1.0
        candidates.append((weight, lang.strip()))
    candidates.sort(key=lambda item: item[0], reverse=True)
    for _, lang in candidates:
        loc = normalize_locale(lang)
        # normalize_locale falls back to en for unknown tags — only accept
        # when the tag actually maps to a supported primary language.
        primary = lang.strip().lower().replace("_", "-").split("-", 1)[0]
        if primary in SUPPORTED_LOCALES:
            return loc
    return None


def available_locales(i18n: dict | None) -> list[str]:
    """Locales that have at least one non-empty field in the i18n blob."""
    if not i18n:
        return []
    out: list[str] = []
    for loc in SUPPORTED_LOCALES:
        bucket = i18n.get(loc)
        if isinstance(bucket, dict) and any(
            _is_present(v) for v in bucket.values()
        ):
            out.append(loc)
    return out


def _is_present(value: Any) -> bool:
    if value is None:
        return False
    if value == "":
        return False
    if value == [] or value == {}:
        return False
    return True


def _locale_order(locale: str) -> list[str]:
    locale = normalize_locale(locale)
    if locale == "en":
        return ["en"]
    return [locale, "en"]


def resolve_field(
    i18n: dict | None,
    field: str,
    locale: str,
    legacy: Any,
) -> Any:
    """Resolve one field through the locale fallback chain, then legacy."""
    if i18n:
        for loc in _locale_order(locale):
            bucket = i18n.get(loc)
            if not isinstance(bucket, dict):
                continue
            if field in bucket and _is_present(bucket[field]):
                return bucket[field]
    return legacy


def resolve_fields(
    i18n: dict | None,
    fields: tuple[str, ...],
    locale: str,
    legacy: dict[str, Any],
) -> dict[str, Any]:
    return {
        field: resolve_field(i18n, field, locale, legacy.get(field))
        for field in fields
    }


def resolve_product_fields(product: Any, locale: str) -> dict[str, Any]:
    """Localized product text fields + locale metadata."""
    i18n = getattr(product, "i18n", None) or {}
    legacy = {f: getattr(product, f, None) for f in PRODUCT_I18N_FIELDS}
    resolved = resolve_fields(i18n, PRODUCT_I18N_FIELDS, locale, legacy)
    resolved["locale"] = normalize_locale(locale)
    resolved["available_locales"] = available_locales(i18n)
    return resolved


def resolve_category_fields(category: Any, locale: str) -> dict[str, Any]:
    i18n = getattr(category, "i18n", None) or {}
    legacy = {f: getattr(category, f, None) for f in CATEGORY_I18N_FIELDS}
    resolved = resolve_fields(i18n, CATEGORY_I18N_FIELDS, locale, legacy)
    resolved["locale"] = normalize_locale(locale)
    resolved["available_locales"] = available_locales(i18n)
    return resolved


def resolve_variant_fields(variant: Any, locale: str) -> dict[str, Any]:
    i18n = getattr(variant, "i18n", None) or {}
    legacy = {f: getattr(variant, f, None) for f in VARIANT_I18N_FIELDS}
    resolved = resolve_fields(i18n, VARIANT_I18N_FIELDS, locale, legacy)
    # Variants stay slim — no per-variant locale metadata; parent product carries it.
    return resolved


def merge_i18n_locale(
    existing: dict | None,
    locale: str,
    fields: dict[str, Any],
) -> dict:
    """Return a new i18n blob with ``fields`` written under ``locale``.

    Used when sellers/admins save content for a specific language. Empty
    values are stripped so missing keys stay absent (fallback works).
    """
    locale = normalize_locale(locale)
    out = dict(existing or {})
    bucket = dict(out.get(locale) or {})
    for key, value in fields.items():
        if value is None:
            bucket.pop(key, None)
        else:
            bucket[key] = value
    if bucket:
        out[locale] = bucket
    elif locale in out:
        del out[locale]
    return out
