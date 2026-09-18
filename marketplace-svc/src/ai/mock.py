"""Deterministic adapter for tests — never touches the network.

Selected by ``registry`` when ``settings.deployment_environment == "test"``,
so the suite exercises the real service/router path without an API key and
without flaking on upstream 503s.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from src.ai.port import AiError, AiProviderSettings, AiRequest, AiResult

# Deliberately uneven in length and tone: tests assert the pipeline preserves
# variety and that the keyword filter rejects the planted violation below.
_COMMENTS = [
    "acc dung ngon, log phat vao luon khong bi gi",
    "Giao hàng nhanh, thông tin đầy đủ đúng như mô tả. Sẽ mua tiếp.",
    "ok",
    "dung tam on nhung lúc đầu vào bị hỏi xác minh, làm theo hướng dẫn thì qua",
    "hàng chuẩn, đúng năm như quảng cáo",
]
_REPLIES = [None, "Cảm ơn bạn đã ủng hộ.", None, "Shop xin lỗi vì bất tiện ạ.", None]


class MockAiAdapter:
    """Implements ``AiTextPort`` with stable, offline output."""

    # Set by tests that need to assert the failure paths.
    fail_with: AiError | None = None

    async def complete(self, request: AiRequest, settings: AiProviderSettings) -> AiResult:
        if self.fail_with is not None:
            raise self.fail_with

        if request.schema is None:
            return AiResult(text=f"mock:{request.task}", model="mock", latency_ms=1)

        # Seed from the prompt so the same request yields the same draft —
        # snapshot-friendly, still different across products.
        digest = hashlib.sha256(request.user_prompt.encode()).digest()
        count = _requested_count(request.user_prompt)

        items: list[dict[str, Any]] = []
        for i in range(count):
            pick = digest[i % len(digest)] % len(_COMMENTS)
            items.append({
                "rating": 5 if i % 5 != 3 else 4,
                "comment": _COMMENTS[pick],
                "seller_reply": _REPLIES[pick],
            })

        text = json.dumps(items, ensure_ascii=False)
        return AiResult(
            text=text,
            data=items,
            model="mock",
            prompt_tokens=len(request.user_prompt) // 4,
            completion_tokens=len(text) // 4,
            latency_ms=1,
        )


def _requested_count(prompt: str) -> int:
    """Best-effort read of "Viết N đánh giá" so mock output matches the ask."""
    import re

    match = re.search(r"(\d+)", prompt)
    if not match:
        return len(_COMMENTS)
    return max(1, min(int(match.group(1)), 50))
