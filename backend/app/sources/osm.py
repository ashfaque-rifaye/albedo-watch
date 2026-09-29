"""OpenStreetMap building footprints (Overpass API) for the 3D city view.

Google's photorealistic 3D mesh does not cover most Indian cities, so the city
view extrudes OSM footprints instead — worldwide, keyless, ODbL.

Heights, in order of trust: the ``height`` tag, ``building:levels`` × 3.2 m,
otherwise a conservative default for the building type. Every building carries
a flag saying whether its height was mapped or estimated, and the UI says so.
"""
from __future__ import annotations

import logging
import math
import re
import time

import httpx

from ..config import settings

log = logging.getLogger("albedo.osm")

OVERPASS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
DEFAULT_H = {
    "house": 7, "detached": 7, "semidetached_house": 7, "terrace": 8, "residential": 10, "apartments": 18,
    "commercial": 14, "office": 20, "retail": 8, "supermarket": 8, "industrial": 10, "warehouse": 9,
    "school": 10, "college": 12, "university": 14, "hospital": 18, "hotel": 22, "public": 12, "government": 14,
    "civic": 12, "church": 14, "cathedral": 25, "temple": 12, "mosque": 14, "train_station": 12, "stadium": 20,
    "hut": 3, "shed": 3, "garage": 3, "garages": 3, "roof": 4, "carport": 3, "kiosk": 3, "construction": 8,
}
_NUM = re.compile(r"[-+]?\d+(?:\.\d+)?")
_cache: dict[tuple[float, float, int], tuple[float, dict]] = {}


def _num(v: str | None) -> float | None:
    if not v:
        return None
    m = _NUM.search(v.replace(",", "."))
    return float(m.group()) if m else None


def _height(tags: dict) -> tuple[float, float, bool]:
    """(base_m, top_m, estimated)."""
    base = _num(tags.get("min_height")) or ((_num(tags.get("building:min_level")) or 0) * 3.2)
    h = _num(tags.get("height")) or _num(tags.get("building:height"))
    if h and 2 <= h <= 900:
        return base, h, False
    lv = _num(tags.get("building:levels"))
    if lv and 0 < lv <= 200:
        return base, lv * 3.2 + 1.0, False
    return base, float(DEFAULT_H.get(tags.get("building", ""), 8)), True


def _synthetic(lat: float, lon: float) -> dict:
    out = []
    for i in range(-4, 5):
        for j in range(-4, 5):
            la, lo = lat + i * 0.0009, lon + j * 0.0011
            d = 0.00025
            out.append([0, 10 + (abs(i * j) % 5) * 6, 1, [round(x, 6) for x in (lo - d, la - d, lo + d, la - d, lo + d, la + d, lo - d, la + d)]])
    return {"buildings": out, "count": len(out), "mapped_height_share": 0.0, "radius_m": 500, "source": "synthetic (offline)"}


async def buildings(lat: float, lon: float, radius: int = 700, limit: int = 6000) -> dict:
    if settings.offline:
        return _synthetic(lat, lon)
    key = (round(lat, 3), round(lon, 3), radius)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 24 * 3600:
        return hit[1]
    q = f'[out:json][timeout:25];way["building"](around:{radius},{lat:.6f},{lon:.6f});out tags geom qt {limit};'
    data = None
    async with httpx.AsyncClient(timeout=35, headers={"User-Agent": "Albedo-Watch/1.0 (civic air-quality prototype)"}) as client:
        for url in OVERPASS:
            try:
                r = await client.post(url, data={"data": q})
                if r.status_code == 200 and r.headers.get("content-type", "").startswith("application/json"):
                    data = r.json()
                    break
                log.info("overpass %s -> HTTP %s", url.split("/")[2], r.status_code)
            except (httpx.HTTPError, ValueError) as exc:
                log.info("overpass %s failed (%s)", url.split("/")[2], type(exc).__name__)
    if data is None:
        raise RuntimeError("OpenStreetMap buildings are unavailable right now")
    out, mapped = [], 0
    for el in data.get("elements", []):
        geom = el.get("geometry") or []
        if len(geom) < 4:
            continue
        tags = el.get("tags") or {}
        base, top, est = _height(tags)
        if top <= base:
            continue
        ring = [c for g in geom[:-1] if g for c in (round(g["lon"], 6), round(g["lat"], 6))]
        if len(ring) < 6:
            continue
        mapped += 0 if est else 1
        out.append([round(base, 1), round(top, 1), 1 if est else 0, ring])
    res = {"buildings": out, "count": len(out), "mapped_height_share": round(mapped / max(1, len(out)), 3),
           "radius_m": radius, "source": "© OpenStreetMap contributors (ODbL) via Overpass API"}
    if len(_cache) > 60:
        _cache.pop(min(_cache, key=lambda k: _cache[k][0]))
    _cache[key] = (time.time(), res)
    log.info("OSM buildings %.3f,%.3f r=%d: %d (%.0f%% mapped heights)", lat, lon, radius, len(out), 100 * res["mapped_height_share"])
    return res


def tallest(res: dict) -> float:
    return max((b[1] for b in res["buildings"]), default=0.0)


__all__ = ["buildings", "tallest", "math"]
