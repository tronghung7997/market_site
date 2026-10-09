"""merge heads: backlog 2026-10-07 workstreams ka–kf

ka ops-settings (hold hours, dispute window), kb affiliate KOL, kc seller &
buyer tiers, kd SEO pack, ke ops Telegram bot, kf config approval. The six
branches touch disjoint columns and constraints (ka renames
seller_tier_config.escrow_reduction_days, kc swaps its fee_discount_pp for
fee_percent; only kd rewrites ck_media_objects_purpose; enum values are added
with IF NOT EXISTS), so the merge needs no schema change.

Revision ID: kg1a2b3c4d5e6
Revises: ka1a2b3c4d5e6, kb1a2b3c4d5e6, kc1a2b3c4d5e6, kd1a2b3c4d5e6, ke1a2b3c4d5e6, kf1a2b3c4d5e6
Create Date: 2026-10-08
"""

revision = "kg1a2b3c4d5e6"
down_revision = (
    "ka1a2b3c4d5e6", "kb1a2b3c4d5e6", "kc1a2b3c4d5e6", "kd1a2b3c4d5e6", "ke1a2b3c4d5e6", "kf1a2b3c4d5e6",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
