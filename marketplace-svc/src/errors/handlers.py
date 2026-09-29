"""Register exception handlers that emit additive error_code fields."""

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.content_filter.service import ContentBlocked
from src.errors.codes import ErrorCode
from src.errors.exceptions import CodedHTTPException
from src.media.errors import MediaError


# FastAPI's default 422 echoes every refused value back as `input`: a password
# that is too short, a stock line full of cookies sent as a format. Where and
# why is enough for a client; the value itself never leaves the server.
_HIDDEN_VALIDATION_KEYS = frozenset({"input", "url"})


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
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
        return JSONResponse(
            status_code=coded.status_code,
            content={"detail": coded.detail, "error_code": coded.error_code, "params": coded.params},
        )

    @app.exception_handler(MediaError)
    async def media_error_handler(_request: Request, exc: MediaError) -> JSONResponse:
        coded = CodedHTTPException(exc.code, exc.status_code, params=exc.params)
        return JSONResponse(
            status_code=coded.status_code,
            content={"detail": coded.detail, "error_code": coded.error_code, "params": coded.params},
        )

    @app.exception_handler(CodedHTTPException)
    async def coded_http_exception_handler(
        _request: Request, exc: CodedHTTPException
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": exc.detail,
                "error_code": exc.error_code,
                "params": exc.params,
            },
            headers=getattr(exc, "headers", None) or None,
        )
