"""resources: data_head / data_length / field_count beside the encrypted line

Revision ID: gv1a2b3c4d5e6
Revises: gu1a2b3c4d5e6
Create Date: 2026-09-28

A stock line can be 200 KB (cookie exports), and lists, previews and the
restock field-count hint decrypted every line in full to show 240 characters
or count `|`. The model now derives, on every write:

- `data_head`: the first 240 characters, Fernet-encrypted like `data` (it can
  hold a password);
- `data_length`: length in characters;
- `field_count`: number of `|`-separated fields.

This backfills existing rows in batches, idempotently (only rows whose
`data_length` is still NULL). Counts land in log_entries as
`resource_line_head_migration`.
"""
import json

from alembic import op
import sqlalchemy as sa
from cryptography.fernet import InvalidToken

from src.security.crypto import FERNET_PREFIX, decrypt_str, encrypt_str

revision = "gv1a2b3c4d5e6"
down_revision = "gu1a2b3c4d5e6"
branch_labels = None
depends_on = None

# Rows hold up to 200 KB each: keep a batch's plaintext small.
BATCH = 200
# Pinned: must match src/models/resource.py LINE_HEAD_CHARS.
HEAD_CHARS = 240


def _plain(value: str) -> str:
    if not value.startswith(FERNET_PREFIX):
        return value
    try:
        return decrypt_str(value)
    except InvalidToken:
        return value


def backfill(conn) -> int:  # noqa: ANN001
    done = 0
    cursor = 0
    while True:
        rows = conn.execute(
            sa.text(
                "SELECT id, data FROM resources WHERE id > :cursor AND data_length IS NULL"
                " ORDER BY id LIMIT :limit"
            ),
            {"cursor": cursor, "limit": BATCH},
        ).all()
        if not rows:
            break
        updates = []
        for row_id, stored in rows:
            data = _plain(stored)
            updates.append({
                "id": row_id,
                "head": encrypt_str(data[:HEAD_CHARS]),
                "length": len(data),
                "fields": data.count("|") + 1,
            })
        conn.execute(
            sa.text("UPDATE resources SET data_head = :head, data_length = :length, field_count = :fields WHERE id = :id"),
            updates,
        )
        done += len(updates)
        cursor = rows[-1][0]
    return done


def upgrade() -> None:
    op.add_column("resources", sa.Column("data_head", sa.Text(), nullable=True))
    op.add_column("resources", sa.Column("data_length", sa.Integer(), nullable=True))
    op.add_column("resources", sa.Column("field_count", sa.Integer(), nullable=True))
    conn = op.get_bind()
    done = backfill(conn)
    conn.execute(sa.text(
        "INSERT INTO log_entries (service, level, message, metadata, created_at)"
        " VALUES ('marketplace', 'info', :message, CAST(:metadata AS json), now())"
    ), {
        "message": f"Resource line head migration: {done} rows summarised",
        "metadata": json.dumps({"event": "resource_line_head_migration", "rows": done}),
    })


def downgrade() -> None:
    op.drop_column("resources", "field_count")
    op.drop_column("resources", "data_length")
    op.drop_column("resources", "data_head")
