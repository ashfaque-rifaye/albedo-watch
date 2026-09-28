"""Google Gemini provider (AI Studio key).

Text, schema-constrained JSON, multimodal (image + audio parts) and TTS.
Every failure returns None so the orchestrator can fall through.
"""
from __future__ import annotations

import base64
import logging
from typing import Any

from ..config import settings
from .base import LLMProvider

log = logging.getLogger("albedo.llm.gemini")

_TIMEOUT_MS = 22_000
_SAFETY_CATEGORIES = (
    "HARM_CATEGORY_HARASSMENT",
    "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    "HARM_CATEGORY_DANGEROUS_CONTENT",
)


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self, model: str | None = None) -> None:
        self._model = model
        self._client = None
        self._tried = False
        self._safety: list | None = None

    @property
    def model(self) -> str:
        return self._model or settings.gemini_model

    def available(self) -> bool:
        return bool(settings.gemini_api_key)

    def _get_client(self):
        if self._tried:
            return self._client
        self._tried = True
        if not settings.gemini_api_key:
            return None
        try:
            from google import genai
            from google.genai import types
            self._client = genai.Client(
                api_key=settings.gemini_api_key,
                http_options=types.HttpOptions(timeout=_TIMEOUT_MS),
            )
        except Exception:
            log.exception("gemini client init failed")
            self._client = None
        return self._client

    def _safety_settings(self, types) -> list | None:
        if settings.gemini_safety.strip().lower() == "off":
            return None
        if self._safety is not None:
            return self._safety
        try:
            threshold = getattr(types.HarmBlockThreshold, settings.gemini_safety)
            self._safety = [
                types.SafetySetting(category=getattr(types.HarmCategory, cat), threshold=threshold)
                for cat in _SAFETY_CATEGORIES
            ]
        except Exception:
            self._safety = None
        return self._safety

    def _config(self, types, system: str | None, response_schema: Any):
        kwargs: dict[str, Any] = {
            "temperature": settings.gemini_temperature,
            "max_output_tokens": settings.gemini_max_output_tokens,
            "safety_settings": self._safety_settings(types),
        }
        if system:
            kwargs["system_instruction"] = system
        if response_schema is not None:
            kwargs["response_mime_type"] = "application/json"
            kwargs["response_schema"] = response_schema
        return types.GenerateContentConfig(**{k: v for k, v in kwargs.items() if v is not None})

    def complete(self, prompt: str, system: str | None = None, *, json_schema: Any = None,
                 media: list[tuple[bytes, str]] | None = None) -> str | None:
        client = self._get_client()
        if client is None:
            return None
        try:
            from google.genai import types
            contents: Any = prompt
            if media:
                parts = [types.Part.from_bytes(data=data, mime_type=mime) for data, mime in media]
                parts.append(types.Part.from_text(text=prompt))
                contents = [types.Content(role="user", parts=parts)]
            resp = client.models.generate_content(
                model=self.model,
                contents=contents,
                config=self._config(types, system, json_schema),
            )
            return (resp.text or "").strip() or None
        except Exception as exc:
            log.warning("gemini(%s) call failed (%s: %s)", self.model, type(exc).__name__, str(exc)[:160])
            return None

    def speak(self, text: str, voice: str = "Kore") -> tuple[bytes, str] | None:
        """Gemini TTS → (audio bytes, mime). Handles raw PCM by wrapping it as WAV."""
        client = self._get_client()
        if client is None:
            return None
        try:
            from google.genai import types
            resp = client.models.generate_content(
                model=settings.gemini_tts_model,
                contents=text,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
                        )
                    ),
                ),
            )
            part = resp.candidates[0].content.parts[0].inline_data
            data = part.data if isinstance(part.data, bytes) else base64.b64decode(part.data)
            mime = part.mime_type or "audio/wav"
            if "pcm" in mime or "L16" in mime:
                data, mime = _pcm_to_wav(data, _rate_from_mime(mime)), "audio/wav"
            return data, mime
        except Exception as exc:
            log.warning("gemini tts failed (%s: %s)", type(exc).__name__, str(exc)[:160])
            return None


def _rate_from_mime(mime: str) -> int:
    for token in mime.replace(" ", "").split(";"):
        if token.startswith("rate="):
            try:
                return int(token[5:])
            except ValueError:
                pass
    return 24000


def _pcm_to_wav(pcm: bytes, rate: int) -> bytes:
    import io
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()
