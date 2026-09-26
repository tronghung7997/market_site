"""Private images: chat attachments, dispute evidence, payout receipts,
manual-credit proof

- chat_messages.attachments (a message may be images only, so the body check
  now allows an empty body when attachments exist);
- disputes.evidence_media and dispute_messages.attachments;
- withdraw_requests.receipt_media and transactions.proof_media;
- fee_runtime_config.dispute_evidence_image_required (admin switch: a buyer
  must attach at least one image to open a dispute);
- media_objects.taken_at (EXIF capture time, kept for evidence; GPS is not)
  and the new purpose ``adjustment_proof``.

Each image column holds media snapshots (``media.service.snapshot``).

Revision ID: gh1a2b3c4d5e6
Revises: gg1a2b3c4d5e6
Create Date: 2026-09-26
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "gh1a2b3c4d5e6"
down_revision = "gg1a2b3c4d5e6"
branch_labels = None
depends_on = None

OLD_PURPOSES = (
    "product_image", "category_image", "seller_logo", "seller_banner", "avatar",
    "chat_attachment", "dispute_evidence", "payout_receipt",
)
NEW_PURPOSES = (*OLD_PURPOSES, "adjustment_proof")


def _in(values: tuple[str, ...]) -> str:
    return f"purpose IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.drop_constraint("ck_media_objects_purpose", "media_objects", type_="check")
    op.create_check_constraint("ck_media_objects_purpose", "media_objects", _in(NEW_PURPOSES))
    op.add_column("media_objects", sa.Column("taken_at", sa.String(19), nullable=True))

    op.add_column("chat_messages", sa.Column("attachments", postgresql.JSONB(), nullable=True))
    op.drop_constraint("ck_chat_messages_body", "chat_messages", type_="check")
    op.create_check_constraint(
        "ck_chat_messages_body", "chat_messages",
        "length(body) <= 4000 AND (length(body) >= 1 OR attachments IS NOT NULL)",
    )

    op.add_column("disputes", sa.Column("evidence_media", postgresql.JSONB(), nullable=True))
    op.add_column("dispute_messages", sa.Column("attachments", postgresql.JSONB(), nullable=True))
    op.add_column("withdraw_requests", sa.Column("receipt_media", postgresql.JSONB(), nullable=True))
    op.add_column("transactions", sa.Column("proof_media", postgresql.JSONB(), nullable=True))
    op.add_column(
        "fee_runtime_config",
        sa.Column("dispute_evidence_image_required", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("fee_runtime_config", "dispute_evidence_image_required")
    op.drop_column("transactions", "proof_media")
    op.drop_column("withdraw_requests", "receipt_media")
    op.drop_column("dispute_messages", "attachments")
    op.drop_column("disputes", "evidence_media")
    op.drop_constraint("ck_chat_messages_body", "chat_messages", type_="check")
    op.execute("DELETE FROM chat_messages WHERE length(body) = 0")
    op.create_check_constraint("ck_chat_messages_body", "chat_messages", "length(body) BETWEEN 1 AND 4000")
    op.drop_column("chat_messages", "attachments")
    op.drop_column("media_objects", "taken_at")
    op.execute("DELETE FROM media_objects WHERE purpose = 'adjustment_proof'")
    op.drop_constraint("ck_media_objects_purpose", "media_objects", type_="check")
    op.create_check_constraint("ck_media_objects_purpose", "media_objects", _in(OLD_PURPOSES))
