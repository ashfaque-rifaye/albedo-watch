"""Geocoding with OpenStreetMap Nominatim (ODbL, © OpenStreetMap contributors).

Albedo-Watch stores and shares place names (report jurisdictions, hotspot
districts) and passes them to Gemini, so it uses an open geocoder: Google
Geocoding content may not be cached across users, fed to language or voice
models, or shown beside non-Google maps (Google Maps Platform Terms 3.2.3 and
Service Specific Terms 6). Nominatim's usage policy is respected: an
identifying User-Agent, at most one request per second, and results cached.
"""
from __future__ import annotations

import asyncio
import logging
import time

import httpx

from ..config import settings

log = logging.getLogger("albedo.nominatim")

BASE = "https://nominatim.openstreetmap.org"
UA = "Albedo-Watch/1.0 (+https://albedo-watch-621000818329.asia-south1.run.app)"
_lock = asyncio.Lock()
_last = 0.0
_rev: dict[tuple[int, int], dict] = {}
_fwd: dict[str, dict] = {}


async def _get(path: str, params: dict) -> dict | list | None:
    global _last
    async with _lock:  # one request per second, process-wide
        wait = 1.05 - (time.monotonic() - _last)
        if wait > 0:
            await asyncio.sleep(wait)
        _last = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=12, headers={"User-Agent": UA, "Accept-Language": "en"}) as c:
                r = await c.get(BASE + path, params={**params, "format": "jsonv2"})
            if r.status_code != 200:
                log.warning("nominatim %s HTTP %s", path, r.status_code)
                return None
            return r.json()
        except Exception as exc:
            log.warning("nominatim %s failed (%s)", path, type(exc).__name__)
            return None


def _fields(addr: dict, display: str | None) -> dict:
    out = {
        "locality": addr.get("city") or addr.get("town") or addr.get("village") or addr.get("suburb") or addr.get("hamlet"),
        "subdistrict": addr.get("subdistrict") or addr.get("municipality"),
        "district": addr.get("state_district") or addr.get("county") or addr.get("district"),
        "state": addr.get("state") or addr.get("region") or addr.get("province"),
        "country": (addr.get("country_code") or "").upper() or None,
        "address": ", ".join(display.split(", ")[:4]) if display else None,
        "source": "OpenStreetMap Nominatim",
    }
    return {k: v for k, v in out.items() if v}


async def reverse(lat: float, lon: float) -> dict:
    """Coordinates → locality, district, state, ISO country (cached per ~1 km)."""
    if settings.offline:
        return {}
    key = (round(lat * 100), round(lon * 100))
    if key in _rev:
        return _rev[key]
    d = await _get("/reverse", {"lat": f"{lat:.5f}", "lon": f"{lon:.5f}", "zoom": 14, "addressdetails": 1})
    out = _fields(d.get("address") or {}, d.get("display_name")) if isinstance(d, dict) and "error" not in d else {}
    if out:
        if len(_rev) > 5000:
            _rev.clear()
        _rev[key] = out
    return out


async def search(query: str) -> dict:
    """Name or address → {lat, lon, address, country}."""
    if settings.offline or not query.strip():
        return {}
    q = query.strip()[:200]
    if q.lower() in _fwd:
        return _fwd[q.lower()]
    d = await _get("/search", {"q": q, "limit": 1, "addressdetails": 1})
    if not isinstance(d, list) or not d:
        return {}
    x = d[0]
    out = {"lat": round(float(x["lat"]), 5), "lon": round(float(x["lon"]), 5), "address": x.get("display_name"),
           "country": ((x.get("address") or {}).get("country_code") or "").upper() or None, "source": "OpenStreetMap Nominatim"}
    _fwd[q.lower()] = out
    return out
