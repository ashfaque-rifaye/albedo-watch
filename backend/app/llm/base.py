"""Contract for an LLM provider in the multi-provider AI chain."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class LLMProvider(ABC):
    """A text-completion provider. Implementations must degrade to ``None`` on
    any failure (missing key, network error, rate limit) so the orchestrator can
    fall through to the next provider."""

    name: str = "provider"

    @abstractmethod
    def available(self) -> bool:
        """True when the provider is configured (has a usable key)."""

    @abstractmethod
    def complete(self, prompt: str, system: str | None = None, *, json_schema: Any = None) -> str | None:
        """Return completion text, or ``None`` on any failure. When ``json_schema``
        is provided the provider must request JSON-formatted output."""
