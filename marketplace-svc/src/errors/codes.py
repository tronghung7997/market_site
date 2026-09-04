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
    ADMIN_LOGIN_REQUIRED = "ADMIN_LOGIN_REQUIRED"
    ADMIN_ONLY = "ADMIN_ONLY"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
    QUOTA_EXPIRED = "QUOTA_EXPIRED"
    PRODUCT_NOT_FOUND = "PRODUCT_NOT_FOUND"
    VARIANT_NOT_FOUND = "VARIANT_NOT_FOUND"
    PRODUCT_UNAVAILABLE = "PRODUCT_UNAVAILABLE"
    SELF_PURCHASE = "SELF_PURCHASE"
    PROVIDER_NOT_CONFIGURED = "PROVIDER_NOT_CONFIGURED"
    INVALID_PRODUCT_CONFIG = "INVALID_PRODUCT_CONFIG"
    ORDER_QUANTITY_LIMIT = "ORDER_QUANTITY_LIMIT"
    ORDER_NOT_FOUND = "ORDER_NOT_FOUND"
    NOT_ORDER_OWNER = "NOT_ORDER_OWNER"
    ORDER_NOT_DELIVERED = "ORDER_NOT_DELIVERED"
    DISPUTE_ONLY_DELIVERED = "DISPUTE_ONLY_DELIVERED"
    DISPUTE_ESCROW_EXPIRED = "DISPUTE_ESCROW_EXPIRED"
    DISPUTE_ALREADY_OPEN = "DISPUTE_ALREADY_OPEN"
    CHAT_CONVERSATION_NOT_FOUND = "CHAT_CONVERSATION_NOT_FOUND"
    CHAT_PRODUCT_UNAVAILABLE = "CHAT_PRODUCT_UNAVAILABLE"
    CHAT_SELF_INQUIRY = "CHAT_SELF_INQUIRY"
    CHAT_INQUIRY_NOT_FOUND = "CHAT_INQUIRY_NOT_FOUND"
    CHAT_READ_ONLY = "CHAT_READ_ONLY"
    CHAT_MESSAGE_ID_CONFLICT = "CHAT_MESSAGE_ID_CONFLICT"
    CHAT_INVALID_PERSPECTIVE = "CHAT_INVALID_PERSPECTIVE"
    CHAT_ROLE_UNAVAILABLE = "CHAT_ROLE_UNAVAILABLE"
    ORDER_NOT_COMPLETED = "ORDER_NOT_COMPLETED"
    REVIEW_ALREADY_EXISTS = "REVIEW_ALREADY_EXISTS"
    ORDER_NOT_PENDING = "ORDER_NOT_PENDING"
    ORDER_NOT_PROCESSING = "ORDER_NOT_PROCESSING"
    DISPUTE_NOT_FOUND = "DISPUTE_NOT_FOUND"
    DISPUTE_ALREADY_RESOLVED = "DISPUTE_ALREADY_RESOLVED"
    DISPUTE_WITHDRAWAL_NOT_ALLOWED = "DISPUTE_WITHDRAWAL_NOT_ALLOWED"
    ORDER_NOT_USABLE = "ORDER_NOT_USABLE"
    ORDER_NOT_PROVISIONED = "ORDER_NOT_PROVISIONED"
    PROXY_NOT_ACTIVE = "PROXY_NOT_ACTIVE"
    PROXY_EXPIRED = "PROXY_EXPIRED"
    PROXY_ROTATION_UNSUPPORTED = "PROXY_ROTATION_UNSUPPORTED"
    PROXY_ROTATION_COOLDOWN = "PROXY_ROTATION_COOLDOWN"
    PROXY_PROVIDER_AUTH = "PROXY_PROVIDER_AUTH"
    PROXY_BINDING_INVALID = "PROXY_BINDING_INVALID"
    PROXY_PROVIDER_UNAVAILABLE = "PROXY_PROVIDER_UNAVAILABLE"
    PROXY_PROVIDER_INVALID = "PROXY_PROVIDER_INVALID"
    PROXY_NOT_FOUND = "PROXY_NOT_FOUND"
    PROXY_INVALID_IP = "PROXY_INVALID_IP"
    PROXY_IPV4_ONLY = "PROXY_IPV4_ONLY"
    PROXY_WHITELIST_LIMIT = "PROXY_WHITELIST_LIMIT"
    PROXY_WHITELIST_UNSUPPORTED = "PROXY_WHITELIST_UNSUPPORTED"
    INVENTORY_NOT_INSTANT = "INVENTORY_NOT_INSTANT"
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
    RESOURCE_NOT_EDITABLE = "RESOURCE_NOT_EDITABLE"
    RESOURCE_EMPTY = "RESOURCE_EMPTY"
    RESOURCE_NOT_DELETABLE = "RESOURCE_NOT_DELETABLE"
    CATEGORY_NOT_FOUND = "CATEGORY_NOT_FOUND"
    PRODUCT_SUSPENDED = "PRODUCT_SUSPENDED"
    PRODUCT_TITLE_EMPTY = "PRODUCT_TITLE_EMPTY"
    VARIANT_FIXED_ONLY = "VARIANT_FIXED_ONLY"
    VARIANT_HAS_HISTORY = "VARIANT_HAS_HISTORY"
    VARIANT_HAS_ORDERS = "VARIANT_HAS_ORDERS"
    VARIANT_HAS_RESOURCES = "VARIANT_HAS_RESOURCES"
    VARIANT_NAME_EMPTY = "VARIANT_NAME_EMPTY"
    PRODUCT_HAS_FIXED_VARIANTS = "PRODUCT_HAS_FIXED_VARIANTS"
    PROVIDER_NOT_APPROVED = "PROVIDER_NOT_APPROVED"
    PROVIDER_NOT_OWNED = "PROVIDER_NOT_OWNED"
    PRODUCT_PRICING_INCOMPATIBLE = "PRODUCT_PRICING_INCOMPATIBLE"
    SELLER_PROVIDER_RESTRICTED = "SELLER_PROVIDER_RESTRICTED"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    AUTH_RATE_LIMITED = "AUTH_RATE_LIMITED"
    PASSWORD_RESET_INVALID = "PASSWORD_RESET_INVALID"
    DISPUTE_INVALID_REFUND_AMOUNT = "DISPUTE_INVALID_REFUND_AMOUNT"
    DISPUTE_REPLACEMENT_UNAVAILABLE = "DISPUTE_REPLACEMENT_UNAVAILABLE"
    DISPUTE_NO_RESOURCES_TO_REPLACE = "DISPUTE_NO_RESOURCES_TO_REPLACE"
    DISPUTE_INVALID_EXTENSION_DAYS = "DISPUTE_INVALID_EXTENSION_DAYS"
    DISPUTE_WARRANTY_LIMIT = "DISPUTE_WARRANTY_LIMIT"
    DISPUTE_RESOURCE_NOT_CLAIMABLE = "DISPUTE_RESOURCE_NOT_CLAIMABLE"
    CHAT_SUPPORT_REQUIRES_DISPUTE = "CHAT_SUPPORT_REQUIRES_DISPUTE"
    CHAT_SUPPORT_REQUIRES_REVIEW = "CHAT_SUPPORT_REQUIRES_REVIEW"


MESSAGES_EN: dict[ErrorCode, str] = {
    ErrorCode.INSUFFICIENT_CREDIT: "Insufficient wallet balance for this transaction",
    ErrorCode.RESOURCE_UNAVAILABLE: (
        "This product is temporarily out of stock. Please choose another package or try again later"
    ),
    ErrorCode.NOT_OWNER: "You do not have permission to act on this resource",
    ErrorCode.DUPLICATE_EMAIL: "This email is already registered",
    ErrorCode.ADMIN_LOGIN_REQUIRED: "Administrator accounts must use the private admin sign-in",
    ErrorCode.ADMIN_ONLY: "This sign-in is restricted to administrator accounts",
    ErrorCode.QUOTA_EXCEEDED: "Request quota for this package is exhausted — purchase a new package",
    ErrorCode.QUOTA_EXPIRED: "This request package has expired",
    ErrorCode.PRODUCT_NOT_FOUND: "Product not found",
    ErrorCode.VARIANT_NOT_FOUND: "Product package not found",
    ErrorCode.PRODUCT_UNAVAILABLE: "This product is currently unavailable",
    ErrorCode.SELF_PURCHASE: "You cannot purchase your own product",
    ErrorCode.PROVIDER_NOT_CONFIGURED: "This product is not ready to accept orders",
    ErrorCode.INVALID_PRODUCT_CONFIG: "The selected product configuration is invalid",
    ErrorCode.ORDER_QUANTITY_LIMIT: "This product supports a maximum of {max} unit per order",
    ErrorCode.ORDER_NOT_FOUND: "Order not found",
    ErrorCode.NOT_ORDER_OWNER: "This is not your order",
    ErrorCode.ORDER_NOT_DELIVERED: "This order has not been delivered yet",
    ErrorCode.DISPUTE_ONLY_DELIVERED: "You can only open a dispute on a delivered order",
    ErrorCode.DISPUTE_ESCROW_EXPIRED: "The escrow window for this order has expired",
    ErrorCode.DISPUTE_ALREADY_OPEN: "This order already has an open dispute",
    ErrorCode.DISPUTE_WITHDRAWAL_NOT_ALLOWED: "This dispute can no longer be withdrawn after a seller remedy was applied",
    ErrorCode.CHAT_CONVERSATION_NOT_FOUND: "Conversation not found",
    ErrorCode.CHAT_PRODUCT_UNAVAILABLE: "This product is unavailable for inquiries",
    ErrorCode.CHAT_SELF_INQUIRY: "You cannot start an inquiry for your own product",
    ErrorCode.CHAT_INQUIRY_NOT_FOUND: "No conversation exists for this product yet",
    ErrorCode.CHAT_READ_ONLY: "This conversation is read-only",
    ErrorCode.CHAT_MESSAGE_ID_CONFLICT: "This message request was already used",
    ErrorCode.CHAT_INVALID_PERSPECTIVE: "Invalid conversation view",
    ErrorCode.CHAT_ROLE_UNAVAILABLE: "Your account cannot use this conversation view",
    ErrorCode.ORDER_NOT_COMPLETED: "This order is not completed yet",
    ErrorCode.REVIEW_ALREADY_EXISTS: "You have already reviewed this order",
    ErrorCode.ORDER_NOT_PENDING: "This order is not waiting for seller acceptance",
    ErrorCode.ORDER_NOT_PROCESSING: "This order is not awaiting delivery",
    ErrorCode.DISPUTE_NOT_FOUND: "Dispute not found",
    ErrorCode.DISPUTE_ALREADY_RESOLVED: "This dispute has already been resolved",
    ErrorCode.ORDER_NOT_USABLE: "This order is no longer in a usable state",
    ErrorCode.ORDER_NOT_PROVISIONED: "This order has not been provisioned yet",
    ErrorCode.PROXY_NOT_ACTIVE: "This order does not have an active proxy",
    ErrorCode.PROXY_EXPIRED: "This proxy has expired",
    ErrorCode.PROXY_ROTATION_UNSUPPORTED: "This proxy does not support IP rotation",
    ErrorCode.PROXY_ROTATION_COOLDOWN: "Please wait {seconds} seconds before rotating again",
    ErrorCode.PROXY_PROVIDER_AUTH: "Proxy provider authentication failed",
    ErrorCode.PROXY_BINDING_INVALID: "This order's proxy is no longer valid — contact support",
    ErrorCode.PROXY_PROVIDER_UNAVAILABLE: "Could not reach the proxy provider",
    ErrorCode.PROXY_PROVIDER_INVALID: "The proxy provider returned invalid data",
    ErrorCode.PROXY_NOT_FOUND: "This order does not have a proxy",
    ErrorCode.PROXY_INVALID_IP: "{ip} is not a valid IP address",
    ErrorCode.PROXY_IPV4_ONLY: "Only IPv4 addresses are accepted",
    ErrorCode.PROXY_WHITELIST_LIMIT: "Only one IP address can be declared",
    ErrorCode.PROXY_WHITELIST_UNSUPPORTED: "This product does not require an IP whitelist",
    ErrorCode.INVENTORY_NOT_INSTANT: "Only instant-delivery packages use inventory resources",
    ErrorCode.RESOURCE_NOT_FOUND: "Resource not found",
    ErrorCode.RESOURCE_NOT_EDITABLE: "Only in-stock resources can be edited",
    ErrorCode.RESOURCE_EMPTY: "Resource content cannot be empty",
    ErrorCode.RESOURCE_NOT_DELETABLE: "Only available resources can be deleted",
    ErrorCode.CATEGORY_NOT_FOUND: "Category not found",
    ErrorCode.PRODUCT_SUSPENDED: "This product is suspended and cannot be changed by the seller",
    ErrorCode.PRODUCT_TITLE_EMPTY: "Product name cannot be empty",
    ErrorCode.VARIANT_FIXED_ONLY: "Only fixed-price products use variants",
    ErrorCode.VARIANT_HAS_HISTORY: "Cannot switch to manual delivery while this package still has resource history",
    ErrorCode.VARIANT_HAS_ORDERS: "This package has {count} orders and cannot be deleted",
    ErrorCode.VARIANT_HAS_RESOURCES: "This package still has {count} inventory resources",
    ErrorCode.VARIANT_NAME_EMPTY: "Package name cannot be empty",
    ErrorCode.PRODUCT_HAS_FIXED_VARIANTS: "Remove fixed-price variants before switching to dynamic pricing",
    ErrorCode.PROVIDER_NOT_APPROVED: "This provider has not been approved yet",
    ErrorCode.PROVIDER_NOT_OWNED: "This provider belongs to another seller",
    ErrorCode.PRODUCT_PRICING_INCOMPATIBLE: "This pricing setup is not compatible with the connected provider",
    ErrorCode.SELLER_PROVIDER_RESTRICTED: "You can only attach a provider you registered yourself",
    ErrorCode.INVALID_CREDENTIALS: "Email or password is incorrect",
    ErrorCode.AUTH_RATE_LIMITED: "Too many attempts. Please try again later",
    ErrorCode.PASSWORD_RESET_INVALID: "This reset link is invalid or has expired",
    ErrorCode.DISPUTE_INVALID_REFUND_AMOUNT: "Refund amount must be greater than zero and less than the order total",
    ErrorCode.DISPUTE_REPLACEMENT_UNAVAILABLE: "Only automatically delivered orders with inventory can be replaced",
    ErrorCode.DISPUTE_NO_RESOURCES_TO_REPLACE: "This order has no delivered resources to replace",
    ErrorCode.DISPUTE_INVALID_EXTENSION_DAYS: "Extension days must be greater than zero",
    ErrorCode.DISPUTE_WARRANTY_LIMIT: (
        "This account already received a warranty replacement. Accept the case or chat with Marketplace"
    ),
    ErrorCode.DISPUTE_RESOURCE_NOT_CLAIMABLE: (
        "Only assigned accounts that have not been claimed can be added to this dispute"
    ),
    ErrorCode.CHAT_SUPPORT_REQUIRES_DISPUTE: "Marketplace chat is available while a dispute is open",
    ErrorCode.CHAT_SUPPORT_REQUIRES_REVIEW: (
        "Open Marketplace chat with a note so admin can pause auto-settlement"
    ),
}
