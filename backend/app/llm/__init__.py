"""Multi-provider AI orchestrator.

Gemini 3.7 Flash is primary for everything; text-only calls fall through to
internal OpenAI-compatible providers if Gemini errors or rate-limits.
Multimodal (photo/voice) and TTS are Gemini-only by design.
An LRU cache keyed on the prompt keeps free-tier usage low.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from collections import OrderedDict
from typing import Any

from ..config import settings
from .base import LLMProvider
from .gemini_provider import GeminiProvider
from .openai_compat import OpenAICompatProvider

log = logging.getLogger("albedo.llm")

_GROQ_URL = "https://api.groq.com/openai/v1"
_CEREBRAS_URL = "https://api.cerebras.ai/v1"

GEMINI = GeminiProvider()
GEMINI_FAST = GeminiProvider(settings.gemini_fast_model)
GEMINI_BACKUPS = [GeminiProvider(m.strip()) for m in settings.gemini_backup_models.split(",") if m.strip()]


def _build_providers() -> list[LLMProvider]:
    providers: list[LLMProvider] = [GEMINI, *GEMINI_BACKUPS]
    groq_keys = [settings.groq_api_key, settings.groq_api_key2]
    if any(groq_keys):
        providers.append(OpenAICompatProvider("groq", _GROQ_URL, groq_keys, settings.groq_model))
    if settings.cerebras_api_key:
        providers.append(OpenAICompatProvider("cerebras", _CEREBRAS_URL, [settings.cerebras_api_key], settings.cerebras_model))
    return providers


PROVIDERS: list[LLMProvider] = _build_providers()

_tls = threading.local()


def _label(provider) -> str:
    m = getattr(provider, "model", None)
    if not m:
        return "Albedo fallback model"
    return m.replace("gemini-", "Gemini ").replace("-flash", " Flash").replace("-lite", " Lite").replace("-", " ")


def served_label() -> str | None:
    """Which model actually answered the last call on this thread."""
    return getattr(_tls, "model", None)


_cache: "OrderedDict[str, str]" = OrderedDict()
_cache_lock = threading.Lock()


def _key(*parts: Any) -> str:
    return hashlib.sha256("\x1f".join(repr(p) for p in parts).encode("utf-8")).hexdigest()


def _get(key: str) -> str | None:
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    return None


def _put(key: str, value: str) -> None:
    cap = max(0, settings.gemini_cache_size)
    if not cap:
        return
    with _cache_lock:
        _cache[key] = value
        _cache.move_to_end(key)
        while len(_cache) > cap:
            _cache.popitem(last=False)


def cache_clear() -> None:
    with _cache_lock:
        _cache.clear()


def available() -> bool:
    return any(p.available() for p in PROVIDERS)


def model_label() -> str:
    """Human label for the primary model — shown in the UI's AI trace."""
    m = settings.gemini_model.replace("gemini-", "Gemini ").replace("-flash", " Flash")
    return m.replace("-", " ")


def _parse_json(text: str) -> Any | None:
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        pass
    m = re.search(r"\{.*\}|\[.*\]", text or "", re.S)  # fenced / chatty fallbacks
    if m:
        try:
            return json.loads(m.group(0))
        except (ValueError, TypeError):
            return None
    return None


def generate(prompt: str, system: str | None = None, *, fast: bool = False) -> str | None:
    key = _key("text", fast, system, prompt)
    if (hit := _get(key)) is not None:
        return hit
    chain = ([GEMINI_FAST] if fast else []) + PROVIDERS
    for provider in chain:
        if not provider.available():
            continue
        try:
            out = provider.complete(prompt, system)
        except Exception:
            out = None
        if out:
            _tls.model = _label(provider)
            _put(key, out)
            return out
    return None


def generate_json(prompt: str, schema: Any, system: str | None = None, *, fast: bool = False) -> Any | None:
    key = _key("json", fast, system, prompt, schema)
    if (hit := _get(key)) is not None:
        return _parse_json(hit)
    chain = ([GEMINI_FAST] if fast else []) + PROVIDERS
    for provider in chain:
        if not provider.available():
            continue
        try:
            text = provider.complete(prompt, system, json_schema=schema)
        except Exception:
            text = None
        parsed = _parse_json(text) if text else None
        if parsed is not None:
            _tls.model = _label(provider)
            _put(key, text)
            return parsed
    return None


def multimodal_json(prompt: str, media: list[tuple[bytes, str]], schema: Any, system: str | None = None) -> Any | None:
    """Photo / voice understanding. Gemini only — no cache (inputs are unique)."""
    for provider in (GEMINI, *GEMINI_BACKUPS, GEMINI_FAST):
        text = provider.complete(prompt, system, json_schema=schema, media=media)
        parsed = _parse_json(text) if text else None
        if parsed is not None:
            _tls.model = _label(provider)
            return parsed
    return None


_tts_cache: "OrderedDict[str, tuple[bytes, str]]" = OrderedDict()


def speak(text: str, voice: str = "Kore") -> tuple[bytes, str] | None:
    k = _key("tts", voice, text)
    with _cache_lock:
        if k in _tts_cache:
            return _tts_cache[k]
    out = GEMINI.speak(text, voice)
    if out:
        with _cache_lock:
            _tts_cache[k] = out
            while len(_tts_cache) > 32:
                _tts_cache.popitem(last=False)
    return out


__all__ = ["available", "generate", "generate_json", "multimodal_json", "speak", "cache_clear", "model_label"]
