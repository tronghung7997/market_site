"""Public images on categories, seller shops and accounts

Each column holds a media snapshot (``media.service.snapshot``: id, key, w, h,
thumb) so storefront payloads build image URLs without joining
``media_objects``. Product galleries need no column: they live in the existing
``products.images`` JSON next to ``cover_id``.

Revision ID: gg1a2b3c4d5e6
Revises: gf1a2b3c4d5e6
Create Date: 2026-09-26
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "gg1a2b3c4d5e6"
down_revision = "gf1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("categories", sa.Column("image", postgresql.JSONB(), nullable=True))
    op.add_column("seller_applications", sa.Column("logo", postgresql.JSONB(), nullable=True))
    op.add_column("seller_applications", sa.Column("banner", postgresql.JSONB(), nullable=True))
    op.add_column("accounts", sa.Column("avatar", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("accounts", "avatar")
    op.drop_column("seller_applications", "banner")
    op.drop_column("seller_applications", "logo")
    op.drop_column("categories", "image")
