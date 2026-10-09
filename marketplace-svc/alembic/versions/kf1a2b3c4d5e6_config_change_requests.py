"""config_change_requests: two-step approval (maker-checker) for admin settings

Every admin settings change except the emergency switches (maintenance mode,
money freezes) is stored here as a pending request and applied only when a
different admin approves it (src/config_approval). One pending request per
section (partial unique index); `section` is a plain string validated by the
code registry so new sections need no migration.

Revision ID: kf1a2b3c4d5e6
Revises: ie1a2b3c4d5e6
Create Date: 2026-10-07
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "kf1a2b3c4d5e6"
down_revision = "ie1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "config_change_requests",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("section", sa.String(length=48), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("diff", postgresql.JSONB(), nullable=False),
        sa.Column("context", postgresql.JSONB(), nullable=True),
        sa.Column("base_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("base_version", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled', 'superseded', 'expired')",
            name="ck_config_change_requests_status",
        ),
    )
    op.create_index(
        "uq_config_change_requests_pending_section", "config_change_requests", ["section"],
        unique=True, postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index("ix_config_change_requests_status_id", "config_change_requests", ["status", "id"])


def downgrade() -> None:
    op.drop_index("ix_config_change_requests_status_id", table_name="config_change_requests")
    op.drop_index("uq_config_change_requests_pending_section", table_name="config_change_requests")
    op.drop_table("config_change_requests")
