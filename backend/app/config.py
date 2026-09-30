"""Albedo-Watch settings, loaded from environment / backend/.env."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV, extra="ignore")

    # Gemini (Google AI Studio). 3.7 Flash is the reasoning + multimodal workhorse.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.7-flash"
    gemini_fast_model: str = "gemini-3.5-flash-lite"   # cheap narration / translation
    # Gemini cascade when the primary is overloaded (503) or rate-limited (429)
    gemini_backup_models: str = "gemini-3.5-flash,gemini-2.5-flash"
    gemini_tts_model: str = "gemini-3.8-flash-tts"      # multilingual voice advisories
    gemini_temperature: float = 0.35
    gemini_max_output_tokens: int = 4096
    gemini_cache_size: int = 256
    gemini_safety: str = "BLOCK_MEDIUM_AND_ABOVE"

    # Internal failover providers (never named in the UI)
    groq_api_key: str = ""
    groq_api_key2: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    cerebras_api_key: str = ""
    cerebras_model: str = "gpt-oss-120b"

    # Google Maps Platform — server key: Air Quality current conditions + Street View metadata (display only)
    google_maps_api_key: str = ""
    # Browser key (referrer-restricted: 3D Tiles, Air Quality heatmap). Public by nature; served to the SPA.
    google_browser_key: str = ""
    server_api_key: str = ""

    # OpenAQ v3 (official ground stations worldwide) — optional
    openaq_api_key: str = ""
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    cron_key: str = ""

    # Google Cloud
    gcp_project: str = ""
    # report store: auto (Firestore if reachable, else memory) | firestore | memory
    report_store: str = "auto"

    # Data refresh cadence (seconds) — keeps us well inside free-tier quotas
    aq_ttl: int = 3 * 3600
    wind_ttl: int = 3 * 3600
    fires_ttl: int = 3 * 3600
    truth_ttl: int = 6 * 3600

    # Offline mode: never call external data APIs (tests / air-gapped demo)
    offline: bool = False

    cors_origins: str = "http://localhost:5173"
    rate_limit_per_minute: int = 300
    log_level: str = "INFO"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def maps_server_key(self) -> str:
        return self.server_api_key or self.google_maps_api_key


settings = Settings()
