"""Domain HTTP exceptions — now coded (EN detail + stable error_code).

Existing call sites keep raising these classes; the global handler emits
``{"detail", "error_code", "params"}`` for CodedHTTPException subclasses.
"""

from fastapi import status

from src.errors.codes import ErrorCode
from src.errors.exceptions import CodedHTTPException, api_error

__all__ = [
    "CodedHTTPException",
    "ErrorCode",
    "InsufficientCredit",
    "ResourceUnavailable",
    "NotOwner",
    "DuplicateEmail",
    "QuotaExceeded",
    "QuotaExpired",
    "api_error",
]


class InsufficientCredit(CodedHTTPException):
    def __init__(self) -> None:
        super().__init__(ErrorCode.INSUFFICIENT_CREDIT, status.HTTP_402_PAYMENT_REQUIRED)


class ResourceUnavailable(CodedHTTPException):
    def __init__(self) -> None:
        super().__init__(ErrorCode.RESOURCE_UNAVAILABLE, status.HTTP_409_CONFLICT)


class NotOwner(CodedHTTPException):
    def __init__(self) -> None:
        super().__init__(ErrorCode.NOT_OWNER, status.HTTP_403_FORBIDDEN)


class DuplicateEmail(CodedHTTPException):
    def __init__(self) -> None:
        super().__init__(ErrorCode.DUPLICATE_EMAIL, status.HTTP_409_CONFLICT)


class QuotaExceeded(CodedHTTPException):
    def __init__(self) -> None:
        super().__init__(ErrorCode.QUOTA_EXCEEDED, status.HTTP_402_PAYMENT_REQUIRED)


class QuotaExpired(CodedHTTPException):
    def __init__(self) -> None:
        super().__init__(ErrorCode.QUOTA_EXPIRED, status.HTTP_410_GONE)
