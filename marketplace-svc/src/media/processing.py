"""Decode an uploaded image and re-encode it as WebP variants.

Nothing the client sent is stored as-is: every accepted upload is decoded,
rotated by its EXIF orientation, optionally cropped, downscaled and written
back as WebP without metadata. That strips EXIF/GPS from phone photos, turns
polyglot or mislabelled files into plain images and caps the stored size.

CPU-bound; callers run :func:`process_image` in a worker thread.
"""

from __future__ import annotations

import hashlib
import io
import threading
import warnings
from dataclasses import dataclass
from datetime import datetime

from PIL import Image, ImageOps, UnidentifiedImageError

from src.models.media import MediaPurpose

# Header-level guard before any pixel is decoded (a 50 MP photo is already far
# beyond any phone camera; a "decompression bomb" declares far more).
MAX_PIXELS = 50_000_000
MIN_EDGE = 8
ACCEPTED_FORMATS = frozenset({"JPEG", "MPO", "PNG", "WEBP", "GIF"})
# Pillow is not the bottleneck worth parallelising: two decodes per process
# keep a burst of uploads from starving request handlers of CPU.
_DECODE_SLOTS = threading.BoundedSemaphore(2)


@dataclass(frozen=True)
class Preset:
    full: tuple[int, int]
    thumb: tuple[int, int] | None
    # Width / height the image is centre-cropped to first (None = keep aspect).
    aspect: float | None = None
    quality: int = 80


PRESETS: dict[MediaPurpose, Preset] = {
    MediaPurpose.product_image: Preset(full=(1600, 1600), thumb=(480, 480)),
    MediaPurpose.category_image: Preset(full=(512, 512), thumb=(128, 128), aspect=1.0),
    MediaPurpose.seller_logo: Preset(full=(512, 512), thumb=(128, 128), aspect=1.0),
    MediaPurpose.seller_banner: Preset(full=(1920, 640), thumb=(960, 320), aspect=3.0),
    MediaPurpose.avatar: Preset(full=(256, 256), thumb=(64, 64), aspect=1.0),
    MediaPurpose.chat_attachment: Preset(full=(1600, 1600), thumb=(480, 480)),
    # Screenshots of error messages must stay legible.
    MediaPurpose.dispute_evidence: Preset(full=(2048, 2048), thumb=(480, 480), quality=85),
    MediaPurpose.payout_receipt: Preset(full=(2048, 2048), thumb=(480, 480), quality=85),
    MediaPurpose.adjustment_proof: Preset(full=(2048, 2048), thumb=(480, 480), quality=85),
    MediaPurpose.tier_badge: Preset(full=(128, 128), thumb=(48, 48), aspect=1.0, quality=90),
    # 1.91:1, the usual link-preview shape, so the cover doubles as og:image.
    MediaPurpose.post_cover: Preset(full=(1600, 838), thumb=(640, 335), aspect=1.91),
}


@dataclass(frozen=True)
class Variant:
    data: bytes
    width: int
    height: int

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


@dataclass(frozen=True)
class ProcessedImage:
    variants: dict[str, Variant]
    # EXIF capture time "YYYY-MM-DDTHH:MM:SS" (camera clock), when present and sane.
    taken_at: str | None


class InvalidImage(ValueError):
    """The upload is not an image we accept (format, size or corrupt data)."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _open(data: bytes) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning, OSError) as exc:
        raise InvalidImage("unreadable") from exc
    if image.format not in ACCEPTED_FORMATS:
        raise InvalidImage("format")
    width, height = image.size
    if width * height > MAX_PIXELS:
        raise InvalidImage("dimensions")
    if min(width, height) < MIN_EDGE:
        raise InvalidImage("too_small")
    return image


_EXIF_IFD = 0x8769
_DATETIME_ORIGINAL = 0x9003
_DATETIME = 0x0132


def _taken_at(image: Image.Image) -> str | None:
    """Capture time from EXIF, read before metadata is discarded. Only the
    timestamp survives; location and device tags are never stored."""
    try:
        exif = image.getexif()
        raw = exif.get_ifd(_EXIF_IFD).get(_DATETIME_ORIGINAL) or exif.get(_DATETIME)
    except Exception:  # noqa: BLE001 — malformed EXIF must not reject the image
        return None
    if not isinstance(raw, str):
        return None
    try:
        moment = datetime.strptime(raw.strip()[:19], "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    return moment.isoformat() if 2000 <= moment.year <= 2100 else None


def _normalise(image: Image.Image) -> Image.Image:
    if getattr(image, "is_animated", False):
        image.seek(0)  # first frame only; animation is not stored
    try:
        image.load()
    except (OSError, SyntaxError, ValueError) as exc:  # truncated or corrupt pixel data
        raise InvalidImage("unreadable") from exc
    image = ImageOps.exif_transpose(image) or image
    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    return image.convert("RGBA" if has_alpha else "RGB")


def _crop(image: Image.Image, aspect: float) -> Image.Image:
    width, height = image.size
    if abs(width / height - aspect) < 0.01:
        return image
    if width / height > aspect:
        new_width = round(height * aspect)
        left = (width - new_width) // 2
        return image.crop((left, 0, left + new_width, height))
    new_height = round(width / aspect)
    top = (height - new_height) // 2
    return image.crop((0, top, width, top + new_height))


def _encode(image: Image.Image, box: tuple[int, int], quality: int) -> Variant:
    copy = image.copy()
    copy.thumbnail(box, Image.Resampling.LANCZOS)  # only ever shrinks
    buffer = io.BytesIO()
    # No exif= / icc_profile= arguments: the output carries no metadata.
    copy.save(buffer, "WEBP", quality=quality, method=4)
    return Variant(buffer.getvalue(), copy.width, copy.height)


def process_image(data: bytes, preset: Preset) -> ProcessedImage:
    """``full`` (+ ``thumb``) WebP variants and the EXIF capture time.
    Raises :class:`InvalidImage`."""
    if not data:
        raise InvalidImage("empty")
    with _DECODE_SLOTS:
        opened = _open(data)
        taken_at = _taken_at(opened)
        image = _normalise(opened)
        if preset.aspect:
            image = _crop(image, preset.aspect)
        variants = {"full": _encode(image, preset.full, preset.quality)}
        if preset.thumb:
            variants["thumb"] = _encode(image, preset.thumb, max(preset.quality - 5, 60))
    return ProcessedImage(variants=variants, taken_at=taken_at)
