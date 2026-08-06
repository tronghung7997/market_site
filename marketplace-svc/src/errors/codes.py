"""Stable error codes + English default messages.

Client maps ``error_code`` → localized UI string; ``detail`` stays an EN
string for backward-compatible SDK/mobile parsers.
"""

from enum import Enum


class ErrorCode(str, Enum):
    INSUFFICIENT_CREDIT = "INSUFFICIENT_CREDIT"
    RESOURCE_UNAVAILABLE = "RESOURCE_UNAVAILABLE"
    NOT_OWNER = "NOT_OWNER"
    DUPLICATE_EMAIL = "DUPLICATE_EMAIL"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
    QUOTA_EXPIRED = "QUOTA_EXPIRED"


MESSAGES_EN: dict[ErrorCode, str] = {
    ErrorCode.INSUFFICIENT_CREDIT: "Insufficient wallet balance for this transaction",
    ErrorCode.RESOURCE_UNAVAILABLE: (
        "This product is temporarily out of stock. Please choose another package or try again later"
    ),
    ErrorCode.NOT_OWNER: "You do not have permission to act on this resource",
    ErrorCode.DUPLICATE_EMAIL: "This email is already registered",
    ErrorCode.QUOTA_EXCEEDED: "Request quota for this package is exhausted — purchase a new package",
    ErrorCode.QUOTA_EXPIRED: "This request package has expired",
}
