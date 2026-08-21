from enum import StrEnum


class ConversationKind(StrEnum):
    PRODUCT_INQUIRY = "product_inquiry"
    ORDER = "order"
    SUPPORT = "support"


class ConversationStatus(StrEnum):
    OPEN = "open"
    RESOLVED = "resolved"
    CLOSED = "closed"
    BLOCKED = "blocked"
    READ_ONLY = "read_only"


class ContextRole(StrEnum):
    BUYER = "buyer"
    SELLER = "seller"
    ADMIN = "admin"

