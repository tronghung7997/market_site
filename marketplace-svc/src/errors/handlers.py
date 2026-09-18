"""Register exception handlers that emit additive error_code fields."""

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from src.content_filter.service import ContentBlocked
from src.errors.codes import ErrorCode
from src.errors.exceptions import CodedHTTPException


def register_error_handlers(app: FastAPI) -> None:
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
