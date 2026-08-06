"""Register exception handlers that emit additive error_code fields."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from src.errors.exceptions import CodedHTTPException


def register_error_handlers(app: FastAPI) -> None:
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
