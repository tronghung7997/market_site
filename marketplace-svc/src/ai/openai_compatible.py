"""One adapter for every vendor that speaks ``/chat/completions``.

This is what makes "switch AI later" a configuration change rather than a
development task. All of the following are reachable by editing base_url,
model and key in the admin console — no code, no deploy:

    OpenAI      https://api.openai.com/v1
    Gemini      https://generativelanguage.googleapis.com/v1beta/openai
    DeepSeek    https://api.deepseek.com/v1
    Groq        https://api.groq.com/openai/v1
    OpenRouter  https://openrouter.ai/api/v1
    Together    https://api.together.xyz/v1
    xAI         https://api.x.ai/v1
    Ollama      http://localhost:11434/v1        (self-hosted, no key)

Gemini's compatibility endpoint was verified to answer here, so this adapter
also serves as the escape hatch if the native one ever breaks.

Structured output uses ``response_format: json_object`` plus the schema
inlined into the system prompt: strict ``json_schema`` support is uneven
across these vendors, while "return JSON" is universal. The caller validates
the parsed result regardless, so the weaker upstream guarantee is contained.
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx
import structlog

from src.ai.port import AiError, AiProviderSettings, AiRequest, AiResult

logger = structlog.get_logger()

_TRANSIENT_STATUS = {408, 429, 500, 502, 503, 504}
_FATAL_STATUS = {400, 401, 403, 404}


class OpenAiCompatibleAdapter:
    """Implements ``AiTextPort`` against any OpenAI-shaped chat endpoint."""

    async def complete(self, request: AiRequest, settings: AiProviderSettings) -> AiResult:
        # Local runtimes (Ollama, vLLM) legitimately have no key, so an empty
        # key is only fatal for remote hosts.
        if not settings.api_key and not _is_local(settings.base_url):
            raise AiError("not_configured", "Chưa cấu hình API key cho nhà cung cấp AI")

        models = (settings.model, *settings.fallback_models)
        started = time.monotonic()
        last_error: AiError | None = None

        async with httpx.AsyncClient(timeout=settings.timeout_seconds) as client:
            for index, model in enumerate(models):
                body = self._build_body(request, settings, model)
                try:
                    payload = await self._call_with_retries(client, body, settings)
                except AiError as exc:
                    last_error = exc
                    logger.warning(
                        "ai_openai_compatible_model_failed",
                        model=model, kind=exc.kind, task=request.task,
                    )
                    continue

                text = self._extract_text(payload)
                if text is None:
                    last_error = AiError("invalid_output", f"{model} trả về phản hồi rỗng")
                    continue

                data = None
                if request.schema is not None:
                    try:
                        data = json.loads(_strip_code_fence(text))
                    except json.JSONDecodeError as exc:
                        last_error = AiError(
                            "invalid_output", f"{model} trả về JSON không hợp lệ: {exc}",
                        )
                        continue

                usage = payload.get("usage") or {}
                return AiResult(
                    text=text,
                    data=data,
                    model=payload.get("model") or model,
                    used_fallback=index > 0,
                    prompt_tokens=int(usage.get("prompt_tokens") or 0),
                    completion_tokens=int(usage.get("completion_tokens") or 0),
                    latency_ms=int((time.monotonic() - started) * 1000),
                )

        raise last_error or AiError("unavailable", "Không có mô hình nào phản hồi")

    def _build_body(
        self, request: AiRequest, settings: AiProviderSettings, model: str,
    ) -> dict[str, Any]:
        system = request.system_prompt
        if request.schema is not None:
            system = (
                f"{system}\n\n"
                "Trả lời DUY NHẤT bằng JSON hợp lệ khớp schema sau, không thêm chữ nào khác:\n"
                f"{json.dumps(request.schema, ensure_ascii=False)}"
            ).strip()

        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": request.user_prompt})

        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": request.temperature if request.temperature is not None else settings.temperature,
        }
        if request.max_output_tokens:
            body["max_tokens"] = request.max_output_tokens
        if request.schema is not None:
            body["response_format"] = {"type": "json_object"}
        return body

    async def _call_with_retries(
        self, client: httpx.AsyncClient, body: dict[str, Any], settings: AiProviderSettings,
    ) -> dict[str, Any]:
        url = f"{settings.base_url.rstrip('/')}/chat/completions"
        headers = {"Content-Type": "application/json"}
        if settings.api_key:
            headers["Authorization"] = f"Bearer {settings.api_key}"

        for attempt in range(settings.max_retries + 1):
            try:
                response = await client.post(url, json=body, headers=headers)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt >= settings.max_retries:
                    raise AiError("unavailable", str(exc)) from exc
                await asyncio.sleep(0.5 * (2 ** attempt))
                continue

            if response.status_code == 200:
                return response.json()

            detail = self._error_message(response)
            if response.status_code in _FATAL_STATUS:
                kind = "not_configured" if response.status_code in (401, 403) else "upstream_error"
                raise AiError(kind, detail, status_code=response.status_code)
            if response.status_code in _TRANSIENT_STATUS and attempt < settings.max_retries:
                await asyncio.sleep(0.5 * (2 ** attempt))
                continue
            raise AiError("unavailable", detail, status_code=response.status_code)

        raise AiError("unavailable", "hết lượt thử lại")

    @staticmethod
    def _error_message(response: httpx.Response) -> str:
        try:
            body = response.json()
        except ValueError:
            return response.text[:200]
        error = body.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or response.text[:200])
        return str(error or response.text[:200])

    @staticmethod
    def _extract_text(payload: dict[str, Any]) -> str | None:
        choices = payload.get("choices") or []
        if not choices:
            return None
        content = (choices[0].get("message") or {}).get("content")
        return content if isinstance(content, str) and content.strip() else None


def _is_local(base_url: str) -> bool:
    return any(host in base_url for host in ("localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"))


def _strip_code_fence(text: str) -> str:
    """Some models wrap JSON in ```json fences despite response_format."""
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    body = stripped.split("\n", 1)[1] if "\n" in stripped else ""
    return body.rsplit("```", 1)[0].strip()
