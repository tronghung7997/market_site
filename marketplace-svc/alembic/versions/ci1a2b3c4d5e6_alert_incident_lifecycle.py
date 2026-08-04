"""Alert incident lifecycle: fingerprint, timestamps, occurrence count.

Adds columns and a partial unique index so active incidents dedupe by
fingerprint (not by audience target alone). Existing rows keep
fingerprint NULL; timestamps are backfilled from created_at.

Revision ID: ci1a2b3c4d5e6
Revises: ch1a2b3c4d5e6
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa

revision = "ci1a2b3c4d5e6"
down_revision = "ch1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("alerts", sa.Column("fingerprint", sa.String(length=255), nullable=True))
    op.add_column(
        "alerts",
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "alerts",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "alerts",
        sa.Column("occurrence_count", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column("alerts", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))

    # Backfill timestamps from created_at for historical rows.
    op.execute(
        """
        UPDATE alerts
        SET first_seen_at = created_at,
            last_seen_at = created_at
        WHERE first_seen_at IS NULL OR last_seen_at IS NULL
        """
    )
    op.alter_column("alerts", "first_seen_at", nullable=False)
    op.alter_column("alerts", "last_seen_at", nullable=False)

    op.create_index(
        "uq_alerts_active_fingerprint",
        "alerts",
        ["fingerprint"],
        unique=True,
        postgresql_where=sa.text("is_active = true AND fingerprint IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_alerts_active_fingerprint",
        table_name="alerts",
        postgresql_where=sa.text("is_active = true AND fingerprint IS NOT NULL"),
    )
    op.drop_column("alerts", "resolved_at")
    op.drop_column("alerts", "occurrence_count")
    op.drop_column("alerts", "last_seen_at")
    op.drop_column("alerts", "first_seen_at")
    op.drop_column("alerts", "fingerprint")
