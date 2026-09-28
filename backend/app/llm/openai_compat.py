"""OpenAI-compatible chat-completions provider (Groq, Cerebras) over httpx.

Both Groq and Cerebras expose the OpenAI ``/chat/completions`` shape, so one
implementation serves both. It accepts multiple API keys and rotates to the next
on a rate-limit/auth response, then returns None so the orchestrator can fall
through to the next provider. These are internal fallbacks — never named in the UI.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import settings
from .base import LLMProvider

log = logging.getLogger("albedo.llm")

_TIMEOUT = 30.0
_ROTATE_STATUSES = (401, 403, 429)  # try the next key on these


class OpenAICompatProvider(LLMProvider):
    def __init__(self, name: str, base_url: str, api_keys: list[str], model: str):
        self.name = name
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._keys = [k for k in api_keys if k]
        self._model = model

    def available(self) -> bool:
        return bool(self._keys and self._model)

    def complete(self, prompt: str, system: str | None = None, *, json_schema: Any = None) -> str | None:
        if not self.available():
            return None
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        body: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "temperature": settings.gemini_temperature,
            "max_tokens": settings.gemini_max_output_tokens,
        }
        if json_schema is not None:
            body["response_format"] = {"type": "json_object"}  # prompt already asks for JSON

        for key in self._keys:
            try:
                r = httpx.post(
                    self._url,
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json=body,
                    timeout=_TIMEOUT,
                )
            except Exception as exc:
                log.warning("%s request error (%s)", self.name, type(exc).__name__)
                continue
            if r.status_code == 200:
                try:
                    text = r.json()["choices"][0]["message"]["content"]
                    return (text or "").strip() or None
                except Exception:
                    log.warning("%s returned an unexpected body", self.name)
                    return None
            if r.status_code in _ROTATE_STATUSES:
                log.info("%s key unavailable (HTTP %s) — trying next key", self.name, r.status_code)
                continue
            log.warning("%s HTTP %s", self.name, r.status_code)
            return None
        return None
