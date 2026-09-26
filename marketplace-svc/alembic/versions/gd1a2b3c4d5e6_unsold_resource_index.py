"""sellable stock: index only unsold resources

`ix_resources_variant_sellable` (gc1a2b3c4d5e6) covered every resource, so the
sellable-stock count (`status = available AND order_id IS NULL AND NOT
is_archived`, grouped by package) still read each row from the heap to check
`order_id`. The replacement keeps the same columns but only indexes rows with
`order_id IS NULL`: the stock count becomes an index-only scan over unsold
resources, and instant-inventory claims (`ORDER BY created_at, id ... FOR UPDATE
SKIP LOCKED`) read the same, smaller index. `order_id IS NULL` is a constant in
every query, so generic (prepared) plans can still prove the partial predicate.

Built CONCURRENTLY for the same reason as gc1a2b3c4d5e6.

Revision ID: gd1a2b3c4d5e6
Revises: gc1a2b3c4d5e6
Create Date: 2026-09-26
"""
import sqlalchemy as sa
from alembic import op

revision = "gd1a2b3c4d5e6"
down_revision = "gc1a2b3c4d5e6"
branch_labels = None
depends_on = None

_NEW = (
    "ix_resources_variant_unsold",
    "ON resources (variant_id, is_archived, status, created_at, id) WHERE order_id IS NULL",
)
_OLD = ("ix_resources_variant_sellable", "ON resources (variant_id, is_archived, status, created_at, id)")


def _create(name: str, definition: str) -> None:
    invalid = op.get_bind().execute(
        sa.text(
            "SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid "
            "WHERE c.relname = :name AND NOT i.indisvalid"
        ),
        {"name": name},
    ).first()
    if invalid:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
    op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} {definition}")


def upgrade() -> None:
    with op.get_context().autocommit_block():
        _create(*_NEW)
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_OLD[0]}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        _create(*_OLD)
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_NEW[0]}")
