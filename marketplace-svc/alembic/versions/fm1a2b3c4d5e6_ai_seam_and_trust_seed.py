"""Reusable AI text seam + admin trust-seed (demo reviews)

Revision ID: fm1a2b3c4d5e6
Revises: fl1a2b3c4d5e6
Create Date: 2026-09-19 (re-keyed 2026-09-21 on merge: the original id
``eb1a2b3c4d5e6`` was already taken by main's merge revision)

Three concerns land together because they are one feature:

1. ``is_seeded`` on accounts/orders/reviews. Seeded liquidity must be
   *structurally* separable from real trade, not separated by convention:
   reporting filters on the column, so demo volume cannot reach GMV, seller
   tiering, dispute rate, commission or wallet reconciliation.
2. ``ai_provider_config`` / ``ai_prompt_templates`` / ``ai_usage_log`` — the
   provider-agnostic text seam. Model ids live in data because Google both
   overloads (503) and retires (404) them without notice.
3. ``trust_seed_batches`` — the unit of reversal for generated reviews.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "fm1a2b3c4d5e6"
down_revision = "fl1a2b3c4d5e6"
branch_labels = None
depends_on = None


# Seeded from the code catalog (src/ai/tasks.py). Admin may edit the copy but
# not invent task ids, mirroring mail_templates.
_TRUST_SEED_SYSTEM_VI = (
    "Bạn viết đánh giá của người mua thật trên một sàn thương mại điện tử Việt Nam "
    "chuyên tài nguyên MMO. Giọng đời thường, ngắn, viết hoa tuỳ tiện, đôi khi thiếu dấu "
    "hoặc viết tắt như người dùng điện thoại.\n"
    "TUYỆT ĐỐI KHÔNG: ngôn ngữ quảng cáo, emoji, nhắc tên shop, zalo/telegram/facebook, "
    "số điện thoại, đường link, hay bất kỳ thông tin liên hệ nào.\n"
    "Mỗi đánh giá phải khác nhau rõ rệt về giọng điệu, độ dài và góc nhìn. "
    "Đánh giá 3-4 sao BẮT BUỘC nêu một nhược điểm cụ thể, có thật, hợp lý với sản phẩm. "
    "Chỉ nói về những gì người mua thực sự trải nghiệm được."
)
_TRUST_SEED_USER_VI = (
    "Thông tin sản phẩm:\n{product_context}\n\n"
    "Viết {count} đánh giá với phân bố sao: {distribution}.\n"
    "{extra_instructions}"
)
_TRUST_SEED_SYSTEM_EN = (
    "You write reviews as real buyers on a Vietnamese marketplace for online "
    "business resources. Casual tone, short, inconsistent capitalisation, "
    "occasional typos like someone typing on a phone.\n"
    "NEVER: marketing language, emoji, shop names, zalo/telegram/facebook, "
    "phone numbers, links, or any contact details.\n"
    "Each review must differ clearly in tone, length and angle. A 3-4 star "
    "review MUST name one specific, plausible drawback. Only mention things a "
    "buyer could actually experience."
)
_TRUST_SEED_USER_EN = (
    "Product information:\n{product_context}\n\n"
    "Write {count} reviews with this star distribution: {distribution}.\n"
    "{extra_instructions}"
)


def upgrade() -> None:
    # ── 1. Seeded-data flags ────────────────────────────────────────────────
    op.add_column("accounts", sa.Column(
        "is_seeded", sa.Boolean(), nullable=False, server_default=sa.text("false"),
    ))
    op.add_column("orders", sa.Column(
        "is_seeded", sa.Boolean(), nullable=False, server_default=sa.text("false"),
    ))
    op.add_column("reviews", sa.Column(
        "is_seeded", sa.Boolean(), nullable=False, server_default=sa.text("false"),
    ))

    # Partial indexes: seeded rows are the rare case, and every hot financial
    # query filters `is_seeded = false`, so index only the small seeded side
    # for the admin/purge paths and let the planner ignore it elsewhere.
    op.create_index(
        "ix_accounts_seeded", "accounts", ["id"],
        postgresql_where=sa.text("is_seeded"),
    )
    op.create_index(
        "ix_orders_seeded", "orders", ["product_id"],
        postgresql_where=sa.text("is_seeded"),
    )

    # ── 2. AI seam ──────────────────────────────────────────────────────────
    op.create_table(
        "ai_provider_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider_kind", sa.String(32), nullable=False, server_default="gemini_native"),
        sa.Column("base_url", sa.String(255), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("fallback_models", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("daily_token_budget", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.CheckConstraint("id = 1", name="ck_ai_provider_config_singleton"),
        sa.CheckConstraint(
            "provider_kind IN ('openai_compatible', 'gemini_native')",
            name="ck_ai_provider_config_kind",
        ),
        sa.CheckConstraint(
            "temperature >= 0 AND temperature <= 2", name="ck_ai_provider_config_temperature",
        ),
        sa.CheckConstraint("timeout_seconds BETWEEN 1 AND 120", name="ck_ai_provider_config_timeout"),
        sa.CheckConstraint("max_retries BETWEEN 0 AND 5", name="ck_ai_provider_config_retries"),
        sa.CheckConstraint("daily_token_budget >= 0", name="ck_ai_provider_config_budget"),
    )

    # Ship disabled with the verified Gemini defaults pre-filled. An admin
    # pastes a key and flips is_enabled; nothing calls out before that.
    # gemini-flash-lite-latest was the fastest model that stayed available and
    # kept Vietnamese diacritics during integration testing; the two fallbacks
    # cover its 503 spikes.
    op.execute(
        """
        INSERT INTO ai_provider_config
            (id, provider_kind, base_url, model, fallback_models, temperature,
             timeout_seconds, max_retries, daily_token_budget, is_enabled)
        VALUES
            (1, 'gemini_native',
             'https://generativelanguage.googleapis.com/v1beta',
             'gemini-flash-lite-latest',
             '["gemini-3.1-flash-lite", "gemini-3-flash-preview"]'::jsonb,
             1.15, 30, 2, 0, false)
        ON CONFLICT (id) DO NOTHING
        """
    )

    op.create_table(
        "ai_prompt_templates",
        sa.Column("task", sa.String(100), primary_key=True),
        sa.Column("locale", sa.String(8), primary_key=True),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("user_prompt", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )

    templates = sa.table(
        "ai_prompt_templates",
        sa.column("task", sa.String),
        sa.column("locale", sa.String),
        sa.column("system_prompt", sa.Text),
        sa.column("user_prompt", sa.Text),
    )
    op.bulk_insert(templates, [
        {
            "task": "trust_seed.reviews", "locale": "vi",
            "system_prompt": _TRUST_SEED_SYSTEM_VI, "user_prompt": _TRUST_SEED_USER_VI,
        },
        {
            "task": "trust_seed.reviews", "locale": "en",
            "system_prompt": _TRUST_SEED_SYSTEM_EN, "user_prompt": _TRUST_SEED_USER_EN,
        },
    ])

    op.create_table(
        "ai_usage_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task", sa.String(100), nullable=False, index=True),
        sa.Column("provider_kind", sa.String(32), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("used_fallback", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("error_kind", sa.String(64), nullable=True),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )

    # ── 3. Trust-seed batches ───────────────────────────────────────────────
    op.create_table(
        "trust_seed_batches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False, index=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="applied"),
        sa.Column("review_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(16), nullable=False, server_default="ai"),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("locale", sa.String(8), nullable=False, server_default="vi"),
        sa.Column("prompt_snapshot", sa.Text(), nullable=True),
        sa.Column("options_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("purged_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("purged_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('applied', 'purged')", name="ck_trust_seed_batches_status"),
        sa.CheckConstraint("source IN ('ai', 'manual')", name="ck_trust_seed_batches_source"),
        sa.CheckConstraint("review_count >= 0", name="ck_trust_seed_batches_count"),
    )

    op.add_column("reviews", sa.Column("trust_seed_batch_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_reviews_trust_seed_batch", "reviews", "trust_seed_batches",
        ["trust_seed_batch_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_reviews_trust_seed_batch_id", "reviews", ["trust_seed_batch_id"])


def downgrade() -> None:
    op.drop_index("ix_reviews_trust_seed_batch_id", table_name="reviews")
    op.drop_constraint("fk_reviews_trust_seed_batch", "reviews", type_="foreignkey")
    op.drop_column("reviews", "trust_seed_batch_id")
    op.drop_table("trust_seed_batches")
    op.drop_table("ai_usage_log")
    op.drop_table("ai_prompt_templates")
    op.drop_table("ai_provider_config")
    op.drop_index("ix_orders_seeded", table_name="orders")
    op.drop_index("ix_accounts_seeded", table_name="accounts")
    op.drop_column("reviews", "is_seeded")
    op.drop_column("orders", "is_seeded")
    op.drop_column("accounts", "is_seeded")
