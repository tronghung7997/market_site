"""Admin accounts + seller review: reviewer trail, info fields, resubmit cool-down,
admin notes, persisted lock reason, login_events(ip) index

Revision ID: hq1a2b3c4d5e6
Revises: ho1a2b3c4d5e6
Create Date: 2026-09-30

"hp" is taken on another branch (feat/proxy-renewal); expect a merge revision.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "hq1a2b3c4d5e6"
down_revision = "ho1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("seller_applications", sa.Column("reviewed_by", sa.Integer(), nullable=True))
    op.add_column("seller_applications", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("seller_applications", sa.Column("info_fields", JSONB(), nullable=True))
    op.add_column("seller_applications", sa.Column("resubmit_after", sa.DateTime(timezone=True), nullable=True))
    op.add_column("seller_applications", sa.Column("previous_snapshot", JSONB(), nullable=True))
    op.create_index("ix_seller_applications_status_created", "seller_applications", ["status", "created_at"])

    op.add_column("accounts", sa.Column("lock_reason", sa.String(500), nullable=True))
    op.add_column("accounts", sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("accounts", sa.Column("locked_by_id", sa.Integer(), nullable=True))

    op.create_table(
        "admin_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subject_type", sa.String(32), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.String(2000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("subject_type IN ('account', 'seller_application')", name="ck_admin_notes_subject_type"),
    )
    op.create_index("ix_admin_notes_subject", "admin_notes", ["subject_type", "subject_id", "created_at"])
    op.execute("CREATE INDEX IF NOT EXISTS ix_login_events_ip ON login_events (ip)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_login_events_ip")
    op.drop_index("ix_admin_notes_subject", table_name="admin_notes")
    op.drop_table("admin_notes")
    op.drop_column("accounts", "locked_by_id")
    op.drop_column("accounts", "locked_at")
    op.drop_column("accounts", "lock_reason")
    op.drop_index("ix_seller_applications_status_created", table_name="seller_applications")
    for col in ("previous_snapshot", "resubmit_after", "info_fields", "reviewed_at", "reviewed_by"):
        op.drop_column("seller_applications", col)
