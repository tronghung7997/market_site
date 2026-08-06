"""Stable API error codes (additive to string ``detail``)."""

from src.errors.codes import MESSAGES_EN, ErrorCode
from src.errors.exceptions import CodedHTTPException, api_error
from src.errors.handlers import register_error_handlers

__all__ = [
    "CodedHTTPException",
    "ErrorCode",
    "MESSAGES_EN",
    "api_error",
    "register_error_handlers",
]
