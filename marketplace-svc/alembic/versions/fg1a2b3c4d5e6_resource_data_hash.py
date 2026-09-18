"""resources.data_hash: marketplace-wide unique digest of delivered goods

Revision ID: fg1a2b3c4d5e6
Revises: ff1a2b3c4d5e6
Create Date: 2026-09-18

Backfills sha256 of the normalised content for every row, then resolves the
duplicates that already exist: the oldest row per digest keeps it, every later
copy gets a per-row salted digest (so the unique index can be created without
deleting sold history) and, when it is still unsold stock, is archived so it
can never be delivered. Counts land in log_entries as `resource_dedup_migration`.
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "fg1a2b3c4d5e6"
down_revision = "ff1a2b3c4d5e6"
branch_labels = None
depends_on = None

# Must match src/models/resource.py::normalize_resource_data.
NORMALISED = r"btrim(replace(replace(data, E'\r\n', E'\n'), E'\r', E'\n'), E' \t\r\n')"


def backfill_hashes(conn) -> None:  # noqa: ANN001
    conn.execute(sa.text(f"UPDATE resources SET data_hash = encode(sha256(convert_to({NORMALISED}, 'UTF8')), 'hex')"))


def resolve_duplicates(conn) -> tuple[list[int], list[int]]:  # noqa: ANN001
    """Re-key every row that shares a digest with an older one; archive the
    unsold copies. Returns (rekeyed_ids, archived_ids)."""
    dup_rows = conn.execute(sa.text(
        "SELECT id, status, order_id, is_archived FROM ("
        "  SELECT id, status, order_id, is_archived,"
        "         row_number() OVER (PARTITION BY data_hash ORDER BY created_at, id) AS rn"
        "  FROM resources"
        ") ranked WHERE rn > 1 ORDER BY id"
    )).all()
    if not dup_rows:
        return [], []
    ids = [r[0] for r in dup_rows]
    conn.execute(sa.text(
        "UPDATE resources SET"
        f"  data_hash = encode(sha256(convert_to('legacy-dup:' || id::text || E'\\n' || {NORMALISED}, 'UTF8')), 'hex'),"
        "  is_archived = CASE WHEN status = 'available' AND order_id IS NULL THEN true ELSE is_archived END"
        " WHERE id IN :ids"
    ).bindparams(sa.bindparam("ids", expanding=True)), {"ids": ids})
    archived = [r[0] for r in dup_rows if r[1] == "available" and r[2] is None and not r[3]]
    conn.execute(sa.text(
        "INSERT INTO log_entries (service, level, message, metadata, created_at)"
        " VALUES ('marketplace', 'warning', :message, CAST(:metadata AS json), now())"
    ), {
        "message": f"Resource dedup migration: {len(ids)} duplicate rows re-keyed, {len(archived)} unsold copies archived",
        "metadata": json.dumps({
            "event": "resource_dedup_migration",
            "rekeyed_ids": ids[:500], "rekeyed_count": len(ids),
            "archived_ids": archived[:500], "archived_count": len(archived),
        }),
    })
    return ids, archived


def upgrade() -> None:
    op.add_column("resources", sa.Column("data_hash", sa.String(length=64), nullable=True))
    conn = op.get_bind()
    backfill_hashes(conn)
    resolve_duplicates(conn)
    op.alter_column("resources", "data_hash", nullable=False)
    op.create_unique_constraint("uq_resources_data_hash", "resources", ["data_hash"])


def downgrade() -> None:
    op.drop_constraint("uq_resources_data_hash", "resources", type_="unique")
    op.drop_column("resources", "data_hash")
