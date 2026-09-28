"""Blind-spot finder — hidden pollution hotspots, anywhere on Earth.

Evidence (satellite heat detections + verified citizen reports) is accumulated
on a 0.5° lattice and discounted by *measured* monitoring coverage: official
stations (OpenAQ when configured; India's CPCB network otherwise) and, at a
lower weight, open citizen sensors (Sensor.Community). High evidence where no
one is measuring = a blind spot. People downwind turn it into a priority.

Every number the UI shows is in plain units: detections, megawatts, kilometres
to the nearest monitor, people downwind.
"""
from __future__ import annotations

import asyncio
import math
import time

from ..geo import haversine_km
from ..registry import INDIA_CITIES
from ..sources import google
from ..store import store
from . import attribution, datahub

CELL = 0.5
_geo_cache: dict[tuple[int, int], dict] = {}


class _Index:
    """1° bucket index for nearest-neighbour queries over thousands of points."""

    def __init__(self, pts: list[dict]):
        self.b: dict[tuple[int, int], list[dict]] = {}
        for p in pts:
            self.b.setdefault((math.floor(p["lat"]), math.floor(p["lon"])), []).append(p)

    def near(self, lat: float, lon: float, ring: int = 1):
        ci, cj = math.floor(lat), math.floor(lon)
        for di in range(-ring, ring + 1):
            for dj in range(-ring, ring + 1):
                yield from self.b.get((ci + di, cj + dj), ())


def _coverage(lat, lon, official: _Index, citizen: _Index) -> tuple[float, float | None, float | None]:
    s, d_off, d_cit = 0.0, None, None
    for p in official.near(lat, lon):
        d = haversine_km(lat, lon, p["lat"], p["lon"])
        s += p.get("w", 1.0) * math.exp(-d / 12)
        d_off = d if d_off is None else min(d_off, d)
    for p in citizen.near(lat, lon):
        d = haversine_km(lat, lon, p["lat"], p["lon"])
        s += 0.3 * math.exp(-d / 5)
        d_cit = d if d_cit is None else min(d_cit, d)
    return 1 - math.exp(-s / 2), d_off, d_cit


async def find(scope: str = "world", limit: int = 20) -> dict:
    fires = await datahub.fires()
    sensors = await datahub.citizen_sensors()
    stations = await datahub.stations()
    official_src = "OpenAQ official stations" if stations else "CPCB network (India, approximate counts)"
    official_pts = stations or [{"lat": c.lat, "lon": c.lon, "w": c.stations} for c in INDIA_CITIES if c.stations]
    official, citizen = _Index(official_pts), _Index(sensors)
    reports = [r for r in store.list("reports", 500, since=time.time() - 72 * 3600)
               if r.get("analysis", {}).get("is_pollution_event")]

    def in_scope(lat, lon):
        return scope != "india" or (6 <= lat <= 37.5 and 68 <= lon <= 97.5)

    cells: dict[tuple[int, int], dict] = {}

    def cell(lat, lon):
        key = (math.floor(lat / CELL), math.floor(lon / CELL))
        return cells.setdefault(key, {"key": key, "frp": 0.0, "frp_max": 0.0, "fires": 0, "reports": 0,
                                      "report_score": 0.0, "lat_s": 0.0, "lon_s": 0.0, "w": 0.0, "newest": 0})

    for f in fires:
        if not in_scope(f["lat"], f["lon"]):
            continue
        c = cell(f["lat"], f["lon"])
        c["frp"] += f["frp"]; c["frp_max"] = max(c["frp_max"], f["frp"]); c["fires"] += 1
        c["newest"] = max(c["newest"], f["t"])
        c["lat_s"] += f["lat"] * f["frp"]; c["lon_s"] += f["lon"] * f["frp"]; c["w"] += f["frp"]
    for r in reports:
        if not in_scope(r["lat"], r["lon"]):
            continue
        a = r["analysis"]
        c = cell(r["lat"], r["lon"])
        score = a.get("severity", 3) * (0.5 + 0.5 * r.get("verification", {}).get("score", 0.5))
        c["reports"] += 1; c["report_score"] += score
        wt = 40.0 * score
        c["lat_s"] += r["lat"] * wt; c["lon_s"] += r["lon"] * wt; c["w"] += wt

    ranked = []
    for c in cells.values():
        if c["w"] <= 0:
            continue
        lat, lon = c["lat_s"] / c["w"], c["lon_s"] / c["w"]
        evidence = 1 - math.exp(-(c["frp"] / 180 + c["report_score"] / 4))
        if evidence < 0.2:
            continue
        cov, d_off, d_cit = _coverage(lat, lon, official, citizen)
        score = evidence * (1 - cov)
        if score < 0.15:
            continue
        ranked.append({
            "lat": round(lat, 4), "lon": round(lon, 4), "evidence": round(evidence, 3), "coverage": round(cov, 3),
            "score": round(score, 3), "fires": c["fires"], "frp": round(c["frp"], 1), "frp_max": round(c["frp_max"], 1),
            "reports": c["reports"], "newest": c["newest"],
            "nearest_monitor_km": round(d_off) if d_off is not None else None,
            "nearest_sensor_km": round(d_cit, 1) if d_cit is not None else None,
            "place": attribution.nearest_place(lat, lon),
        })
    ranked.sort(key=lambda h: -h["score"])
    top = ranked[:limit * 2]

    async def enrich(h):
        field = await datahub.wind_cheap(h["lat"], h["lon"])
        dw = await asyncio.to_thread(attribution.downwind, field, h["lat"], h["lon"], 12)
        h["downwind"] = {"cities": dw["cities"][:4], "pop_at_risk_m": dw["pop_at_risk_m"]}
        h["priority"] = round(h["score"] * (1 + math.log1p(10 * dw["pop_at_risk_m"])), 3)

    await asyncio.gather(*(enrich(h) for h in top))
    top.sort(key=lambda h: -h["priority"])
    top = top[:limit]
    for h in top:  # Google geocoding only for what we show, cached per 0.1°
        key = (round(h["lat"] * 10), round(h["lon"] * 10))
        if key not in _geo_cache:
            _geo_cache[key] = await google.reverse_geocode(h["lat"], h["lon"])
        h["admin"] = _geo_cache[key]
        h["why"] = _why(h)
    return {
        "scope": scope, "hotspots": top, "cells_scanned": len(cells), "fires": len(fires), "reports": len(reports),
        "sensors": len(sensors), "stations": len(stations), "official_source": official_src,
        # share of evidence far from official monitors — only where station locations are actually known
        "official_coverage_known": bool(stations) or scope == "india",
        "unmonitored_share": (lambda known: round(sum(1 for h in known if (h["nearest_monitor_km"] or 999) > 25) / max(1, len(known)), 3))(
            ranked if (stations or scope == "india") else [h for h in ranked if 6 <= h["lat"] <= 37.5 and 68 <= h["lon"] <= 97.5]),
        "method": "0.5° cells · evidence from NASA VIIRS fire radiative power + verified reports · discounted by "
                  f"measured monitoring coverage ({official_src}; citizen sensors at 30% weight) · ranked by people downwind in 12 h",
    }


def _why(h: dict) -> str:
    parts = []
    if h["fires"]:
        parts.append(f"{h['fires']} satellite heat detection{'s' if h['fires'] > 1 else ''} in 24 h "
                     f"(largest {h['frp_max']:.0f} MW)")
    if h["reports"]:
        parts.append(f"{h['reports']} citizen report{'s' if h['reports'] > 1 else ''}")
    mon = h["nearest_monitor_km"]
    india = 6 <= h["lat"] <= 37.5 and 68 <= h["lon"] <= 97.5
    if mon is not None:
        cov = f"nearest official monitor {mon} km away"
    elif india or h.get("_stations_known"):
        cov = "no official monitor within 100 km"
    else:
        cov = "official monitor locations not yet connected here"
    dw = h["downwind"]["cities"]
    tail = ""
    if dw:
        eta = dw[0]["eta_h"]
        tail = f"; smoke drifts over {dw[0]['name']} " + ("now" if eta < 1 else f"in ~{eta:.0f} h")
    return f"{' + '.join(parts)}; {cov}{tail}."
