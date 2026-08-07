"""signed API credentials for request signing auth

Adds public key_id + encrypted signing_secret for HMAC request signing.
Legacy key_hash/key_prefix columns remain for the migration period so
X-Seller-Api-Key clients keep working until LEGACY_SELLER_API_KEY_MODE=deny.

Revision ID: cl1a2b3c4d5e6
Revises: ck1a2b3c4d5e6
Create Date: 2026-08-07
"""

from alembic import op
import sqlalchemy as sa

revision = "cl1a2b3c4d5e6"
down_revision = "ck1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("seller_api_keys", sa.Column("key_id", sa.String(64), nullable=True))
    op.add_column(
        "seller_api_keys",
        sa.Column("signing_secret_encrypted", sa.Text(), nullable=True),
    )
    op.add_column(
        "seller_api_keys",
        sa.Column(
            "signing_version",
            sa.String(8),
            nullable=False,
            server_default="v1",
        ),
    )
    # New signed-only credentials have no legacy key_hash.
    op.alter_column(
        "seller_api_keys",
        "key_hash",
        existing_type=sa.String(64),
        nullable=True,
    )
    op.create_index(
        "ix_seller_api_keys_key_id",
        "seller_api_keys",
        ["key_id"],
        unique=True,
    )


def downgrade() -> None:
    # Signed-only rows have key_hash IS NULL. Silently deleting them would
    # destroy live credentials. Fail loudly so an operator must revoke or
    # migrate those keys before rolling back the schema.
    conn = op.get_bind()
    count = conn.execute(
        sa.text("SELECT COUNT(*) FROM seller_api_keys WHERE key_hash IS NULL")
    ).scalar()
    if count:
        raise RuntimeError(
            f"Cannot downgrade cl1a2b3c4d5e6: {count} signed-only seller_api_keys "
            "row(s) have key_hash IS NULL. Revoke or remove those credentials "
            "explicitly before downgrade — refusing to DELETE them silently."
        )

    op.drop_index("ix_seller_api_keys_key_id", table_name="seller_api_keys")
    op.drop_column("seller_api_keys", "signing_version")
    op.drop_column("seller_api_keys", "signing_secret_encrypted")
    op.drop_column("seller_api_keys", "key_id")
    op.alter_column(
        "seller_api_keys",
        "key_hash",
        existing_type=sa.String(64),
        nullable=False,
    )
