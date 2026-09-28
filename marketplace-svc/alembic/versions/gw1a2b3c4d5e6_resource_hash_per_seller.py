"""resources.data_hash: unique per seller instead of across the marketplace

`uq_resources_data_hash` (fg…) refused a line whenever *any* shop held the
same content, so a second seller could not list stock the first one also had
— and the refusal told them somebody else holds that credential. Duplicates
are now refused per shop: `(seller_id, data_hash)` is unique (a shop still
cannot list one credential twice nor re-sell it after delivery), and a plain
index on `data_hash` keeps the exact-content searches fast.

The new indexes are built CONCURRENTLY before the old constraint is dropped,
so `alembic upgrade head` at start-up never blocks writes to `resources`
while they build; an index left INVALID by an interrupted build is rebuilt.

Downgrade restores the marketplace-wide constraint and fails, naming the
count, while two shops hold the same content.

Revision ID: gw1a2b3c4d5e6
Revises: gv1a2b3c4d5e6
Create Date: 2026-09-28
"""
import sqlalchemy as sa
from alembic import op

revision = "gw1a2b3c4d5e6"
down_revision = "gv1a2b3c4d5e6"
branch_labels = None
depends_on = None

_PER_SELLER = ("uq_resources_seller_data_hash", "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_resources_seller_data_hash ON resources (seller_id, data_hash)")
_LOOKUP = ("ix_resources_data_hash", "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_resources_data_hash ON resources (data_hash)")


def _drop_if_invalid(name: str) -> None:
    invalid = op.get_bind().execute(
        sa.text(
            "SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid "
            "WHERE c.relname = :name AND NOT i.indisvalid"
        ),
        {"name": name},
    ).first()
    if invalid:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, ddl in (_PER_SELLER, _LOOKUP):
            _drop_if_invalid(name)
            op.execute(ddl)
        op.execute("ALTER TABLE resources DROP CONSTRAINT IF EXISTS uq_resources_data_hash")


def downgrade() -> None:
    shared = op.get_bind().execute(sa.text(
        "SELECT count(*) FROM (SELECT data_hash FROM resources GROUP BY data_hash HAVING count(*) > 1) d"
    )).scalar_one()
    if shared:
        raise RuntimeError(
            f"{shared} resource digest(s) are held by more than one row (different shops); "
            "resolve them before restoring the marketplace-wide uq_resources_data_hash"
        )
    op.create_unique_constraint("uq_resources_data_hash", "resources", ["data_hash"])
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_resources_data_hash")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS uq_resources_seller_data_hash")
