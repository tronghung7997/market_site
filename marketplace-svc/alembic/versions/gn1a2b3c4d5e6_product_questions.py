"""product questions: buyer-asked public Q&A

Revision ID: gn1a2b3c4d5e6
Revises: gm1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op

revision = "gn1a2b3c4d5e6"
down_revision = "gm1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asker_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("question", sa.String(500), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("hidden_by", sa.String(16), nullable=True),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('pending', 'answered', 'hidden')", name="ck_product_questions_status"),
        sa.CheckConstraint("hidden_by IS NULL OR hidden_by IN ('seller', 'admin')", name="ck_product_questions_hidden_by"),
    )
    op.create_index("ix_product_questions_public", "product_questions", ["product_id", "status", "answered_at"])
    op.create_index("ix_product_questions_asker", "product_questions", ["asker_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_product_questions_asker", table_name="product_questions")
    op.drop_index("ix_product_questions_public", table_name="product_questions")
    op.drop_table("product_questions")
