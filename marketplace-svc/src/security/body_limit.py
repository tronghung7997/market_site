import re
from collections.abc import Sequence

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.errors.codes import MESSAGES_EN, ErrorCode


def _too_large_response(max_bytes: int) -> JSONResponse:
    # Runs outside the exception handlers, so emit the coded body by hand.
    mb = max_bytes / (1024 * 1024)
    params = {"max_bytes": max_bytes, "max_mb": int(mb) if mb.is_integer() else round(mb, 1)}
    return JSONResponse(
        {
            "detail": MESSAGES_EN[ErrorCode.REQUEST_TOO_LARGE].format(**params),
            "error_code": ErrorCode.REQUEST_TOO_LARGE.value,
            "params": params,
        },
        status_code=413,
    )


class BodySizeLimitMiddleware:
    """Reject oversized request bodies before they are buffered into memory.

    ``overrides`` raises (or lowers) the cap for specific ``(method, path
    regex)`` pairs so one bulk endpoint does not widen every other route.
    """

    def __init__(
        self,
        app: ASGIApp,
        max_bytes: int,
        overrides: Sequence[tuple[str, str, int]] = (),
    ) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.overrides = [(method.upper(), re.compile(pattern), limit) for method, pattern, limit in overrides]

    def _limit_for(self, scope: Scope) -> int:
        method, path = scope.get("method", ""), scope.get("path", "")
        for override_method, pattern, limit in self.overrides:
            if method == override_method and pattern.fullmatch(path):
                return limit
        return self.max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        max_bytes = self._limit_for(scope)
        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        length = headers.get("content-length")
        if length:
            try:
                if int(length) > max_bytes:
                    await _too_large_response(max_bytes)(scope, receive, send)
                    return
            except ValueError:
                response = JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
                await response(scope, receive, send)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b"") or b"")
                if received > max_bytes:
                    raise BodyTooLarge()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except BodyTooLarge:
            await _too_large_response(max_bytes)(scope, receive, send)


class BodyTooLarge(Exception):
    pass
