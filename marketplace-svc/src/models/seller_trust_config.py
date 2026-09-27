"""Singleton (id=1) admin settings for the seller trust score and the
criteria each tier asks for. The shape is validated by
src/sellers/trust.py (``validate_config``); defaults live there too."""
from datetime import datetime

from sqlalchemy import DateTime, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SellerTrustConfig(Base):
    __tablename__ = "seller_trust_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    settings: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
