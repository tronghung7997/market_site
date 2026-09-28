"""Minimal S3-compatible client (AWS Signature V4 over httpx).

Covers what media storage needs: put, get, head, delete and presigned GET URLs,
with path-style addressing (``{endpoint}/{bucket}/{key}``), which Cloudflare R2,
MinIO, AWS S3 and Backblaze B2 all accept. Kept deliberately small instead of
pulling boto: the only calls are these five, and they stay async.

Signing follows the AWS SigV4 specification; ``tests/test_media.py`` checks it
against the published AWS examples.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

import httpx

EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD"
# Connection failures (DNS, refused, connect timeout) are tried this many times.
CONNECT_ATTEMPTS = 3


def _hmac(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode(), hashlib.sha256).digest()


def _uri_encode(value: str, *, keep_slash: bool) -> str:
    return quote(value, safe="-_.~/" if keep_slash else "-_.~")


def _amz_dates(now: datetime) -> tuple[str, str]:
    now = now.astimezone(timezone.utc)
    return now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")


@dataclass(frozen=True)
class Credentials:
    access_key_id: str
    secret_access_key: str
    region: str
    service: str = "s3"

    def scope(self, date: str) -> str:
        return f"{date}/{self.region}/{self.service}/aws4_request"

    def signing_key(self, date: str) -> bytes:
        key = _hmac(f"AWS4{self.secret_access_key}".encode(), date)
        key = _hmac(key, self.region)
        key = _hmac(key, self.service)
        return _hmac(key, "aws4_request")


def _canonical_query(params: dict[str, str]) -> str:
    return "&".join(
        f"{_uri_encode(k, keep_slash=False)}={_uri_encode(v, keep_slash=False)}"
        for k, v in sorted(params.items())
    )


def _signature(creds: Credentials, amz_date: str, date: str, canonical_request: str) -> str:
    string_to_sign = "\n".join((
        "AWS4-HMAC-SHA256",
        amz_date,
        creds.scope(date),
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ))
    return hmac.new(creds.signing_key(date), string_to_sign.encode(), hashlib.sha256).hexdigest()


def sign_request(
    creds: Credentials,
    method: str,
    url: str,
    headers: dict[str, str],
    payload_sha256: str,
    now: datetime,
) -> dict[str, str]:
    """Headers to send: ``headers`` plus x-amz-date, x-amz-content-sha256 and Authorization.

    Every given header is signed; ``url`` must already be encoded the way it is sent.
    """
    parts = urlsplit(url)
    amz_date, date = _amz_dates(now)
    signed = {k.lower(): v.strip() for k, v in headers.items()}
    signed["host"] = parts.netloc
    signed["x-amz-date"] = amz_date
    signed["x-amz-content-sha256"] = payload_sha256
    names = sorted(signed)
    query = dict(pair.split("=", 1) if "=" in pair else (pair, "") for pair in parts.query.split("&") if pair)
    canonical_request = "\n".join((
        method.upper(),
        parts.path or "/",
        "&".join(f"{k}={v}" for k, v in sorted(query.items())),
        "".join(f"{name}:{signed[name]}\n" for name in names),
        ";".join(names),
        payload_sha256,
    ))
    signature = _signature(creds, amz_date, date, canonical_request)
    signed["authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={creds.access_key_id}/{creds.scope(date)}, "
        f"SignedHeaders={';'.join(names)}, Signature={signature}"
    )
    signed.pop("host")  # httpx sets it from the URL
    return signed


def presign_url(creds: Credentials, method: str, url: str, expires: int, now: datetime) -> str:
    """Query-string signed URL (``url`` has no query of its own)."""
    parts = urlsplit(url)
    amz_date, date = _amz_dates(now)
    params = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{creds.access_key_id}/{creds.scope(date)}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(expires),
        "X-Amz-SignedHeaders": "host",
    }
    query = _canonical_query(params)
    canonical_request = "\n".join((
        method.upper(), parts.path or "/", query, f"host:{parts.netloc}\n", "host", UNSIGNED_PAYLOAD,
    ))
    signature = _signature(creds, amz_date, date, canonical_request)
    return f"{parts.scheme}://{parts.netloc}{parts.path}?{query}&X-Amz-Signature={signature}"


class S3Error(RuntimeError):
    def __init__(self, operation: str, status: int | None, detail: str = ""):
        super().__init__(f"S3 {operation} failed ({status}) {detail}".strip())
        self.operation = operation
        self.status = status


class S3Client:
    def __init__(
        self,
        *,
        endpoint: str,
        region: str,
        access_key_id: str,
        secret_access_key: str,
        timeout: float = 20.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.endpoint = endpoint.rstrip("/")
        self.creds = Credentials(access_key_id, secret_access_key, region or "auto")
        self._timeout = timeout
        self._transport = transport
        self._http: httpx.AsyncClient | None = None
        self._http_loop: asyncio.AbstractEventLoop | None = None

    def _client(self) -> httpx.AsyncClient:
        """One pooled client per event loop, so calls reuse keep-alive connections
        instead of paying a TLS handshake each (public images are proxied through
        here until MEDIA_PUBLIC_BASE_URL is set). No transport of our own unless a
        test injects one: httpx only honours HTTPS_PROXY for its default transport."""
        loop = asyncio.get_running_loop()
        if self._http is None or self._http.is_closed or self._http_loop is not loop:
            self._http = httpx.AsyncClient(timeout=self._timeout, transport=self._transport)
            self._http_loop = loop
        return self._http

    async def aclose(self) -> None:
        if self._http is not None and self._http_loop is asyncio.get_running_loop():
            await self._http.aclose()
        self._http = None

    def _url(self, bucket: str, key: str) -> str:
        return f"{self.endpoint}/{_uri_encode(bucket, keep_slash=False)}/{_uri_encode(key, keep_slash=True)}"

    async def _send(
        self, operation: str, method: str, bucket: str, key: str, *, body: bytes = b"", headers: dict | None = None,
    ) -> httpx.Response:
        url = self._url(bucket, key)
        payload_sha256 = hashlib.sha256(body).hexdigest() if body else EMPTY_SHA256
        signed = sign_request(self.creds, method, url, headers or {}, payload_sha256, datetime.now(timezone.utc))
        for attempt in range(CONNECT_ATTEMPTS):
            try:
                return await self._client().request(method, url, content=body or None, headers=signed)
            except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
                # Nothing reached the bucket, so a retry cannot double-apply.
                if attempt + 1 == CONNECT_ATTEMPTS:
                    raise S3Error(operation, None, type(exc).__name__) from exc
            except httpx.HTTPError as exc:
                raise S3Error(operation, None, type(exc).__name__) from exc
        raise AssertionError("unreachable")

    async def put_object(
        self, bucket: str, key: str, data: bytes, *, content_type: str, cache_control: str | None = None,
    ) -> None:
        headers = {"content-type": content_type}
        if cache_control:
            headers["cache-control"] = cache_control
        response = await self._send("put", "PUT", bucket, key, body=data, headers=headers)
        if response.status_code not in (200, 201):
            raise S3Error("put", response.status_code, response.text[:200])

    async def get_object(self, bucket: str, key: str) -> bytes | None:
        response = await self._send("get", "GET", bucket, key)
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise S3Error("get", response.status_code, response.text[:200])
        return response.content

    async def head_object(self, bucket: str, key: str) -> dict | None:
        response = await self._send("head", "HEAD", bucket, key)
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise S3Error("head", response.status_code)
        return {"size": int(response.headers.get("content-length", "0")), "etag": response.headers.get("etag")}

    async def delete_object(self, bucket: str, key: str) -> None:
        response = await self._send("delete", "DELETE", bucket, key)
        # S3 answers 204 whether or not the key existed.
        if response.status_code not in (200, 204, 404):
            raise S3Error("delete", response.status_code, response.text[:200])

    def presigned_get(self, bucket: str, key: str, *, expires: int, now: datetime) -> str:
        return presign_url(self.creds, "GET", self._url(bucket, key), expires, now)
