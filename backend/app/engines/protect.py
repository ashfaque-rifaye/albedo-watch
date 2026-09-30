"""Protect — the people who can least afford a bad-air day.

For a city (or a hotspot's smoke path) this finds the schools, colleges, hospitals
and clinics on OpenStreetMap and turns the hourly forecast into plain instructions:
when outdoor activity is fine, when to keep children and patients indoors.
"""
from __future__ import annotations

import logging
import math
import time

import httpx

from ..config import settings
from ..geo import haversine_km
from ..registry import CITY_BY_ID
from ..sources.osm import OVERPASS

log = logging.getLogger("albedo.protect")

KINDS = {  # OSM tag value → (group, label)
    "kindergarten": ("school", "Pre-school"), "school": ("school", "School"), "college": ("school", "College"),
    "university": ("school", "University"), "hospital": ("health", "Hospital"), "clinic": ("health", "Clinic"),
    "doctors": ("health", "Clinic"), "centre": ("health", "Health centre"),
}
PRIORITY = {"Hospital": 0, "Pre-school": 1, "School": 2, "Clinic": 3, "Health centre": 3, "College": 4, "University": 5}
_cache: dict[str, tuple[float, dict]] = {}


def tz_offset_h(lat: float, lon: float, country: str | None) -> float:
    if country == "IN" or (6 <= lat <= 37.5 and 68 <= lon <= 97.5):
        return 5.5
    return round(lon / 15)


def windows(times: list[int], levels: list[int], now_offset: int, tz_h: float, sensitive_max: int = 1,
            hours: int = 24) -> dict:
    """Daytime (06–20 local) stretches that are fine for outdoor activity, and stretches to avoid."""
    good, bad = [], []
    for k in range(now_offset, min(len(times), now_offset + hours)):
        hr = (times[k] / 3600 + tz_h) % 24
        lvl = levels[k] if k < len(levels) else None
        if lvl is None:
            continue
        slot = (times[k], times[k] + 3600)
        if 6 <= hr < 20 and lvl <= sensitive_max:
            (good[-1].__setitem__(1, slot[1]) if good and good[-1][1] == slot[0] else good.append(list(slot)))
        if lvl >= 3:
            (bad[-1].__setitem__(1, slot[1]) if bad and bad[-1][1] == slot[0] else bad.append(list(slot)))
    return {"outdoor_ok": good[:4], "stay_indoors": bad[:4], "tz_offset_h": tz_h}


async def _sites(clause: str) -> list[dict]:
    q = ('[out:json][timeout:25];('
         f'nwr["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors)$"]{clause};'
         f'nwr["healthcare"~"^(hospital|clinic|centre)$"]{clause};'
         ');out center tags qt 1500;')
    async with httpx.AsyncClient(timeout=35, headers={"User-Agent": "Albedo-Watch/1.0 (civic air-quality prototype)"}) as client:
        for url in OVERPASS:
            try:
                r = await client.post(url, data={"data": q})
                if r.status_code == 200 and r.headers.get("content-type", "").startswith("application/json"):
                    els = r.json().get("elements", [])
                    break
            except (httpx.HTTPError, ValueError):
                continue
        else:
            raise RuntimeError("OpenStreetMap is unavailable right now")
    out, seen = [], set()
    for e in els:
        t = e.get("tags") or {}
        kind = KINDS.get(t.get("amenity") or "") or KINDS.get(t.get("healthcare") or "")
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if not kind or lat is None:
            continue
        name = t.get("name:en") or t.get("name") or f"Unnamed {kind[1].lower()}"
        key = (name.lower(), round(lat, 3), round(lon, 3))
        if key in seen:
            continue
        seen.add(key)
        out.append({"name": name, "group": kind[0], "type": kind[1], "lat": round(lat, 5), "lon": round(lon, 5)})
    return out


def _summarise(sites: list[dict], lat: float, lon: float) -> dict:
    for s in sites:
        s["km"] = round(haversine_km(lat, lon, s["lat"], s["lon"]), 1)
    counts: dict[str, int] = {}
    for s in sites:
        counts[s["type"]] = counts.get(s["type"], 0) + 1
    named = [s for s in sites if not s["name"].startswith("Unnamed")]
    top = sorted(named, key=lambda s: (PRIORITY.get(s["type"], 9), s["km"]))[:40]
    return {"counts": counts, "schools": sum(1 for s in sites if s["group"] == "school"),
            "health": sum(1 for s in sites if s["group"] == "health"), "total": len(sites), "top": top,
            "points": [[s["lat"], s["lon"], 0 if s["group"] == "school" else 1] for s in sites[:1500]]}


async def for_city(city: dict) -> dict:
    """city: a built city row (forecast.build_city) with its hourly series."""
    key = f"city:{city['id']}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 1800:
        return hit[1]
    radius = min(12.0, 3.0 + 1.8 * math.sqrt(max(0.1, city["pop_m"])))
    sites = [] if settings.offline else await _sites(f'(around:{int(radius * 1000)},{city["lat"]},{city["lon"]})')
    s = city["_series"]
    tz = tz_offset_h(city["lat"], city["lon"], city.get("country"))
    res = {"city": city["id"], "name": city["name"], "lat": city["lat"], "lon": city["lon"], "radius_km": round(radius, 1),
           "index_system": city["index_system"], "now": city["naqi"], "category": city["category"],
           "peak72": city["peak72"], "peak_category": city["peak_category"], "spike": city["spike"],
           "windows": windows(s["time"], s["level"], s["now_offset"], tz),
           "source": "© OpenStreetMap contributors (ODbL) · forecast: CAMS corrected by Albedo-Watch's federated model",
           **_summarise(sites, city["lat"], city["lon"])}
    _cache[key] = (time.time(), res)
    return res


async def along_plume(lat: float, lon: float, paths: list[list[list[float]]], nearest_city: dict | None) -> dict:
    """Sites within ~3 km of a hotspot's forecast smoke path (first 12 h), with arrival times."""
    pts = [(p[1], p[0], p[2]) for path in paths[:3] for p in path[::2]]
    if not pts:
        return {"total": 0, "schools": 0, "health": 0, "top": [], "points": [], "counts": {}}
    line = ",".join(f"{la:.4f},{lo:.4f}" for la, lo, _ in pts[:60])
    sites = [] if settings.offline else await _sites(f"(around:3000,{line})")
    for s in sites:
        best = min(pts, key=lambda p: haversine_km(s["lat"], s["lon"], p[0], p[1]))
        s["eta_h"] = round(best[2], 1)
    res = _summarise(sites, lat, lon)
    res["top"] = sorted([s for s in sites if not s["name"].startswith("Unnamed")],
                        key=lambda s: (s.get("eta_h", 99), PRIORITY.get(s["type"], 9)))[:40]
    if nearest_city:
        s = nearest_city["_series"]
        res["windows"] = windows(s["time"], s["level"], s["now_offset"], tz_offset_h(lat, lon, nearest_city.get("country")))
    res["source"] = "© OpenStreetMap contributors (ODbL) · smoke path: forward trajectories through the live wind field"
    return res


__all__ = ["for_city", "along_plume", "windows", "tz_offset_h", "CITY_BY_ID"]
