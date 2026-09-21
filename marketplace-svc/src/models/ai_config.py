"""Admin-tunable AI text provider + per-task prompt copy.

Two tables, deliberately shaped like the mail module's split:

``ai_provider_config``
    Singleton (id=1) holding *which* model answers and how it is reached.
    Provider choice lives in the database rather than env because the whole
    point of the seam is that an admin can move from Gemini to OpenAI,
    DeepSeek, OpenRouter or a local Ollama without a redeploy — they all speak
    the same OpenAI-compatible protocol, so only base_url/model/key change.
    The API key is encrypted at rest with the shared ``ENCRYPTION_KEY`` and is
    never returned by the admin API (only a ``configured`` boolean), exactly
    like ``RESEND_API_KEY`` in the mail config.

``ai_prompt_templates``
    One row per (task, locale). Admin may edit the copy; task ids are seeded
    from the code catalog and cannot be invented from the UI, mirroring
    ``mail_templates``. This is what makes the module reusable: a new AI
    feature adds a task id, not a new integration.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class AiProviderConfig(Base):
    __tablename__ = "ai_provider_config"

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # "openai_compatible" covers Gemini (via its /v1beta/openai endpoint),
    # OpenAI, DeepSeek, Groq, OpenRouter, Together, xAI and Ollama.
    # "gemini_native" is kept for Gemini-only features (responseSchema with
    # nullable fields, thinking budget) that the compatibility layer flattens.
    provider_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="gemini_native")
    base_url: Mapped[str] = mapped_column(String(255), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)

    # Tried in order when the primary model returns 503/429. Google overloads
    # flash models regularly and retires model ids without notice (2.5-flash
    # already 404s for new keys), so both the model and its fallbacks must be
    # admin-editable data, never constants in code.
    fallback_models: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    temperature: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=2)

    # Cheap circuit breaker against a runaway loop burning the quota. Counted
    # over a UTC day in ai_usage_log; 0 disables the ceiling.
    daily_token_budget: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Kill-switch: when false every call raises AI_DISABLED and callers fall
    # back to their non-AI path instead of failing the request.
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class AiPromptTemplate(Base):
    __tablename__ = "ai_prompt_templates"

    # Task id from src/ai/tasks.py (e.g. "trust_seed.reviews"). Seeded by
    # migration; the admin API rejects unknown ids.
    task: Mapped[str] = mapped_column(String(100), primary_key=True)
    locale: Mapped[str] = mapped_column(String(8), primary_key=True)

    # Role/voice/hard constraints — stable across calls.
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # Instruction body; `{placeholders}` are filled from the caller's context.
    user_prompt: Mapped[str] = mapped_column(Text, nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class AiUsageLog(Base):
    """One row per upstream call — spend attribution and the daily budget check.

    Never stores the generated text: drafts live in the calling feature's own
    tables once an admin accepts them.
    """

    __tablename__ = "ai_usage_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    task: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    provider_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    # True when the primary model failed and a fallback answered — a spike here
    # means the configured default should change.
    used_fallback: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    error_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True,
    )
