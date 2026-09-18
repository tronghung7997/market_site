"""Google Generative Language adapter (native ``:generateContent``).

Chosen as the default for structured output: the native API accepts a
``responseSchema`` with ``nullable`` fields and honours it strictly, which the
OpenAI compatibility layer flattens.

Two behaviours here are not defensive padding but observed upstream facts:

* Flash models return **503 UNAVAILABLE** under load regularly (measured on
  ``gemini-flash-latest`` and ``gemini-3.6-flash`` during integration testing,
  while ``gemini-flash-lite-latest`` answered in ~3s).
* Google **retires model ids without notice** — ``gemini-2.5-flash`` already
  answers 404 "no longer available to new users" for recently issued keys.

So a failure on the configured model is routine, and the adapter walks the
admin-configured fallback list before reporting ``unavailable``.
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

# Retry the same model on these, then move to the next fallback.
_TRANSIENT_STATUS = {408, 429, 500, 502, 503, 504}
# No point retrying: wrong key, retired model, malformed request.
_FATAL_STATUS = {400, 401, 403, 404}


def _to_gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """JSON Schema (subset) -> Gemini's uppercase type spelling.

    Gemini wants ``{"type": "ARRAY"}``; callers write standard lowercase JSON
    Schema so the same dict can be reused by the OpenAI-compatible adapter.
    """
    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key == "type" and isinstance(value, str):
            out["type"] = value.upper()
        elif key == "properties" and isinstance(value, dict):
            out["properties"] = {k: _to_gemini_schema(v) for k, v in value.items()}
        elif key == "items" and isinstance(value, dict):
            out["items"] = _to_gemini_schema(value)
        else:
            out[key] = value
    return out


class GeminiAdapter:
    """Implements ``AiTextPort`` against the native Gemini REST API."""

    async def complete(self, request: AiRequest, settings: AiProviderSettings) -> AiResult:
        if not settings.api_key:
            raise AiError("not_configured", "Chưa cấu hình API key cho nhà cung cấp AI")

        models = (settings.model, *settings.fallback_models)
        body = self._build_body(request, settings)
        started = time.monotonic()
        last_error: AiError | None = None

        async with httpx.AsyncClient(timeout=settings.timeout_seconds) as client:
            for index, model in enumerate(models):
                try:
                    payload = await self._call_with_retries(client, model, body, settings)
                except AiError as exc:
                    last_error = exc
                    # A fatal error on the *primary* model is worth surfacing
                    # verbatim (bad key, retired id); still try the fallbacks,
                    # because a retired primary is exactly what they are for.
                    logger.warning(
                        "ai_gemini_model_failed", model=model, kind=exc.kind, task=request.task,
                    )
                    continue

                text = self._extract_text(payload)
                if text is None:
                    last_error = AiError("invalid_output", f"{model} trả về phản hồi rỗng")
                    continue

                data = None
                if request.schema is not None:
                    try:
                        data = json.loads(text)
                    except json.JSONDecodeError as exc:
                        last_error = AiError(
                            "invalid_output", f"{model} trả về JSON không hợp lệ: {exc}",
                        )
                        continue

                usage = payload.get("usageMetadata") or {}
                return AiResult(
                    text=text,
                    data=data,
                    model=payload.get("modelVersion") or model,
                    used_fallback=index > 0,
                    prompt_tokens=int(usage.get("promptTokenCount") or 0),
                    completion_tokens=int(usage.get("candidatesTokenCount") or 0),
                    latency_ms=int((time.monotonic() - started) * 1000),
                )

        raise last_error or AiError("unavailable", "Không có mô hình nào phản hồi")

    def _build_body(self, request: AiRequest, settings: AiProviderSettings) -> dict[str, Any]:
        generation: dict[str, Any] = {
            "temperature": request.temperature if request.temperature is not None else settings.temperature,
        }
        if request.max_output_tokens:
            generation["maxOutputTokens"] = request.max_output_tokens
        if request.schema is not None:
            generation["responseMimeType"] = "application/json"
            generation["responseSchema"] = _to_gemini_schema(request.schema)

        body: dict[str, Any] = {
            "contents": [{"parts": [{"text": request.user_prompt}]}],
            "generationConfig": generation,
        }
        if request.system_prompt:
            body["systemInstruction"] = {"parts": [{"text": request.system_prompt}]}
        return body

    async def _call_with_retries(
        self,
        client: httpx.AsyncClient,
        model: str,
        body: dict[str, Any],
        settings: AiProviderSettings,
    ) -> dict[str, Any]:
        url = f"{settings.base_url.rstrip('/')}/models/{model}:generateContent"
        headers = {"Content-Type": "application/json", "X-goog-api-key": settings.api_key}

        for attempt in range(settings.max_retries + 1):
            try:
                response = await client.post(url, json=body, headers=headers)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt >= settings.max_retries:
                    raise AiError("unavailable", f"{model}: {exc}") from exc
                await asyncio.sleep(0.5 * (2 ** attempt))
                continue

            if response.status_code == 200:
                return response.json()

            detail = self._error_message(response)
            if response.status_code in _FATAL_STATUS:
                kind = "not_configured" if response.status_code in (401, 403) else "upstream_error"
                raise AiError(kind, f"{model}: {detail}", status_code=response.status_code)
            if response.status_code in _TRANSIENT_STATUS and attempt < settings.max_retries:
                await asyncio.sleep(0.5 * (2 ** attempt))
                continue
            raise AiError("unavailable", f"{model}: {detail}", status_code=response.status_code)

        raise AiError("unavailable", f"{model}: hết lượt thử lại")

    @staticmethod
    def _error_message(response: httpx.Response) -> str:
        try:
            return str((response.json().get("error") or {}).get("message") or response.text[:200])
        except (ValueError, AttributeError):
            return response.text[:200]

    @staticmethod
    def _extract_text(payload: dict[str, Any]) -> str | None:
        candidates = payload.get("candidates") or []
        if not candidates:
            return None
        parts = ((candidates[0].get("content") or {}).get("parts")) or []
        # Skip thought/signature-only parts that carry no user-visible text.
        texts = [p["text"] for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str)]
        return "".join(texts) or None
