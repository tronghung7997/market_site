from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    icon: Mapped[str | None] = mapped_column(String(255), nullable=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    commission_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    # { "en": {"name": "..."}, "vi": {"name": "..."} } — scalars remain legacy fallback
    i18n: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}", default=dict)
