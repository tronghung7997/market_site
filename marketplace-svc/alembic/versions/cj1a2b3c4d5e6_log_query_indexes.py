"""Indexes for admin log query shapes (WP6).

Revision ID: cj1a2b3c4d5e6
Revises: ci1a2b3c4d5e6
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa

revision = "cj1a2b3c4d5e6"
down_revision = "ci1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # created_at + id ordering for cursor pagination
    op.create_index(
        "ix_log_entries_created_at_id",
        "log_entries",
        ["created_at", "id"],
        unique=False,
    )
    # request_id already has a single-column index from the model; composite helps time-bounded filters
    op.create_index(
        "ix_log_entries_request_id_created_at",
        "log_entries",
        ["request_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_log_entries_job_id_created_at",
        "log_entries",
        ["job_id", "created_at"],
        unique=False,
    )
    # Expression index for metadata->>'order_id'
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_log_entries_metadata_order_id "
        "ON log_entries ((metadata->>'order_id'))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_log_entries_metadata_order_id")
    op.drop_index("ix_log_entries_job_id_created_at", table_name="log_entries")
    op.drop_index("ix_log_entries_request_id_created_at", table_name="log_entries")
    op.drop_index("ix_log_entries_created_at_id", table_name="log_entries")
