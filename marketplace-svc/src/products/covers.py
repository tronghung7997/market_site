"""Product imagery: an allowlisted cover icon id plus an optional gallery of
uploaded images (``media``), stored together in ``products.images``."""

from __future__ import annotations

from src.media.service import public_image as media_public_image

# Uploaded images per product (first one is the card cover).
PRODUCT_GALLERY_MAX = 8

COVER_IDS = frozenset({
    "facebook", "instagram", "tiktok", "youtube", "x",
    "proxy", "token", "endpoint", "cloud",
    "payment", "takedown", "account", "other",
})

COVER_GROUPS: dict[str, tuple[str, ...]] = {
    "social": ("facebook", "instagram", "tiktok", "youtube", "x"),
    "infra": ("proxy", "token", "endpoint", "cloud"),
    "service": ("payment", "takedown", "account", "other"),
}

COVER_LABELS: dict[str, dict[str, str]] = {
    "facebook": {"vi": "Facebook", "en": "Facebook"},
    "instagram": {"vi": "Instagram", "en": "Instagram"},
    "tiktok": {"vi": "TikTok", "en": "TikTok"},
    "youtube": {"vi": "YouTube", "en": "YouTube"},
    "x": {"vi": "X", "en": "X"},
    "proxy": {"vi": "Proxy", "en": "Proxy"},
    "token": {"vi": "Token", "en": "Token"},
    "endpoint": {"vi": "API / Endpoint", "en": "API / Endpoint"},
    "cloud": {"vi": "Cloud", "en": "Cloud"},
    "payment": {"vi": "Thanh toán", "en": "Payment"},
    "takedown": {"vi": "Takedown", "en": "Takedown"},
    "account": {"vi": "Tài khoản", "en": "Account"},
    "other": {"vi": "Khác", "en": "Other"},
}

DEFAULT_COVER_BY_SERVICE_TYPE = {
    "account": "account",
    "proxy": "proxy",
    "token": "token",
    "endpoint": "endpoint",
    "cloud": "cloud",
    "payment": "payment",
    "takedown": "takedown",
    "other": "other",
}

GROUP_BY_COVER_ID = {
    cover_id: group
    for group, cover_ids in COVER_GROUPS.items()
    for cover_id in cover_ids
}


def default_cover_id(service_type: str | None) -> str:
    return DEFAULT_COVER_BY_SERVICE_TYPE.get(service_type or "other", "other")


def parse_cover_id(images: object) -> str | None:
    """Read a stored images blob. Unknown or legacy shapes are treated as unset."""
    if not isinstance(images, dict):
        return None
    cover_id = images.get("cover_id")
    if isinstance(cover_id, str) and cover_id in COVER_IDS:
        return cover_id
    return None


def images_payload(cover_id: str) -> dict:
    if cover_id not in COVER_IDS:
        raise ValueError(f"Unknown cover_id: {cover_id}")
    return {"cover_id": cover_id}


def gallery_snapshots(images: object) -> list[dict]:
    """Stored media snapshots of the product gallery (``media.service.snapshot``)."""
    items = images.get("gallery") if isinstance(images, dict) else None
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def _public_gallery(images: dict) -> list[dict]:
    out: list[dict] = []
    for item in gallery_snapshots(images):
        # Idempotent: a payload built earlier already carries client shapes.
        image = media_public_image(item)
        if image:
            out.append(image)
    return out


def public_images(images: object, *, gallery: bool = False) -> dict | None:
    """Canonical read shape: ``{"cover_id"?, "cover"?, "gallery"?}``.

    ``cover`` is the first uploaded image (what cards show); ``gallery`` (every
    image, in order) only when asked — lists stay small. Legacy URL lists and
    unknown blobs become unset."""
    if not isinstance(images, dict):
        return None
    out: dict = {}
    cover_id = parse_cover_id(images)
    if cover_id:
        out["cover_id"] = cover_id
    pictures = _public_gallery(images)
    cover = pictures[0] if pictures else images.get("cover")
    if isinstance(cover, dict) and "url" in cover:
        out["cover"] = cover
    if gallery and pictures:
        out["gallery"] = pictures
    return out or None


def catalog_items() -> list[dict]:
    items: list[dict] = []
    for group, cover_ids in COVER_GROUPS.items():
        for cover_id in cover_ids:
            items.append({
                "id": cover_id,
                "group": group,
                "label": dict(COVER_LABELS[cover_id]),
            })
    return items
