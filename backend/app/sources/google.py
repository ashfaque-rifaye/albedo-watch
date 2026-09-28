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


AQ_CURRENT = "https://airquality.googleapis.com/v1/currentConditions:lookup"
SV_META = "https://maps.googleapis.com/maps/api/streetview/metadata"
SV_IMAGE = "https://maps.googleapis.com/maps/api/streetview"


async def aq_current(lat: float, lon: float) -> dict:
    """Live station-fused conditions incl. the country's official local index."""
    key = settings.maps_server_key
    if not key or settings.offline:
        return {}
    body = {"location": {"latitude": lat, "longitude": lon},
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
            "health": d.get("healthRecommendations", {}).get("generalPopulation")}


def _rgb(c: dict | None) -> str | None:
    if not c:
        return None
    return "#{:02x}{:02x}{:02x}".format(int(255 * c.get("red", 0)), int(255 * c.get("green", 0)), int(255 * c.get("blue", 0)))


async def streetview_meta(lat: float, lon: float, radius: int = 1000) -> dict:
    key = settings.maps_server_key
    if not key or settings.offline:
        return {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(SV_META, params={"location": f"{lat},{lon}", "radius": radius, "source": "outdoor", "key": key})
        d = r.json()
        return d if d.get("status") == "OK" else {}
    except Exception:
        return {}


async def streetview_image(lat: float, lon: float, heading: float | None = None, fov: int = 90) -> bytes | None:
    """Live Street View frame. Never cached or stored (Google Maps Platform terms)."""
    key = settings.maps_server_key
    if not key:
        return None
    params = {"size": "640x400", "location": f"{lat},{lon}", "fov": fov, "radius": 1000, "source": "outdoor", "key": key}
    if heading is not None:
        params["heading"] = heading
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(SV_IMAGE, params=params)
    return r.content if r.status_code == 200 and r.headers.get("content-type", "").startswith("image") else None
