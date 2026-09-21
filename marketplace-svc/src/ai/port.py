"""The seam every AI feature talks to.

Callers depend on ``AiTextPort`` and never on a vendor. An adapter owns
transport, authentication, retries, fallback model selection and error
normalisation; it does not own prompts, business rules or persistence.

Contract
--------
``complete_json`` returns data already validated against ``schema`` — a caller
may assume the shape and must still apply its own domain rules (a model will
happily return a plausible-looking review that violates a content policy).

Failures are normalised to ``AiError`` with a coarse ``kind`` so callers can
choose a non-AI fallback path instead of interpreting vendor error bodies.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

AiErrorKind = Literal[
    "disabled",        # kill-switch off — caller should use its non-AI path
    "not_configured",  # no API key stored
    "unavailable",     # 503/429/timeout, every fallback exhausted
    "invalid_output",  # upstream answered but not in the required shape
    "budget_exceeded", # daily token ceiling hit
    "upstream_error",  # 4xx/5xx that retrying will not fix
]


class AiError(RuntimeError):
    """Normalised failure from any provider."""

    def __init__(self, kind: AiErrorKind, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.kind: AiErrorKind = kind
        self.status_code = status_code

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"[{self.kind}] {super().__str__()}"


@dataclass(slots=True)
class AiRequest:
    """One completion request, already rendered from a prompt template."""

    task: str
    system_prompt: str
    user_prompt: str
    # JSON Schema (subset) the answer must satisfy. None = free text.
    schema: dict[str, Any] | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None


@dataclass(slots=True)
class AiResult:
    """Answer plus the facts needed for spend attribution and diagnostics."""

    text: str
    data: Any = None
    model: str = ""
    used_fallback: bool = False
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class AiProviderSettings:
    """Resolved configuration handed to an adapter (secrets already decrypted).

    Adapters receive this instead of reading the database so they stay
    dependency-free and trivially testable.
    """

    provider_kind: str
    base_url: str
    model: str
    api_key: str
    fallback_models: tuple[str, ...] = ()
    temperature: float = 1.0
    timeout_seconds: int = 30
    max_retries: int = 2


class AiTextPort(Protocol):
    """Implemented by every adapter: Gemini native, OpenAI-compatible, mock."""

    async def complete(self, request: AiRequest, settings: AiProviderSettings) -> AiResult:
        """Run one completion.

        Raises ``AiError`` on any failure. Must try ``settings.model`` first,
        then each fallback in order, before giving up with kind="unavailable".
        """
        ...
