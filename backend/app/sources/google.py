"""Google Maps Platform (server side): Air Quality current conditions and Street View metadata.

How Albedo-Watch stays inside the Google Maps Platform Terms:
* Air Quality values are only shown to the person who asked, beside a Google
  basemap, with Google attribution; they are cached for at most one hour
  (Service Specific Terms 2.2) and never used to train or test a model
  (Terms 3.2.3(c)(vii)), never passed to Gemini, and never read aloud by TTS
  (3.2.3(a)(iv)). The federated models learn from OpenAQ reference monitors.
* Street View is shown only through the Maps Embed API; the backend asks for
  metadata to pick an outdoor Google panorama and keeps only its pano ID,
  which the terms allow to be stored. No Street View image is fetched,
  proxied or stored.
* Geocoding uses OpenStreetMap (see ``nominatim.py``).
* Coordinates are rounded to ~100 m before they are sent, so no precise
  personal location leaves the server.
"""
from __future__ import annotations

import logging

import httpx

from ..config import settings

log = logging.getLogger("albedo.google")

AQ_CURRENT = "https://airquality.googleapis.com/v1/currentConditions:lookup"
SV_META = "https://maps.googleapis.com/maps/api/streetview/metadata"


def _r(v: float) -> float:
    return round(v, 3)


async def aq_current(lat: float, lon: float) -> dict:
    """Live conditions incl. the country's official local index (display only)."""
    key = settings.maps_server_key
    if not key or settings.offline:
        return {}
    body = {"location": {"latitude": _r(lat), "longitude": _r(lon)},
            "extraComputations": ["LOCAL_AQI", "POLLUTANT_CONCENTRATION", "HEALTH_RECOMMENDATIONS",
                                  "DOMINANT_POLLUTANT_CONCENTRATION"], "languageCode": "en"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(AQ_CURRENT, params={"key": key}, json=body)
        if r.status_code != 200:
            return {}
        d = r.json()
    except Exception:
        return {}
    idx = [{"code": i.get("code"), "name": i.get("displayName"), "aqi": i.get("aqi"), "category": i.get("category"),
            "dominant": i.get("dominantPollutant"), "color": _rgb(i.get("color"))} for i in d.get("indexes", [])]
    pol = {p["code"]: {"name": p.get("displayName"), "value": p.get("concentration", {}).get("value"),
                       "units": p.get("concentration", {}).get("units")} for p in d.get("pollutants", [])}
    return {"time": d.get("dateTime"), "region": d.get("regionCode"), "indexes": idx, "pollutants": pol,
            "health": d.get("healthRecommendations", {}).get("generalPopulation"),
            "attribution": "Air quality data: Google Maps"}


def _rgb(c: dict | None) -> str | None:
    if not c:
        return None
    return "#{:02x}{:02x}{:02x}".format(int(255 * c.get("red", 0)), int(255 * c.get("green", 0)), int(255 * c.get("blue", 0)))


async def streetview_meta(lat: float, lon: float, radius: int = 1000) -> dict:
    """Metadata for the nearest outdoor panorama (free; the pano ID may be stored)."""
    key = settings.maps_server_key
    if not key or settings.offline:
        return {}
    lat, lon = _r(lat), _r(lon)
    # Prefer Google's own street imagery: "outdoor" still admits third-party photospheres
    # (often shop interiors), so nudge the search a few tens of metres until a © Google pano turns up.
    offsets = [(0, 0), (0.0006, 0), (-0.0006, 0), (0, 0.0006), (0, -0.0006), (0.0012, 0.0012), (-0.0012, -0.0012)]
    first: dict = {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            for dlat, dlon in offsets:
                r = await client.get(SV_META, params={"location": f"{lat + dlat},{lon + dlon}", "radius": radius,
                                                      "source": "outdoor", "key": key})
                d = r.json()
                if d.get("status") != "OK":
                    continue
                first = first or d
                if "google" in (d.get("copyright") or "").lower():
                    return d
        return first
    except Exception:
        return first
