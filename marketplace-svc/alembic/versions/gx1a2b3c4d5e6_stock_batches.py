"""stock_batches: the format line and login notes of each stock upload

Every upload of stock lines is a batch ("lô") carrying its format — the column
names, `|`-separated like the lines (`UID|PASS|2FA|MAIL`) — and optional login
notes. Buyers see them above the lines they received; an order can hold lines
of several batches. `resources.batch_id` is NULL for stock uploaded before
batches existed: those lines are shown as they are until the seller assigns
them a format.

The index on `resources.batch_id` is built CONCURRENTLY so start-up upgrades
never block writes to `resources`; adding the nullable column itself is a
metadata-only change.

Revision ID: gx1a2b3c4d5e6
Revises: gw1a2b3c4d5e6
Create Date: 2026-09-28
"""
import sqlalchemy as sa
from alembic import op

revision = "gx1a2b3c4d5e6"
down_revision = "gw1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_batches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("variant_id", sa.Integer(), sa.ForeignKey("product_variants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("seller_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("format", sa.String(500), nullable=False),
        sa.Column("field_count", sa.Integer(), nullable=False),
        sa.Column("login_note", sa.String(500), nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="upload"),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("field_count >= 1", name="ck_stock_batches_field_count"),
    )
    op.add_column("resources", sa.Column("batch_id", sa.Integer(), sa.ForeignKey("stock_batches.id"), nullable=True))
    with op.get_context().autocommit_block():
        invalid = op.get_bind().execute(sa.text(
            "SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid "
            "WHERE c.relname = 'ix_resources_batch_id' AND NOT i.indisvalid"
        )).first()
        if invalid:
            op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_resources_batch_id")
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_resources_batch_id ON resources (batch_id)")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_resources_batch_id")
    op.drop_column("resources", "batch_id")
    op.drop_table("stock_batches")
