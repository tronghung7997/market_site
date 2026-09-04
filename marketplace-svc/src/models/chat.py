import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class ChatConversation(Base):
    __tablename__ = "chat_conversations"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('product_inquiry', 'order', 'support')",
            name="ck_chat_conversations_kind",
        ),
        CheckConstraint(
            "status IN ('open', 'resolved', 'closed', 'blocked', 'read_only')",
            name="ck_chat_conversations_status",
        ),
        CheckConstraint(
            "kind != 'product_inquiry' OR "
            "(product_id IS NOT NULL AND buyer_id IS NOT NULL AND seller_id IS NOT NULL)",
            name="ck_chat_conversations_inquiry_context",
        ),
        Index(
            "uq_chat_product_inquiry",
            "buyer_id",
            "seller_id",
            "product_id",
            unique=True,
            postgresql_where=text("kind = 'product_inquiry'"),
        ),
        Index(
            "uq_chat_order_conversation",
            "order_id",
            unique=True,
            postgresql_where=text("kind = 'order'"),
        ),
        Index(
            "uq_chat_support_order_requester",
            "order_id",
            "requester_id",
            unique=True,
            postgresql_where=text("kind = 'support'"),
        ),
        CheckConstraint(
            "kind != 'support' OR "
            "(order_id IS NOT NULL AND requester_id IS NOT NULL AND requester_role IN ('buyer', 'seller'))",
            name="ck_chat_conversations_support_context",
        ),
        Index("ix_chat_conversations_last_message", "last_message_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="open")
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    buyer_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    seller_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    requester_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    requester_role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    last_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ChatParticipant(Base):
    __tablename__ = "chat_participants"
    __table_args__ = (
        CheckConstraint(
            "context_role IN ('buyer', 'seller', 'admin')",
            name="ck_chat_participants_context_role",
        ),
        Index("ix_chat_participants_account", "account_id", "archived_at"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_conversations.id", ondelete="CASCADE"), primary_key=True
    )
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    context_role: Mapped[str] = mapped_column(String(16), nullable=False)
    last_read_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id", "client_message_id", name="uq_chat_message_client_id"
        ),
        CheckConstraint("length(body) BETWEEN 1 AND 4000", name="ck_chat_messages_body"),
        Index("ix_chat_messages_conversation_id", "conversation_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False
    )
    sender_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    sender_role: Mapped[str] = mapped_column(String(16), nullable=False)
    client_message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
