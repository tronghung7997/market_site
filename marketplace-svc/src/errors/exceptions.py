"""Coded HTTP exceptions — additive ``error_code`` + ``params`` on the body."""

from __future__ import annotations

from fastapi import HTTPException

from src.errors.codes import MESSAGES_EN, ErrorCode


class CodedHTTPException(HTTPException):
    """HTTPException that serializes as:

    ``{"detail": "<EN message>", "error_code": "...", "params": {...}}``
    """

    def __init__(
        self,
        code: ErrorCode,
        status_code: int,
        *,
        detail: str | None = None,
        params: dict | None = None,
        headers: dict | None = None,
    ) -> None:
        message = detail if detail is not None else MESSAGES_EN[code]
        if params:
            try:
                message = message.format(**params)
            except (KeyError, ValueError):
                # Keep unformatted EN template rather than crashing the handler.
                pass
        super().__init__(status_code=status_code, detail=message, headers=headers)
        self.error_code = code.value
        self.params = params or {}


def api_error(
    code: ErrorCode,
    status_code: int,
    *,
    detail: str | None = None,
    headers: dict | None = None,
    **params,
) -> CodedHTTPException:
    return CodedHTTPException(
        code, status_code, detail=detail, params=params or None, headers=headers,
    )
