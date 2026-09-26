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


# media subject_type of an image sent in a chat message (subject_id = message id).
CHAT_ATTACHMENT_SUBJECT = "chat_message"
