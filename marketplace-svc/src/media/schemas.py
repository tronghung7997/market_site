from typing import Annotated

from pydantic import BaseModel, StringConstraints

from src.media.urls import PUBLIC_ID_PATTERN

# An upload id as returned by POST /media/uploads; feature request bodies use
# ``list[MediaId]`` with their own max_length.
MediaId = Annotated[str, StringConstraints(pattern=PUBLIC_ID_PATTERN.pattern)]


class MediaUploadResponse(BaseModel):
    id: str
    purpose: str
    w: int
    h: int
    bytes: int
    # Public purposes only; private images are served by the owning feature.
    url: str | None = None
    thumb_url: str | None = None


class PublicImage(BaseModel):
    id: str
    url: str
    thumb_url: str
    w: int
    h: int


class PrivateImage(BaseModel):
    id: str
    w: int
    h: int
    uploaded_at: str | None = None
    # EXIF capture time (camera clock, no zone), when the file carried one.
    taken_at: str | None = None
