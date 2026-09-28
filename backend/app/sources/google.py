"""Google Maps Platform: Air Quality history (station-fused ground truth for the
federated correction models) and reverse geocoding (report jurisdiction)."""
from __future__ import annotations

import logging
from datetime import datetime

import httpx

from ..config import settings

log = logging.getLogger("albedo.google")

AQ_HISTORY = "https://airquality.googleapis.com/v1/history:lookup"
GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json"


async def aq_history(lat: float, lon: float, hours: int = 72) -> dict[int, float]:
    """{unix_hour: pm2.5 µg/m³} for the past ``hours``."""
    key = settings.maps_server_key
    if not key:
        return {}
    body = {
        "hours": hours, "pageSize": hours,
        "location": {"latitude": lat, "longitude": lon},
        "extraComputations": ["POLLUTANT_CONCENTRATION"],
        "universalAqi": False,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(AQ_HISTORY, params={"key": key}, json=body)
    if r.status_code != 200:
        log.warning("google aq history HTTP %s", r.status_code)
        return {}
    out: dict[int, float] = {}
    for h in r.json().get("hoursInfo", []):
        try:
            ts = int(datetime.fromisoformat(h["dateTime"].replace("Z", "+00:00")).timestamp())
            for p in h.get("pollutants", []):
                if p.get("code") == "pm25":
                    out[ts] = float(p["concentration"]["value"])
        except (KeyError, ValueError, TypeError):
            continue
    return out


async def reverse_geocode(lat: float, lon: float) -> dict:
    key = settings.maps_server_key
    if not key or settings.offline:
        return {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(GEOCODE, params={"latlng": f"{lat},{lon}", "key": key,
                                                  "result_type": "locality|administrative_area_level_3|administrative_area_level_2"})
        results = r.json().get("results", [])
    except Exception:
        return {}
    info: dict[str, str] = {}
    for res in results[:3]:
        for comp in res.get("address_components", []):
            t = comp.get("types", [])
            if "locality" in t:
                info.setdefault("locality", comp["long_name"])
            if "administrative_area_level_3" in t:
                info.setdefault("subdistrict", comp["long_name"])
            if "administrative_area_level_2" in t:
                info.setdefault("district", comp["long_name"])
            if "administrative_area_level_1" in t:
                info.setdefault("state", comp["long_name"])
            if "country" in t:
                info.setdefault("country", comp["short_name"])
        if res.get("formatted_address"):
            info.setdefault("address", res["formatted_address"])
    return info
