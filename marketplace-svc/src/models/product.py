from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class ProductStatus(str, PyEnum):
    draft = "draft"
    active = "active"
    paused = "paused"
    suspended = "suspended"


class DeliveryMode(str, PyEnum):
    instant = "instant"
    manual = "manual"


class ServiceType(str, PyEnum):
    proxy = "proxy"
    account = "account"
    token = "token"
    endpoint = "endpoint"
    takedown = "takedown"
    cloud = "cloud"
    payment = "payment"
    other = "other"


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    images: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    escrow_days: Mapped[int] = mapped_column(Integer, default=2)
    status: Mapped[ProductStatus] = mapped_column(Enum(ProductStatus), default=ProductStatus.draft)

    service_type: Mapped[str | None] = mapped_column(String(50), nullable=True, default="other")
    features: Mapped[list | None] = mapped_column(JSON, nullable=True)
    specs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    warranty_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    highlight_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    sold_count: Mapped[int] = mapped_column(Integer, default=0)
    rating_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    rating_count: Mapped[int] = mapped_column(Integer, default=0)
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("providers.id"), nullable=True)
    pricing_strategy: Mapped[str | None] = mapped_column(String(50), nullable=True, default=None)
    pricing_params: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)
    commission_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    # { "en"|"vi": {title, description, warranty_text, highlight_text, features} }
    i18n: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}", default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ProductVariant(Base):
    __tablename__ = "product_variants"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    delivery_mode: Mapped[DeliveryMode] = mapped_column(Enum(DeliveryMode), default=DeliveryMode.instant)
    sla_hours: Mapped[int] = mapped_column(Integer, default=24)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # { "en": {"name": "..."}, "vi": {"name": "..."} }
    i18n: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}", default=dict)
