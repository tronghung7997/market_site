"""Media storage: upload → WebP variants, public serving, attach rules, GC,
S3 adapter (SigV4) and moving objects between Postgres and S3."""

import hashlib
import io
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from PIL import Image
from sqlalchemy import func, select, update

from src.database import SessionLocal
from src.media import service as media_service
from src.media import store as media_store
from src.media import transfer as media_transfer
from src.media.errors import MediaError
from src.media.http import image_response
from src.media.s3 import EMPTY_SHA256, Credentials, S3Client, S3Error, presign_url, sign_request
from src.media.store import S3MediaStore
from src.media.transfer import migrate_objects, verify_objects
from src.models.account import Account
from src.models.media import MediaBlob, MediaObject, MediaPurpose
from tests.conftest import make_admin, make_seller, register_and_login


def _jpeg(size=(3000, 2000), *, orientation: int | None = None) -> bytes:
    image = Image.new("RGB", size, (200, 40, 40))
    exif = Image.Exif()
    exif[0x010F] = "LeakyCam"  # Make
    if orientation:
        exif[0x0112] = orientation
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", exif=exif.tobytes())
    return buffer.getvalue()


def _png(size=(64, 64), mode="RGBA") -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, size).save(buffer, "PNG")
    return buffer.getvalue()


async def _headers(client, email, role=None):
    await register_and_login(client, email)
    if role == "seller":
        await make_seller(email)
    elif role == "admin":
        await make_admin(email)
    token = await register_and_login(client, email)
    return {"Authorization": f"Bearer {token}"}


async def _upload(client, headers, purpose, data, content_type="image/jpeg"):
    return await client.post(
        f"/media/uploads?purpose={purpose}", content=data, headers={**headers, "Content-Type": content_type},
    )


async def _account(email) -> Account:
    async with SessionLocal() as db:
        return await db.scalar(select(Account).where(Account.email == email))


# --------------------------------------------------------------------------- upload + public serving

@pytest.mark.asyncio
async def test_upload_reencodes_to_webp_without_metadata_and_serves_it_cacheably(client):
    h = await _headers(client, "media-seller@example.com", "seller")
    response = await _upload(client, h, "product_image", _jpeg(orientation=6))
    assert response.status_code == 201, response.text
    body = response.json()
    # EXIF orientation 6 = rotated 90°: the stored image is portrait, capped at 1600.
    assert (body["w"], body["h"]) == (1067, 1600)
    assert body["url"].startswith("/media/pub/product_image/") and body["url"].endswith("_full.webp")
    assert body["thumb_url"].endswith("_thumb.webp")

    key = body["url"].removeprefix("/media/")
    served = await client.get(f"/public/media/{key}")
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/webp"
    assert served.headers["cache-control"] == "public, max-age=31536000, immutable"
    image = Image.open(io.BytesIO(served.content))
    assert image.format == "WEBP" and image.size == (1067, 1600)
    assert not image.getexif() and "exif" not in image.info

    again = await client.get(f"/public/media/{key}", headers={"If-None-Match": served.headers["etag"]})
    assert again.status_code == 304

    thumb = await client.get(f"/public/media/{body['thumb_url'].removeprefix('/media/')}")
    assert Image.open(io.BytesIO(thumb.content)).size == (320, 480)

    async with SessionLocal() as db:
        obj = await db.scalar(select(MediaObject).where(MediaObject.public_id == body["id"]))
        assert (obj.status, obj.storage, obj.visibility) == ("pending", "db", "public")
        blobs = await db.scalar(select(func.count()).select_from(MediaBlob).where(MediaBlob.key.like(f"{obj.key_prefix}%")))
        assert blobs == 2


@pytest.mark.asyncio
async def test_square_purposes_are_centre_cropped(client):
    h = await _headers(client, "media-logo@example.com", "seller")
    body = (await _upload(client, h, "seller_logo", _jpeg((1200, 600)))).json()
    assert (body["w"], body["h"]) == (512, 512)


@pytest.mark.asyncio
async def test_upload_rejects_what_is_not_an_accepted_image(client):
    h = await _headers(client, "media-bad@example.com")
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    cases = [
        (svg, "unreadable"),
        (b"not an image at all", "unreadable"),
        (b"", "empty"),
        (_png((4, 4)), "too_small"),
    ]
    for data, reason in cases:
        response = await _upload(client, h, "chat_attachment", data)
        assert response.status_code == 422, (reason, response.text)
        assert response.json()["error_code"] == "MEDIA_INVALID_IMAGE"
        assert response.json()["params"]["reason"] == reason

    bomb = io.BytesIO()
    Image.new("1", (8000, 8000)).save(bomb, "PNG")  # 64 MP, a few KB on disk
    response = await _upload(client, h, "chat_attachment", bomb.getvalue(), "image/png")
    assert response.status_code == 422 and response.json()["params"]["reason"] == "dimensions"


@pytest.mark.asyncio
async def test_upload_purpose_is_gated_by_role(client):
    buyer = await _headers(client, "media-buyer@example.com")
    seller = await _headers(client, "media-seller2@example.com", "seller")
    admin = await _headers(client, "media-admin@example.com", "admin")

    assert (await _upload(client, buyer, "product_image", _png())).status_code == 403
    assert (await _upload(client, seller, "category_image", _png())).status_code == 403
    assert (await _upload(client, seller, "payout_receipt", _png())).status_code == 403
    assert (await _upload(client, admin, "category_image", _png())).status_code == 201
    assert (await _upload(client, {}, "chat_attachment", _png())).status_code == 401

    private = await _upload(client, buyer, "chat_attachment", _png())
    assert private.status_code == 201
    assert private.json()["url"] is None  # served only by the owning feature

    assert (await _upload(client, buyer, "not_a_purpose", _png())).status_code == 422


@pytest.mark.asyncio
async def test_private_objects_are_never_served_by_the_public_route(client):
    h = await _headers(client, "media-private@example.com")
    uploaded = (await _upload(client, h, "dispute_evidence", _png())).json()
    async with SessionLocal() as db:
        prefix = await db.scalar(select(MediaObject.key_prefix).where(MediaObject.public_id == uploaded["id"]))
    assert prefix.startswith("prv/")
    assert (await client.get(f"/public/media/{prefix}_full.webp")).status_code == 404
    assert (await client.get(f"/public/media/{prefix.replace('prv/', 'pub/', 1)}_full.webp")).status_code == 404
    assert (await client.get("/public/media/../../etc/passwd")).status_code == 404


@pytest.mark.asyncio
async def test_pending_uploads_are_capped_per_account(client, monkeypatch):
    monkeypatch.setattr(media_service, "MAX_PENDING_PER_ACCOUNT", 2)
    h = await _headers(client, "media-pending@example.com")
    for _ in range(2):
        assert (await _upload(client, h, "avatar", _png())).status_code == 201
    third = await _upload(client, h, "avatar", _png())
    assert third.status_code == 429 and third.json()["error_code"] == "MEDIA_PENDING_LIMIT"


@pytest.mark.asyncio
async def test_uploads_are_rate_limited_per_account(client, monkeypatch):
    seen = []

    async def refuse(key, **kwargs):
        seen.append((key, kwargs["limit"], kwargs["window_seconds"]))
        return False

    monkeypatch.setattr("src.media.router.check_rate_limit", refuse)
    h = await _headers(client, "media-flood@example.com")
    response = await _upload(client, h, "chat_attachment", _png())
    assert response.status_code == 429 and response.json()["error_code"] == "RATE_LIMITED"
    assert response.headers["retry-after"] == "600"
    account = await _account("media-flood@example.com")
    assert seen == [(f"media-upload:{account.id}", 1_000_000, 3600)]


@pytest.mark.asyncio
async def test_oversized_bodies_are_refused_before_the_signature_check(client):
    h = await _headers(client, "media-big@example.com")
    too_big = b"\0" * (10_485_760 + 1)
    response = await _upload(client, h, "chat_attachment", too_big)
    assert response.status_code == 413 and response.json()["error_code"] == "REQUEST_TOO_LARGE"
    # Unsigned and oversized: the size cap answers before the body is buffered
    # for signature verification (which would answer 401).
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as raw:
        unsigned = await raw.post("/auth/login", content=b"x" * 2_000_000, headers={"Content-Type": "application/json"})
    assert unsigned.status_code == 413


# --------------------------------------------------------------------------- attach

async def _pending(owner_email: str, purpose=MediaPurpose.product_image, n=1) -> list[str]:
    async with SessionLocal() as db:
        owner = await db.scalar(select(Account).where(Account.email == owner_email))
        ids = []
        for _ in range(n):
            obj = await media_service.upload(db, owner, purpose, _png())
            ids.append(obj.public_id)
        return ids


@pytest.mark.asyncio
async def test_set_subject_media_enforces_owner_purpose_and_limit(client):
    await _headers(client, "attach-owner@example.com", "seller")
    await _headers(client, "attach-other@example.com", "seller")
    mine = await _pending("attach-owner@example.com", n=3)
    theirs = await _pending("attach-other@example.com")
    avatar = await _pending("attach-owner@example.com", MediaPurpose.avatar)
    owner = await _account("attach-owner@example.com")

    async def attach(ids, max_count=8, actor=owner.id, subject_id=1):
        async with SessionLocal() as db:
            snaps = await media_service.set_subject_media(
                db, actor_id=actor, purpose=MediaPurpose.product_image, subject_type="product",
                subject_id=subject_id, public_ids=ids, max_count=max_count,
            )
            await db.commit()
            return snaps

    for ids, code in (
        (theirs, "MEDIA_NOT_ATTACHABLE"),
        (avatar, "MEDIA_NOT_ATTACHABLE"),
        (["zzzzzzzzzzzzzzzz"], "MEDIA_NOT_FOUND"),
    ):
        with pytest.raises(MediaError) as exc:
            await attach(ids)
        assert exc.value.code.value == code
    with pytest.raises(MediaError) as exc:
        await attach(mine, max_count=2)
    assert exc.value.code.value == "MEDIA_LIMIT_EXCEEDED" and exc.value.params == {"max": 2}

    snaps = await attach(mine)
    assert [s["id"] for s in snaps] == mine
    assert snaps[0]["key"].startswith("pub/product_image/") and snaps[0]["thumb"] is True
    assert media_service.public_image(snaps[0])["url"].endswith("_full.webp")

    # Dropping one detaches it; listing it again (same subject) restores it,
    # even for another editor such as an admin.
    await attach(mine[1:])
    async with SessionLocal() as db:
        statuses = dict((await db.execute(
            select(MediaObject.public_id, MediaObject.status).where(MediaObject.public_id.in_(mine))
        )).all())
    assert statuses == {mine[0]: "detached", mine[1]: "attached", mine[2]: "attached"}
    other = await _account("attach-other@example.com")
    assert [s["id"] for s in await attach(mine, actor=other.id)] == mine

    # An image attached to one subject cannot be reused on another.
    with pytest.raises(MediaError):
        await attach(mine[:1], subject_id=2)


@pytest.mark.asyncio
async def test_garbage_collection_removes_expired_uploads_only(client):
    await _headers(client, "gc-owner@example.com")
    stale, fresh, kept, dropped = await _pending("gc-owner@example.com", MediaPurpose.chat_attachment, n=4)
    owner = await _account("gc-owner@example.com")
    async with SessionLocal() as db:
        await media_service.set_subject_media(
            db, actor_id=owner.id, purpose=MediaPurpose.chat_attachment, subject_type="chat_message",
            subject_id=7, public_ids=[kept, dropped], max_count=4,
        )
        await media_service.detach_subjects(db, subject_type="chat_message", subject_ids=[7])
        await media_service.set_subject_media(
            db, actor_id=owner.id, purpose=MediaPurpose.chat_attachment, subject_type="chat_message",
            subject_id=7, public_ids=[kept], max_count=4,
        )
        old = datetime.now(timezone.utc) - timedelta(days=8)
        await db.execute(update(MediaObject).where(MediaObject.public_id.in_([stale, kept])).values(created_at=old))
        await db.execute(update(MediaObject).where(MediaObject.public_id == dropped).values(detached_at=old))
        await db.commit()

    assert await media_service.collect_garbage() == 2
    async with SessionLocal() as db:
        left = set(await db.scalars(select(MediaObject.public_id)))
        blobs = await db.scalar(select(func.count()).select_from(MediaBlob))
    assert left == {fresh, kept}
    assert blobs == 4  # two variants each for the survivors


# --------------------------------------------------------------------------- S3 adapter

@pytest.mark.no_db
def test_sigv4_matches_the_published_aws_examples():
    creds = Credentials("AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1")
    moment = datetime(2013, 5, 24, tzinfo=timezone.utc)
    url = "https://examplebucket.s3.amazonaws.com/test.txt"
    signed = sign_request(creds, "GET", url, {"Range": "bytes=0-9"}, EMPTY_SHA256, moment)
    assert signed["authorization"].endswith(
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    )
    assert presign_url(creds, "GET", url, 86400, moment).endswith(
        "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
    )


class FakeS3:
    """In-memory S3 that insists on SigV4-signed requests."""

    def __init__(self):
        self.objects: dict[tuple[str, str], tuple[bytes, dict]] = {}
        self.fail_deletes = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"].startswith("AWS4-HMAC-SHA256 Credential=test-key/")
        assert request.headers["x-amz-content-sha256"] == hashlib.sha256(request.content).hexdigest()
        _, bucket, key = request.url.path.split("/", 2)
        if request.method == "PUT":
            self.objects[(bucket, key)] = (request.content, dict(request.headers))
            return httpx.Response(200)
        if request.method == "DELETE" and self.fail_deletes:
            return httpx.Response(500)
        if (bucket, key) not in self.objects:
            return httpx.Response(404)
        if request.method == "DELETE":
            del self.objects[(bucket, key)]
            return httpx.Response(204)
        data = self.objects[(bucket, key)][0]
        if request.method == "HEAD":
            return httpx.Response(200, headers={"content-length": str(len(data))})
        return httpx.Response(200, content=data)

    def store(self) -> S3MediaStore:
        client = S3Client(
            endpoint="https://s3.test", region="auto", access_key_id="test-key", secret_access_key="test-secret",
            transport=httpx.MockTransport(self.handler),
        )
        return S3MediaStore(client, public_bucket="pub-bucket", private_bucket="prv-bucket")


@pytest.fixture
def fake_s3(monkeypatch):
    fake = FakeS3()
    s3 = fake.store()
    monkeypatch.setattr(media_store, "_configured_s3", lambda: s3)
    return fake


@pytest.mark.asyncio
async def test_s3_uploads_split_buckets_and_private_reads_redirect_to_signed_urls(client, fake_s3, monkeypatch):
    monkeypatch.setattr(media_store.settings, "media_storage", "s3")
    seller = await _headers(client, "s3-seller@example.com", "seller")
    public = (await _upload(client, seller, "product_image", _png((900, 900), "RGB"))).json()
    private = (await _upload(client, seller, "chat_attachment", _png())).json()

    buckets = {bucket for bucket, _ in fake_s3.objects}
    assert buckets == {"pub-bucket", "prv-bucket"}
    headers = {bucket: meta for (bucket, _), (_, meta) in fake_s3.objects.items()}
    assert headers["pub-bucket"]["cache-control"] == "public, max-age=31536000, immutable"
    assert headers["prv-bucket"]["cache-control"] == "private, max-age=3600"
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(MediaBlob)) == 0

    served = await client.get(f"/public/media/{public['url'].removeprefix('/media/')}")
    assert served.status_code == 200 and served.content == fake_s3.objects[
        ("pub-bucket", public["url"].removeprefix("/media/"))
    ][0]

    from starlette.requests import Request

    async with SessionLocal() as db:
        obj = await db.scalar(select(MediaObject).where(MediaObject.public_id == private["id"]))
        response = await image_response(db, Request({"type": "http", "headers": []}), obj, "thumb")
    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith(f"https://s3.test/prv-bucket/{obj.key_prefix}_thumb.webp?")
    assert "X-Amz-Signature=" in location and "X-Amz-Expires=600" in location


@pytest.mark.asyncio
async def test_objects_move_from_postgres_to_s3_and_back(client, fake_s3):
    seller = await _headers(client, "move-seller@example.com", "seller")
    uploaded = [(await _upload(client, seller, "product_image", _png((300, 200), "RGB"))).json() for _ in range(2)]
    await _upload(client, seller, "chat_attachment", _png())

    dry = await migrate_objects(target="s3", apply=False)
    assert (dry.pending, dry.moved) == (3, 0)
    assert fake_s3.objects == {}

    report = await migrate_objects(target="s3", apply=True)
    assert (report.moved, report.failed) == (3, [])
    async with SessionLocal() as db:
        assert set(await db.scalars(select(MediaObject.storage))) == {"s3"}
        assert await db.scalar(select(func.count()).select_from(MediaBlob)) == 0
    assert len(fake_s3.objects) == 6
    assert (await verify_objects(check_hash=True)).ok

    # Still served after the move, from the bucket.
    first = uploaded[0]["url"].removeprefix("/media/")
    assert (await client.get(f"/public/media/{first}")).status_code == 200

    # Rerunning is a no-op.
    assert (await migrate_objects(target="s3", apply=True)).moved == 0

    # Leaving S3 again (rollback) restores the blobs and empties the buckets.
    back = await migrate_objects(target="db", apply=True)
    assert (back.moved, back.failed) == (3, [])
    assert fake_s3.objects == {}
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(MediaBlob)) == 6
    assert (await verify_objects(check_hash=True)).ok

    # A lost object is reported, and cannot be moved.
    async with SessionLocal() as db:
        await db.execute(MediaBlob.__table__.delete().where(MediaBlob.key == first))
        await db.commit()
    broken = await verify_objects()
    assert not broken.ok and broken.missing and first in broken.missing[0]
    failed = await migrate_objects(target="s3", apply=True)
    assert failed.moved == 2 and len(failed.failed) == 1


@pytest.mark.asyncio
async def test_s3_client_reuses_one_connection_pool():
    s3 = FakeS3().store().client
    await s3.put_object("pub-bucket", "k.webp", b"x", content_type="image/webp")
    pool = s3._http
    assert await s3.get_object("pub-bucket", "k.webp") == b"x"
    assert pool is not None and s3._http is pool
    await s3.aclose()
    assert pool.is_closed


@pytest.mark.asyncio
async def test_s3_client_retries_connection_failures_only():
    calls = []

    def flaky(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        if len(calls) < 3:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(200, content=b"x")

    s3 = S3Client(endpoint="https://s3.test", region="auto", access_key_id="k", secret_access_key="s",
                  transport=httpx.MockTransport(flaky))
    assert await s3.get_object("pub-bucket", "k.webp") == b"x"
    assert calls == ["GET"] * 3

    def slow(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        raise httpx.ReadTimeout("slow", request=request)

    calls.clear()
    s3 = S3Client(endpoint="https://s3.test", region="auto", access_key_id="k", secret_access_key="s",
                  transport=httpx.MockTransport(slow))
    with pytest.raises(S3Error):
        await s3.put_object("pub-bucket", "k.webp", b"x", content_type="image/webp")
    assert calls == ["PUT"]  # the bucket may have received it: never resent


@pytest.mark.asyncio
async def test_s3_takedown_deletes_the_objects_before_marking_removed(client, fake_s3, monkeypatch):
    monkeypatch.setattr(media_store.settings, "media_storage", "s3")
    seller = await _headers(client, "takedown-seller@example.com", "seller")
    admin = await _headers(client, "takedown-admin@example.com", "admin")
    image = (await _upload(client, seller, "product_image", _png((300, 200), "RGB"))).json()
    public_key = image["url"].removeprefix("/media/")
    assert len(fake_s3.objects) == 2

    # The bucket refuses the delete: the takedown fails and nothing claims the image is gone.
    fake_s3.fail_deletes = True
    failed = await client.post(f"/admin/media/{image['id']}/remove", json={"reason": "Lộ số điện thoại"}, headers=admin)
    assert failed.status_code == 503
    assert len(fake_s3.objects) == 2
    async with SessionLocal() as db:
        assert await db.scalar(select(MediaObject.status).where(MediaObject.public_id == image["id"])) == "pending"

    fake_s3.fail_deletes = False
    removed = await client.post(f"/admin/media/{image['id']}/remove", json={"reason": "Lộ số điện thoại"}, headers=admin)
    assert removed.status_code == 200 and removed.json()["status"] == "removed"
    assert fake_s3.objects == {}
    assert (await client.get(f"/public/media/{public_key}")).status_code == 404


@pytest.mark.asyncio
async def test_migration_drops_its_copy_of_an_image_taken_down_mid_move(client, fake_s3, monkeypatch):
    seller = await _headers(client, "race-seller@example.com", "seller")
    image = (await _upload(client, seller, "product_image", _png((300, 200), "RGB"))).json()
    read_all = media_transfer._read_all

    async def read_then_take_down(db, store, obj):
        payload = await read_all(db, store, obj)
        async with SessionLocal() as other:
            await other.execute(update(MediaObject).where(MediaObject.id == obj.id).values(status="removed"))
            await other.commit()
        return payload

    monkeypatch.setattr(media_transfer, "_read_all", read_then_take_down)
    report = await migrate_objects(target="s3", apply=True)
    assert (report.moved, report.failed) == (0, [])
    assert fake_s3.objects == {}
    async with SessionLocal() as db:
        row = await db.scalar(select(MediaObject).where(MediaObject.public_id == image["id"]))
        assert (row.storage, row.status) == ("db", "removed")
