"""Provider-agnostic AI text generation.

Features call :func:`src.ai.service.run_task` with a task id from
``src.ai.tasks``; which vendor answers is admin configuration, not code.
"""

from src.ai.port import AiError, AiRequest, AiResult, AiTextPort
from src.ai.router import router as ai_router

__all__ = ["AiError", "AiRequest", "AiResult", "AiTextPort", "ai_router"]
