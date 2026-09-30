"""Register exception handlers that emit additive error_code fields."""

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.content_filter.service import ContentBlocked
from src.errors.codes import ErrorCode
from src.errors.exceptions import CodedHTTPException
from src.media.errors import MediaError
from src.public_api.errors import PublicApiError, error_response, is_public_api_path, translate


# FastAPI's default 422 echoes every refused value back as `input`: a password
# that is too short, a stock line full of cookies sent as a format. Where and
# why is enough for a client; the value itself never leaves the server.
_HIDDEN_VALIDATION_KEYS = frozenset({"input", "url"})


def _note_error(request: Request, *, code: str | None = None, detail: object = None) -> None:
    """Leave the error on request.state for the access log (middleware.py).

    Only the code and a short plain-text detail — never params or input, which
    can carry what the user typed.
    """
    if code:
        request.state.error_code = str(code)
    if isinstance(detail, str) and detail:
        request.state.error_detail = detail[:200]


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        if is_public_api_path(_request.url.path):
            return translate(422, None)
        _note_error(
            _request,
            code="VALIDATION_ERROR",
            detail="; ".join(
                f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('type', '')}" for e in exc.errors()[:5]
            ),
        )
        errors = [
            {key: value for key, value in error.items() if key not in _HIDDEN_VALIDATION_KEYS}
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": jsonable_encoder(errors)},
        )

    @app.exception_handler(ContentBlocked)
    async def content_blocked_handler(_request: Request, exc: ContentBlocked) -> JSONResponse:
        coded = CodedHTTPException(
            ErrorCode.CONTENT_BLOCKED, status.HTTP_422_UNPROCESSABLE_CONTENT,
            params={"matches": exc.matches},
        )
        _note_error(_request, code=coded.error_code)
        return JSONResponse(
            status_code=coded.status_code,
            content={"detail": coded.detail, "error_code": coded.error_code, "params": coded.params},
        )

    @app.exception_handler(MediaError)
    async def media_error_handler(_request: Request, exc: MediaError) -> JSONResponse:
        coded = CodedHTTPException(exc.code, exc.status_code, params=exc.params)
        _note_error(_request, code=coded.error_code)
        return JSONResponse(
            status_code=coded.status_code,
            content={"detail": coded.detail, "error_code": coded.error_code, "params": coded.params},
        )

    # The public sales API (/v1) answers every error as {"error": {code, message}}.
    @app.exception_handler(PublicApiError)
    async def public_api_error_handler(_request: Request, exc: PublicApiError) -> JSONResponse:
        _note_error(_request, code=exc.code)
        return error_response(exc.code, exc.status_code, exc.message, exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def plain_http_exception_handler(request: Request, exc: StarletteHTTPException):
        _note_error(request, detail=exc.detail)
        if is_public_api_path(request.url.path):
            return translate(exc.status_code, exc.detail, None, getattr(exc, "headers", None))
        return await http_exception_handler(request, exc)

    @app.exception_handler(CodedHTTPException)
    async def coded_http_exception_handler(
        request: Request, exc: CodedHTTPException
    ) -> JSONResponse:
        _note_error(request, code=exc.error_code)
        if is_public_api_path(request.url.path):
            return translate(exc.status_code, exc.detail, exc.error_code, getattr(exc, "headers", None))
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": exc.detail,
                "error_code": exc.error_code,
                "params": exc.params,
            },
            headers=getattr(exc, "headers", None) or None,
        )
